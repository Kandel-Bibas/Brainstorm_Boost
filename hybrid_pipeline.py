"""Hybrid extraction pipeline: classifier + GLiNER + targeted LLM.

Instead of sending entire transcript chunks to an LLM and asking it to do
everything, this pipeline decomposes the problem:

1. Parse transcript into individual utterances
2. Classify each utterance (decision/action_item/risk/other) using SetFit
3. Extract entities (people, dates, topics) using GLiNER
4. Send ONLY flagged utterances to a small LLM via Instructor for structuring
5. Code-based post-processing: dedup, relationships, confidence
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pydantic models for Instructor (constrained LLM output)
# ---------------------------------------------------------------------------

class Decision(BaseModel):
    description: str = Field(description="What was decided")
    made_by: str | None = Field(default=None, description="Person who made or announced the decision")
    decision_type: str = Field(default="emergent", description="explicit or emergent")
    confidence: str = Field(default="medium", description="high, medium, or low")
    source_quote: str = Field(default="", description="Exact words from the transcript")

class ActionItem(BaseModel):
    task: str = Field(description="What needs to be done")
    owner: str = Field(default="Unassigned", description="Person responsible")
    deadline: str | None = Field(default=None, description="When it's due, or null")
    confidence: str = Field(default="medium", description="high, medium, or low")
    source_quote: str = Field(default="", description="Exact words from the transcript")

class Risk(BaseModel):
    description: str = Field(description="The concern or risk")
    raised_by: str | None = Field(default=None, description="Person who raised it")
    severity: str = Field(default="medium", description="high, medium, or low")
    source_quote: str = Field(default="", description="Exact words from the transcript")

class ExtractionResult(BaseModel):
    decisions: list[Decision] = Field(default_factory=list)
    action_items: list[ActionItem] = Field(default_factory=list)
    risks: list[Risk] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Step 1: Parse transcript into utterances
# ---------------------------------------------------------------------------

def parse_into_utterances(transcript: str) -> list[dict]:
    """Parse a transcript into individual speaker utterances.
    Handles: VTT (Teams/Zoom), Otter, generic 'Name: text' formats."""
    utterances = []

    # --- VTT format: "timestamp --> timestamp\nSpeaker Name\nText" ---
    vtt_pattern = re.compile(
        r"(\d[\d:.]+)\s*-->\s*(\d[\d:.]+)\s*\n"  # timestamp line
        r"([^\n]+)\n"                               # speaker line
        r"((?:(?!\d[\d:.]+\s*-->).+\n?)*)",         # text lines (until next timestamp)
        re.MULTILINE
    )
    vtt_matches = list(vtt_pattern.finditer(transcript))
    if vtt_matches and len(vtt_matches) >= 3:
        for match in vtt_matches:
            timestamp = match.group(1).strip()
            speaker_raw = match.group(3).strip()
            text = match.group(4).strip()
            # Clean speaker name — remove military suffixes, parenthetical info
            speaker = re.sub(r'\s*\([^)]*\).*$', '', speaker_raw).strip()
            # Further clean: remove titles like "CIV USN NIWC..."
            speaker = re.sub(r'\s+(?:CIV|USN|NIWC|ACT|PAC).*$', '', speaker, flags=re.IGNORECASE).strip()
            if text and len(text) > 5:
                utterances.append({
                    "speaker": speaker or "Unknown",
                    "timestamp": timestamp,
                    "text": text,
                    "char_start": match.start(),
                    "char_end": match.end(),
                })
        if utterances:
            # Merge consecutive utterances from same speaker
            return _merge_consecutive_utterances(utterances)

    # --- VTT with voice tags: "<v Speaker>text</v>" ---
    voice_pattern = re.compile(r"<v\s+([^>]+)>([^<]*)</v>")
    voice_matches = list(voice_pattern.finditer(transcript))
    if voice_matches and len(voice_matches) >= 3:
        ts_pattern = re.compile(r"(\d[\d:.]+)\s*-->\s*(\d[\d:.]+)")
        last_ts = None
        for match in voice_matches:
            # Find preceding timestamp
            ts_match = ts_pattern.search(transcript, max(0, match.start() - 200), match.start())
            if ts_match:
                last_ts = ts_match.group(1)
            speaker = match.group(1).strip()
            text = match.group(2).strip()
            if text:
                utterances.append({
                    "speaker": speaker,
                    "timestamp": last_ts,
                    "text": text,
                    "char_start": match.start(),
                    "char_end": match.end(),
                })
        if utterances:
            return _merge_consecutive_utterances(utterances)

    # --- Otter format: "Name  HH:MM\ntext" ---
    otter_pattern = re.compile(r"^([A-Za-z][A-Za-z .'\-]+)\s+(\d{1,2}:\d{2})\s*$", re.MULTILINE)
    matches = list(otter_pattern.finditer(transcript))
    if matches:
        for i, match in enumerate(matches):
            speaker = match.group(1).strip()
            timestamp = match.group(2).strip()
            start = match.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(transcript)
            text = transcript[start:end].strip()
            if text:
                utterances.append({
                    "speaker": speaker,
                    "timestamp": timestamp,
                    "text": text,
                    "char_start": match.start(),
                    "char_end": end,
                })
        return utterances

    # --- Generic "Name: text" format ---
    generic_pattern = re.compile(r"^([A-Z][A-Za-z .'\-]{1,40}):\s+(.+?)(?=\n[A-Z][A-Za-z .'\-]{1,40}:|\Z)", re.MULTILINE | re.DOTALL)
    for match in generic_pattern.finditer(transcript):
        speaker = match.group(1).strip()
        text = match.group(2).strip()
        if text:
            utterances.append({
                "speaker": speaker,
                "timestamp": None,
                "text": text,
                "char_start": match.start(),
                "char_end": match.end(),
            })
    if utterances:
        return utterances

    # --- Fallback: split by sentences ---
    sentences = re.split(r'(?<=[.!?])\s+', transcript)
    pos = 0
    for s in sentences:
        s = s.strip()
        if s:
            idx = transcript.find(s, pos)
            utterances.append({
                "speaker": "Unknown",
                "timestamp": None,
                "text": s,
                "char_start": idx if idx >= 0 else pos,
                "char_end": (idx + len(s)) if idx >= 0 else pos + len(s),
            })
            pos = idx + len(s) if idx >= 0 else pos + len(s)

    return utterances


def _merge_consecutive_utterances(utterances: list[dict]) -> list[dict]:
    """Merge consecutive utterances from the same speaker."""
    if not utterances:
        return utterances
    merged = [utterances[0].copy()]
    for u in utterances[1:]:
        if u["speaker"] == merged[-1]["speaker"]:
            merged[-1]["text"] += " " + u["text"]
            merged[-1]["char_end"] = u["char_end"]
        else:
            merged.append(u.copy())
    return merged


# ---------------------------------------------------------------------------
# Step 2: Classify utterances using SetFit
# ---------------------------------------------------------------------------

_classifier = None
_CLASSIFIER_PATH = Path(__file__).parent / "models" / "utterance_classifier"

# Training examples for few-shot classification
TRAINING_EXAMPLES = {
    "decision": [
        "OK so let's go with option one, adding custom claim support to the auth server.",
        "We decided to use React for the frontend.",
        "Let's go with Postgres 16 instead of 15.",
        "Alright we'll use production for the client demo on Monday.",
        "OK so it sounds like we're leaning toward the async approach.",
        "Let's scope it as notifications only for now.",
        "Fine, Friday works. Send me the plan by then.",
        "I think we should set up a read replica specifically for analytics queries.",
    ],
    "action_item": [
        "Mike can you bump the memory limit to like 1 gig and see if that stops the crashes?",
        "I'll have the report ready by Friday.",
        "James, can you write up a quick proposal for the async approach?",
        "I'll set up a PagerDuty alert for payment gateway latency above one second.",
        "Can you research backup payment gateways just in case?",
        "Yeah I'll put a deploy freeze in the CI pipeline and send a message to the team.",
        "Priya can you put in an idempotency check so we don't process the same payment twice?",
        "I'll renew the staging certs manually today and then set up Let's Encrypt auto-renewal.",
        "Great, book it Tanya.",
        "Sure, I'll send it to you by 4.",
        "I'll set up a quick call with him tomorrow.",
        "I'll check with them about that.",
        "Send me the plan when it's ready.",
        "Yeah I can do that today.",
        "Put it on the team calendar.",
        "Make sure you loop in Raj.",
    ],
    "risk": [
        "The payment gateway issues might get worse before they get better.",
        "Fair warning though, switching payment gateways is like a multi-month project.",
        "The main risk is the legacy data format compatibility.",
        "If the staging environment keeps going down it could affect the client demo.",
        "We've had twelve support tickets about double charges this week alone.",
        "Their support was very vague about the timeline for their fix.",
        "Sometimes the payment actually went through but we timed out before getting the confirmation.",
        "Nobody documented it, I only found out because the integration tests started failing.",
    ],
    "other": [
        "OK so um I think everyone's here now.",
        "Yeah sorry I'm late, I was stuck in the standup for the other team.",
        "What did I miss?",
        "Works for me.",
        "Ha. OK bye everyone.",
        "Thanks.",
        "See you all tomorrow.",
        "That was back when we had like three endpoints.",
        "Wait is this the same issue that we had last month or is this something new?",
        "No this is different, last month was the database connection pooling thing.",
    ],
}


def _get_classifier():
    """Load or train the SetFit utterance classifier."""
    global _classifier

    if _classifier is not None:
        return _classifier

    # Try loading saved model
    if _CLASSIFIER_PATH.exists():
        try:
            from setfit import SetFitModel
            _classifier = SetFitModel.from_pretrained(str(_CLASSIFIER_PATH))
            logger.info("Loaded utterance classifier from %s", _CLASSIFIER_PATH)
            return _classifier
        except Exception:
            logger.exception("Failed to load saved classifier, retraining")

    # Train from examples
    logger.info("Training utterance classifier from %d examples...", sum(len(v) for v in TRAINING_EXAMPLES.values()))
    from setfit import SetFitModel, Trainer, TrainingArguments
    from datasets import Dataset

    # Build dataset
    texts = []
    labels = []
    label_names = list(TRAINING_EXAMPLES.keys())
    for label_name, examples in TRAINING_EXAMPLES.items():
        label_idx = label_names.index(label_name)
        for example in examples:
            texts.append(example)
            labels.append(label_idx)

    dataset = Dataset.from_dict({"text": texts, "label": labels})

    # Train
    model = SetFitModel.from_pretrained(
        "sentence-transformers/all-MiniLM-L6-v2",
        labels=label_names,
    )

    trainer = Trainer(
        model=model,
        train_dataset=dataset,
        args=TrainingArguments(
            num_epochs=3,
            batch_size=8,
        ),
    )
    trainer.train()

    # Save for offline use
    _CLASSIFIER_PATH.parent.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(_CLASSIFIER_PATH))
    logger.info("Saved utterance classifier to %s", _CLASSIFIER_PATH)

    _classifier = model
    return _classifier


def classify_utterances(utterances: list[dict]) -> list[dict]:
    """Classify each utterance as decision/action_item/risk/other."""
    classifier = _get_classifier()
    texts = [u["text"] for u in utterances]

    predictions = classifier.predict(texts)
    label_names = list(TRAINING_EXAMPLES.keys())

    for u, pred in zip(utterances, predictions):
        if isinstance(pred, (int,)):
            u["classification"] = label_names[pred]
        else:
            u["classification"] = str(pred)

    return utterances


# ---------------------------------------------------------------------------
# Step 3: Extract entities with GLiNER
# ---------------------------------------------------------------------------

_gliner_model = None

def _get_gliner():
    global _gliner_model
    if _gliner_model is None:
        from gliner import GLiNER
        _gliner_model = GLiNER.from_pretrained("urchade/gliner_multi_pii-v1", load_tokenizer=True)
        logger.info("Loaded GLiNER model")
    return _gliner_model


_PRONOUN_BLOCKLIST = {
    "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his",
    "she", "her", "they", "them", "someone", "everyone", "nobody", "anybody",
}

_GENERIC_BLOCKLIST = {
    "team", "client", "user", "support", "director", "vp", "manager",
    "analytics team", "mobile team", "security team", "finance team",
    "product team", "gateway", "subscriber",
}


def _is_real_person(name: str) -> bool:
    """Filter out pronouns, generic roles, and non-person entities."""
    lower = name.strip().lower()
    if lower in _PRONOUN_BLOCKLIST:
        return False
    if lower in _GENERIC_BLOCKLIST:
        return False
    if len(lower) <= 1:
        return False
    # Must contain at least one uppercase letter (proper name)
    if not any(c.isupper() for c in name.strip()):
        return False
    # Filter out long phrases (not a person name)
    if len(name.split()) > 4:
        return False
    return True


def extract_entities_gliner(utterances: list[dict]) -> list[dict]:
    """Extract person names, dates, and topics from utterances using GLiNER."""
    model = _get_gliner()
    labels = ["person", "date", "deadline", "topic"]

    all_persons = set()

    # Also extract speaker names from the utterances themselves
    for u in utterances:
        speaker = u.get("speaker", "")
        if speaker and speaker != "Unknown" and _is_real_person(speaker):
            all_persons.add(speaker.strip())

    for u in utterances:
        try:
            entities = model.predict_entities(u["text"], labels, threshold=0.4)
            u["gliner_entities"] = entities

            for e in entities:
                if e["label"] == "person" and _is_real_person(e["text"]):
                    all_persons.add(e["text"].strip())
        except Exception:
            u["gliner_entities"] = []

    return utterances, all_persons


# ---------------------------------------------------------------------------
# Step 4: LLM structuring with Instructor (only flagged utterances)
# ---------------------------------------------------------------------------

def structure_with_llm(
    flagged_utterances: list[dict],
    all_persons: set[str],
    provider: str = None,
    entity_callback: callable = None,
    cancel_check: callable = None,
) -> ExtractionResult:
    """Send only the flagged utterances to the LLM for structured extraction."""
    from openai import OpenAI
    from llm_client import _parse_json_response

    llm_url = os.getenv("LOCAL_LLM_URL", "http://localhost:1234")
    llm_model = os.getenv("LOCAL_LLM_MODEL", "qwen2.5-7b-instruct")

    if provider == "gemini":
        return _structure_with_gemini(flagged_utterances, all_persons, entity_callback, cancel_check)

    client = OpenAI(base_url=f"{llm_url}/v1", api_key="lm-studio")

    batch_size = 5
    all_results = ExtractionResult()
    total_batches = (len(flagged_utterances) + batch_size - 1) // batch_size

    for batch_idx in range(0, len(flagged_utterances), batch_size):
        if cancel_check and cancel_check():
            logger.info("LLM structuring cancelled after %d batches", batch_idx // batch_size)
            break

        batch = flagged_utterances[batch_idx:batch_idx + batch_size]
        batch_num = batch_idx // batch_size + 1

        context_lines = []
        for u in batch:
            speaker = u.get("speaker", "Unknown")
            text = u.get("text", "")
            ts = u.get("timestamp", "")
            prefix = f"[{ts}] " if ts else ""
            context_lines.append(f"{prefix}{speaker}: {text}")

        context = "\n\n".join(context_lines)
        persons_list = ", ".join(sorted(all_persons)) if all_persons else "unknown"

        prompt = f"""Extract decisions, action items, and risks from these meeting utterances.

Meeting participants (speakers): {persons_list}

EXAMPLE:
Input: "Alice: I think we should use the new framework.\nBob: Agreed, let's go with React.\nAlice: Bob, can you set up the repo by Friday?\nBob: Sure. My concern is we might not have enough time for testing."

Output:
{{"decisions": [{{"description": "Use React for the frontend", "made_by": "Bob", "decision_type": "emergent", "confidence": "high", "source_quote": "Agreed, let's go with React"}}],
"action_items": [{{"task": "Set up the repository", "owner": "Bob", "deadline": "Friday", "confidence": "high", "source_quote": "Bob, can you set up the repo by Friday"}}],
"risks": [{{"description": "Might not have enough time for testing", "raised_by": "Bob", "severity": "medium", "source_quote": "My concern is we might not have enough time for testing"}}]}}

ATTRIBUTION RULES:
- owner, made_by, raised_by MUST be a meeting participant listed above. NEVER attribute to people only mentioned in conversation.
- made_by = the person who ANNOUNCES or FORMULATES the decision ("Let's go with X" / "OK we'll do X")
- owner = the person who is ASKED to do the task, NOT the person asking. If Alice says "Bob, can you do X?" then owner is Bob, not Alice.
- If a participant says "I'll reach out to [someone not in meeting]", the owner is the PARTICIPANT, not the person being contacted.
- SELF-ASSIGNMENTS ARE ACTION ITEMS: "I'll", "Let me", "I need to", "I can", "I'll send", "I'll talk to" = action item with THAT speaker as owner. Do NOT skip these.
- raised_by = the person who VOICES the concern
- source_quote = EXACT words copied from the text above. Do NOT paraphrase or invent quotes.

NOW EXTRACT FROM:
{context}

Return JSON with decisions, action_items, and risks arrays.
A DECISION = choosing direction, agreeing on approach.
An ACTION ITEM = specific task for a specific person.
Do NOT classify decisions as action items.
Only include items clearly stated in the text."""

        try:
            response = client.chat.completions.create(
                model=llm_model,
                messages=[
                    {"role": "system", "content": "Extract structured meeting items. Return valid JSON only with decisions, action_items, and risks arrays."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_tokens=4096,
            )
            text = response.choices[0].message.content
            parsed = _parse_json_response(text)

            for d in parsed.get("decisions", []):
                all_results.decisions.append(Decision(
                    description=d.get("description", d.get("text", "")),
                    made_by=d.get("made_by"),
                    decision_type=d.get("decision_type", "emergent"),
                    confidence=d.get("confidence", "medium"),
                    source_quote=d.get("source_quote", ""),
                ))
            for a in parsed.get("action_items", []):
                all_results.action_items.append(ActionItem(
                    task=a.get("task", a.get("description", "")),
                    owner=a.get("owner", a.get("assignee", "Unassigned")),
                    deadline=a.get("deadline", a.get("due_date")),
                    confidence=a.get("confidence", "medium"),
                    source_quote=a.get("source_quote", ""),
                ))
            for r in parsed.get("risks", []):
                all_results.risks.append(Risk(
                    description=r.get("description", r.get("text", "")),
                    raised_by=r.get("raised_by"),
                    severity=r.get("severity", "medium"),
                    source_quote=r.get("source_quote", ""),
                ))

            if entity_callback:
                entities = []
                for d in parsed.get("decisions", []):
                    entities.append({"type": "decision", "content": d.get("description", ""), "made_by": d.get("made_by"), "confidence": d.get("confidence", "medium")})
                for a in parsed.get("action_items", []):
                    entities.append({"type": "action_item", "content": a.get("task", ""), "owner": a.get("owner"), "confidence": a.get("confidence", "medium")})
                for r in parsed.get("risks", []):
                    entities.append({"type": "risk", "content": r.get("description", ""), "raised_by": r.get("raised_by"), "severity": r.get("severity", "medium")})
                if entities:
                    entity_callback(entities, batch_num - 1, total_batches)

            logger.info("LLM batch %d/%d: %d decisions, %d actions, %d risks",
                        batch_num, total_batches,
                        len(parsed.get("decisions", [])), len(parsed.get("action_items", [])), len(parsed.get("risks", [])))

        except Exception:
            logger.exception("LLM structuring failed for batch %d", batch_num)
            continue

    return all_results


def _structure_with_gemini(
    flagged_utterances: list[dict],
    all_persons: set[str],
    entity_callback: callable = None,
    cancel_check: callable = None,
) -> ExtractionResult:
    """Use Gemini for structuring (cloud fallback)."""
    from llm_client import generate

    all_results = ExtractionResult()
    batch_size = 10  # Gemini can handle larger batches
    total_batches = (len(flagged_utterances) + batch_size - 1) // batch_size

    for batch_idx in range(0, len(flagged_utterances), batch_size):
        if cancel_check and cancel_check():
            break

        batch = flagged_utterances[batch_idx:batch_idx + batch_size]
        batch_num = batch_idx // batch_size + 1

        context_lines = []
        for u in batch:
            speaker = u.get("speaker", "Unknown")
            text = u.get("text", "")
            ts = u.get("timestamp", "")
            prefix = f"[{ts}] " if ts else ""
            context_lines.append(f"{prefix}{speaker}: {text}")

        context = "\n\n".join(context_lines)
        persons_list = ", ".join(sorted(all_persons)) if all_persons else "unknown"

        prompt = f"""Extract decisions, action items, and risks from these meeting utterances.

Known participants: {persons_list}

UTTERANCES:
{context}

Return JSON:
{{"decisions": [{{"description": "...", "made_by": "person or null", "decision_type": "explicit|emergent", "confidence": "high|medium|low", "source_quote": "exact words"}}],
"action_items": [{{"task": "...", "owner": "person", "deadline": "when or null", "confidence": "high|medium|low", "source_quote": "exact words"}}],
"risks": [{{"description": "...", "raised_by": "person or null", "severity": "high|medium|low", "source_quote": "exact words"}}]}}"""

        try:
            result = generate(prompt, provider="gemini", system_prompt="Extract structured meeting items. Return valid JSON only.")

            for d in result.get("decisions", []):
                all_results.decisions.append(Decision(**d))
            for a in result.get("action_items", []):
                all_results.action_items.append(ActionItem(**a))
            for r in result.get("risks", []):
                all_results.risks.append(Risk(**r))

            if entity_callback:
                entities = []
                for d in result.get("decisions", []):
                    entities.append({"type": "decision", "content": d.get("description", ""), "made_by": d.get("made_by"), "confidence": d.get("confidence", "medium")})
                for a in result.get("action_items", []):
                    entities.append({"type": "action_item", "content": a.get("task", ""), "owner": a.get("owner"), "confidence": a.get("confidence", "medium")})
                for r in result.get("risks", []):
                    entities.append({"type": "risk", "content": r.get("description", ""), "raised_by": r.get("raised_by"), "severity": r.get("severity", "medium")})
                if entities:
                    entity_callback(entities, batch_num - 1, total_batches)

        except Exception:
            logger.exception("Gemini structuring failed for batch %d", batch_num)
            continue

    return all_results


# ---------------------------------------------------------------------------
# Step 5: Assemble final output
# ---------------------------------------------------------------------------

def _merge_person_names(persons: set[str]) -> set[str]:
    """Merge short names with full names: 'Mike' + 'Mike Rodriguez' -> 'Mike Rodriguez'."""
    sorted_names = sorted(persons, key=len, reverse=True)  # Longest first
    merged = set()
    for name in sorted_names:
        # Check if this name is a substring of an already-merged longer name
        name_lower = name.strip().lower()
        already_covered = False
        for existing in merged:
            if name_lower in existing.lower() or name_lower == existing.lower():
                already_covered = True
                break
        if not already_covered:
            merged.add(name.strip())
    return merged


def _validate_action_owners(next_steps: list[dict], speakers: set[str], utterances: list[dict]) -> list[dict]:
    """Ensure action item owners are actual meeting participants, not just mentioned people.

    If an owner is not a speaker, try to find the speaker who committed to the
    action from the surrounding utterances.  Falls back to the speaker who was
    talking when the action was discussed.
    """
    speakers_lower = {s.lower(): s for s in speakers}

    def _match_speaker(name: str) -> str | None:
        """Fuzzy-match a name against the speakers set."""
        if not name:
            return None
        name_lower = name.lower().strip()
        # Exact match
        if name_lower in speakers_lower:
            return speakers_lower[name_lower]
        # Partial match: "Carlos" matches "Carlos Ruiz"
        for sl, original in speakers_lower.items():
            if name_lower in sl or sl in name_lower:
                return original
        return None

    def _find_committer(description: str) -> str | None:
        """Search utterances for who actually committed to this task."""
        desc_lower = description.lower()
        # Look for utterances where a speaker uses commitment language about this topic
        desc_words = set(desc_lower.split())
        best_speaker = None
        best_overlap = 0
        for u in utterances:
            text_lower = u.get("text", "").lower()
            speaker = u.get("speaker", "")
            if not speaker or not _match_speaker(speaker):
                continue
            # Check if this utterance discusses the same topic
            text_words = set(text_lower.split())
            overlap = len(desc_words & text_words)
            if overlap > best_overlap and overlap >= 3:
                best_overlap = overlap
                best_speaker = _match_speaker(speaker)
        return best_speaker

    validated = []
    for ns in next_steps:
        owner = ns.get("owner", "")
        matched = _match_speaker(owner)
        if matched:
            ns["owner"] = matched
        elif owner and owner != "Unassigned":
            # Owner is not a participant — try to find who actually committed
            committer = _find_committer(ns.get("description", ""))
            if committer:
                ns["description"] = f"{ns.get('description', '')} (involving {owner})"
                ns["owner"] = committer
            else:
                # Last resort: mark as unassigned with note
                ns["description"] = f"{ns.get('description', '')} (involving {owner})"
                ns["owner"] = "Unassigned"
            logger.info("Owner validation: '%s' is not a participant, reassigned to '%s'", owner, ns["owner"])
        validated.append(ns)
    return validated


def _correct_names_in_output(output: dict, known_names: set[str]) -> dict:
    """Fix hallucinated names in all text fields by matching against known names.

    The LLM sometimes invents last names (e.g. "Marcus Ruiz" when only "Marcus"
    is in the transcript).  This function finds name-like references in text
    fields and replaces them with the closest known name.
    """
    if not known_names:
        return output

    known_lower = {n.lower(): n for n in known_names}

    def _best_match(name: str) -> str | None:
        name_lower = name.lower().strip()
        if name_lower in known_lower:
            return known_lower[name_lower]
        # Check if any known name is a substring or vice versa
        for kl, original in known_lower.items():
            if name_lower in kl or kl in name_lower:
                return original
        return None

    def _fix_names_in_text(text: str) -> str:
        """Replace hallucinated full names with known names in free text."""
        import re
        # Find capitalized name patterns (First Last)
        name_pattern = re.compile(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b')
        for match in name_pattern.finditer(text):
            candidate = match.group(0)
            # Check if this exact name is known
            if candidate.lower() in known_lower:
                continue  # Already correct
            # Check if part of it matches a known name (hallucinated last name)
            first_name = candidate.split()[0]
            matched = _best_match(first_name)
            if matched and matched.lower() != candidate.lower():
                # The first name matches but the full name doesn't — hallucinated
                text = text.replace(candidate, matched)
                logger.info("Name correction: '%s' → '%s'", candidate, matched)
        return text

    # Fix names in topics
    for topic in output.get("topics", []):
        if "summary" in topic:
            topic["summary"] = _fix_names_in_text(topic["summary"])

    # Fix names in details
    for detail in output.get("details", []):
        if "content" in detail:
            detail["content"] = _fix_names_in_text(detail["content"])

    # Fix owner names in next_steps
    for ns in output.get("next_steps", []):
        owner = ns.get("owner", "")
        if owner:
            matched = _best_match(owner)
            if matched:
                ns["owner"] = matched
        if "description" in ns:
            ns["description"] = _fix_names_in_text(ns["description"])

    return output


def _deduplicate_items(items: list, key_fn, threshold: float = 0.85, owner_fn=None) -> list:
    """Text-overlap deduplication. If owner_fn provided, lower threshold for same owner."""
    if len(items) <= 1:
        return items

    unique = [items[0]]
    for item in items[1:]:
        key = key_fn(item).lower()
        is_dup = False
        for existing in unique:
            existing_key = key_fn(existing).lower()
            # Substring match
            if key in existing_key or existing_key in key:
                is_dup = True
                break
            # Word overlap
            words_a = set(key.split())
            words_b = set(existing_key.split())
            if words_a and words_b:
                overlap = len(words_a & words_b) / max(len(words_a), len(words_b))
                effective_threshold = threshold
                # Lower threshold if same owner
                if owner_fn:
                    owner_a = (owner_fn(item) or "").lower()
                    owner_b = (owner_fn(existing) or "").lower()
                    if owner_a and owner_b and (owner_a in owner_b or owner_b in owner_a):
                        effective_threshold = threshold - 0.15
                if overlap > effective_threshold:
                    is_dup = True
                    break
        if not is_dup:
            unique.append(item)
    return unique


def _verify_quote(quote: str, utterances: list[dict]) -> bool:
    """Check if a source quote exists in any utterance text."""
    if not quote or len(quote) < 10:
        return False
    quote_lower = quote.lower().strip().strip('"').strip("'")
    all_text = " ".join(u.get("text", "") for u in utterances).lower()

    # Exact match
    if quote_lower in all_text:
        return True

    # 4-word sliding window
    words = quote_lower.split()
    if len(words) >= 4:
        for i in range(len(words) - 3):
            window = " ".join(words[i:i+4])
            if window in all_text:
                return True
    return False


def _parse_timestamp_seconds(ts: str) -> int | None:
    """Parse a timestamp like '0:00', '05:12', '0:0:5.515', '01:02:17' into seconds."""
    if not ts:
        return None
    ts = ts.strip().strip("()")
    parts = ts.replace(".", ":").split(":")
    try:
        parts = [float(p) for p in parts if p]
        if len(parts) == 2:
            return int(parts[0] * 60 + parts[1])
        elif len(parts) >= 3:
            return int(parts[0] * 3600 + parts[1] * 60 + parts[2])
        elif len(parts) == 1:
            return int(parts[0])
    except (ValueError, IndexError):
        pass
    return None


def _estimate_duration(utterances: list[dict]) -> str | None:
    """Estimate meeting duration from first and last timestamps."""
    timestamps = []
    for u in utterances:
        ts = u.get("timestamp")
        if ts:
            secs = _parse_timestamp_seconds(ts)
            if secs is not None:
                timestamps.append(secs)
    if len(timestamps) < 2:
        return None
    duration_secs = max(timestamps) - min(timestamps)
    if duration_secs < 60:
        return f"{duration_secs} seconds"
    minutes = duration_secs // 60
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes // 60
    remaining = minutes % 60
    return f"{hours}h {remaining}m"


def _merge_details(details: list[dict]) -> list[dict]:
    """Sort details by timestamp and merge entries with duplicate timestamps."""
    if not details:
        return details

    # Sort by timestamp
    def sort_key(d):
        secs = _parse_timestamp_seconds(d.get("timestamp", ""))
        return secs if secs is not None else 999999

    details = sorted(details, key=sort_key)

    # Merge entries with same or very close timestamps
    merged = [details[0]]
    for d in details[1:]:
        prev = merged[-1]
        prev_secs = _parse_timestamp_seconds(prev.get("timestamp", ""))
        curr_secs = _parse_timestamp_seconds(d.get("timestamp", ""))

        # Merge if same timestamp or titles overlap
        same_time = prev_secs is not None and curr_secs is not None and abs(prev_secs - curr_secs) < 30
        title_overlap = False
        if prev.get("title") and d.get("title"):
            words_a = set(prev["title"].lower().split())
            words_b = set(d["title"].lower().split())
            if words_a and words_b:
                title_overlap = len(words_a & words_b) / min(len(words_a), len(words_b)) > 0.5

        if same_time or title_overlap:
            # Merge content
            prev["content"] = prev.get("content", "") + " " + d.get("content", "")
            prev["content"] = prev["content"].strip()
        else:
            merged.append(d)

    return merged


def _synthesize_next_steps(next_steps: list[dict], llm_call, persons_list: str) -> list[dict]:
    """Pass 2: Review all next_steps for contradictions and superseded items."""
    items_text = "\n".join(
        f"- [{ns.get('owner', '?')}] {ns.get('action_label', '')}: {ns.get('description', '')}"
        for ns in next_steps
    )

    prompt = f"""Review these meeting action items and clean them up.

Meeting participants (people who spoke): {persons_list}

RAW ACTION ITEMS:
{items_text}

Remove items that:
1. Were already resolved during the meeting (e.g. "estimate effort for options" when a decision was already made)
2. Are duplicates of other items (keep the more specific one)
3. Are not actual commitments (just discussion or observations)
4. Have an owner who is NOT a meeting participant — these are people only mentioned in discussion, not present

Merge items that describe the same task for the same person.
If an item involves contacting a non-participant, the owner is the PARTICIPANT who committed to doing the outreach.

Return JSON: {{"next_steps": [{{"owner": "person", "action_label": "2-3 word label", "description": "what to do"}}]}}

Keep all genuine action items. Only remove items that are clearly wrong or superseded."""

    try:
        result = llm_call(prompt)
        synthesized = result.get("next_steps", [])
        if synthesized and len(synthesized) >= 3:
            logger.info("Pass 2 synthesized %d next_steps from %d raw items", len(synthesized), len(next_steps))
            return synthesized
    except Exception:
        logger.exception("Pass 2 next_steps synthesis failed, using raw items")

    return next_steps


def _extract_recap_utterances(utterances: list[dict], speakers: set[str]) -> list[dict]:
    """Find utterances that are recap/summary sections of the meeting."""
    recaps = []
    for u in utterances:
        text_lower = u.get("text", "").lower()
        speaker = u.get("speaker", "")
        # Count how many OTHER speakers are mentioned by first name
        other_mentioned = sum(
            1 for s in speakers
            if s.lower() != speaker.lower() and s.lower().split()[0] in text_lower
        )
        recap_signals = any(w in text_lower for w in [
            "recap", "let me see", "let me summarize", "action items",
            "to summarize", "so to recap", "what i have",
            "anything i'm missing", "anything i missed",
        ])
        if other_mentioned >= 2 and recap_signals:
            recaps.append(u)
    return recaps


def _validate_completeness_from_recap(
    next_steps: list[dict],
    utterances: list[dict],
    speakers: set[str],
    llm_call,
    speakers_list: str,
) -> list[dict]:
    """Use recap sections to find action items the main extraction missed.

    The meeting leader's recap is a natural checklist — compare it against
    extracted items and ask the LLM to fill gaps.
    """
    recaps = _extract_recap_utterances(utterances, speakers)
    if not recaps:
        return next_steps

    recap_text = "\n".join(
        f"{u.get('speaker', 'Unknown')}: {u.get('text', '')}" for u in recaps
    )
    existing_text = "\n".join(
        f"- [{ns.get('owner', '?')}] {ns.get('action_label', '')}: {ns.get('description', '')}"
        for ns in next_steps
    )

    prompt = f"""A meeting leader recapped the action items at the end of the meeting.
Compare the recap against the already-extracted action items and find any MISSING ones.

Meeting participants: {speakers_list}

RECAP FROM MEETING:
{recap_text}

ALREADY EXTRACTED ACTION ITEMS:
{existing_text}

Find action items mentioned in the recap that are NOT covered by the extracted list above.
Only return MISSING items. Do NOT repeat items already extracted.
Owners MUST be meeting participants.
Self-assignments ("I'll do X") count as action items — the speaker is the owner.

Return JSON: {{"missing_next_steps": [{{"owner": "person", "action_label": "2-3 word label", "description": "what to do"}}]}}
If nothing is missing, return: {{"missing_next_steps": []}}"""

    try:
        result = llm_call(prompt)
        missing = result.get("missing_next_steps", [])
        if missing:
            logger.info("Recap validator found %d missing action items", len(missing))
            next_steps.extend(missing)
    except Exception:
        logger.exception("Recap completeness check failed")

    return next_steps


def _merge_similar_topics(topics: list[dict]) -> list[dict]:
    """Merge topics with similar titles by combining their summaries."""
    if len(topics) <= 1:
        return topics

    merged = []
    used = set()

    for i, topic in enumerate(topics):
        if i in used:
            continue
        title_i = topic.get("title", "").lower()
        words_i = set(title_i.split())
        combined_summary = topic.get("summary", "")
        best_title = topic.get("title", "")

        for j in range(i + 1, len(topics)):
            if j in used:
                continue
            title_j = topics[j].get("title", "").lower()
            words_j = set(title_j.split())

            # Merge if significant word overlap or one is substring of other
            if words_i and words_j:
                overlap = len(words_i & words_j) / min(len(words_i), len(words_j))
            else:
                overlap = 0

            is_substring = title_i in title_j or title_j in title_i

            if overlap > 0.5 or is_substring:
                used.add(j)
                other_summary = topics[j].get("summary", "")
                if other_summary and other_summary not in combined_summary:
                    combined_summary += " " + other_summary
                # Keep the shorter, cleaner title
                other_title = topics[j].get("title", "")
                if len(other_title) < len(best_title):
                    best_title = other_title

        merged.append({"title": best_title, "summary": combined_summary.strip()})
        used.add(i)

    return merged


def assemble_narrative_output(
    utterances: list[dict],
    speakers: set[str],
    mentioned_persons: set[str] = None,
    provider: str = None,
    entity_callback: callable = None,
) -> dict:
    """Produce Gemini-style narrative output: Summary, Topics, Next Steps, Details."""
    from openai import OpenAI
    from llm_client import _parse_json_response

    llm_url = os.getenv("LOCAL_LLM_URL", "http://localhost:1234")
    llm_model = os.getenv("LOCAL_LLM_MODEL", "qwen2.5-7b-instruct")

    speakers = _merge_person_names(speakers)
    mentioned_persons = _merge_person_names(mentioned_persons or set())
    # Remove speakers from mentioned (in case of overlap)
    mentioned_only = mentioned_persons - speakers
    speakers_list = ", ".join(sorted(speakers))
    mentioned_list = ", ".join(sorted(mentioned_only)) if mentioned_only else "none"

    # Build full transcript text for the LLM (grouped by topic segments)
    # Detect recap sections: a single speaker listing multiple people's tasks
    transcript_lines = []
    for u in utterances:
        speaker = u.get("speaker", "Unknown")
        ts = u.get("timestamp", "")
        text = u.get("text", "")
        ts_prefix = f"({ts}) " if ts else ""
        line = f"{ts_prefix}{speaker}: {text}"

        # Heuristic: recap utterances mention 2+ other speakers by name and use
        # recap language.  Tag them so the LLM doesn't re-extract action items.
        text_lower = text.lower()
        other_speakers_mentioned = sum(
            1 for s in speakers if s.lower() != speaker.lower() and s.lower().split()[0] in text_lower
        )
        recap_signals = any(w in text_lower for w in [
            "recap", "let me see", "let me summarize", "action items",
            "to summarize", "so to recap", "what i have",
            "anything i'm missing", "anything i missed",
        ])
        if other_speakers_mentioned >= 2 and recap_signals:
            line = f"[RECAP - do not extract new action items from this] {line}"

        transcript_lines.append(line)

    full_text = "\n".join(transcript_lines)

    # Chunk if too long — larger chunks = fewer duplicates and better coherence.
    # 12K chars ≈ 3-4K tokens, fits well in 16K context with room for prompt+output.
    # Most 30-min meetings fit in 1-2 chunks instead of 7.
    max_chunk = int(os.getenv("LLM_CHUNK_SIZE", "12000"))
    if len(full_text) > max_chunk:
        # Process in chunks, then synthesize
        chunks = []
        current = []
        current_len = 0
        for line in transcript_lines:
            if current_len + len(line) > max_chunk and current:
                chunks.append("\n".join(current))
                current = [line]
                current_len = len(line)
            else:
                current.append(line)
                current_len += len(line)
        if current:
            chunks.append("\n".join(current))
    else:
        chunks = [full_text]

    # Step 1: Extract topics + next steps from each chunk
    all_topics = []
    all_next_steps = []
    all_details = []
    all_concerns = []

    if provider == "gemini":
        from llm_client import generate as gemini_generate
        llm_call = lambda prompt: gemini_generate(prompt, provider="gemini",
            system_prompt="You are a meeting analyst. Produce structured meeting notes. Return valid JSON only.")
    else:
        client = OpenAI(base_url=f"{llm_url}/v1", api_key="lm-studio")
        def llm_call(prompt):
            response = client.chat.completions.create(
                model=llm_model,
                messages=[
                    {"role": "system", "content": "You are a meeting analyst. Produce structured meeting notes. Return valid JSON only."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_tokens=4096,
            )
            return _parse_json_response(response.choices[0].message.content)

    for i, chunk in enumerate(chunks):
        prompt = f"""Analyze this meeting transcript segment and extract:

Meeting participants (people who spoke): {speakers_list}
Other people mentioned but NOT present: {mentioned_list}

TRANSCRIPT:
{chunk}

Return JSON with:
1. "topics" - array of {{"title": "short topic name", "summary": "1-2 sentence paragraph about what was discussed and decided on this topic"}}
2. "next_steps" - array of {{"owner": "person name", "action_label": "2-3 word label", "description": "what they need to do, with deadline if mentioned"}}
3. "details" - array of {{"title": "section title", "content": "narrative paragraph describing what happened, with timestamps in parentheses like (00:07:49)", "timestamp": "HH:MM:SS of when this started"}}
4. "concerns" - array of strings: anything that sounds urgent, risky, unresolved, or worth flagging for attention. Examples: active incidents, customer-impacting issues, undocumented systems, security gaps, missed deadlines, compliance risks. Only include if genuinely concerning.

RULES:
- owner in next_steps MUST be a meeting participant. NEVER assign action items to people who are only mentioned but not present.
- If a participant says "I'll talk to [non-participant]", the owner is the PARTICIPANT, not the non-participant.
- owner = the person who must DO the task, not the person who asked for it
- SELF-ASSIGNMENTS ARE ACTION ITEMS: When a participant says "I'll", "Let me", "I need to", "I can", "I'll reach out", "I'll set up", "I'll send", "I'll talk to" — that IS an action item with THAT participant as owner. Do NOT skip these.
- For topics, capture WHAT was decided and WHY, not just what was discussed
- For details, write flowing narrative paragraphs, not bullet points
- Include timestamps from the transcript in parentheses within the narrative
- Only include genuine commitments in next_steps, not general discussion or observations"""

        try:
            result = llm_call(prompt)
            all_topics.extend(result.get("topics", []))
            all_next_steps.extend(result.get("next_steps", []))
            all_details.extend(result.get("details", []))
            all_concerns.extend(result.get("concerns", []))

            # Stream to frontend
            if entity_callback:
                entities = []
                for ns in result.get("next_steps", []):
                    entities.append({
                        "type": "action_item",
                        "content": f"[{ns.get('owner', '?')}] {ns.get('action_label', '')}: {ns.get('description', '')}",
                        "owner": ns.get("owner"),
                    })
                if entities:
                    entity_callback(entities, i, len(chunks))

        except Exception:
            logger.exception("Narrative extraction failed for chunk %d/%d", i+1, len(chunks))
            continue

    # Step 2: Generate one-line summary from topics
    summary = ""
    if all_topics:
        topic_names = [t.get("title", "") for t in all_topics]
        try:
            summary_result = llm_call(
                f"Write ONE sentence summarizing a meeting that covered these topics: {', '.join(topic_names)}. "
                f"Participants: {speakers_list}. Return JSON: {{\"summary\": \"one sentence\", \"title\": \"3-6 word meeting title\"}}"
            )
            summary = summary_result.get("summary", "")
            title = summary_result.get("title", "")
        except Exception:
            summary = f"Meeting covered {', '.join(topic_names[:3])}."
            title = topic_names[0] if topic_names else "Meeting"
    else:
        title = "Meeting"

    # Merge similar topics (e.g. "Auth Migration" + "Auth Server Changes" → one topic)
    deduped_topics = _merge_similar_topics(all_topics)

    deduped_next_steps = _deduplicate_items(
        all_next_steps,
        lambda ns: ns.get("description", ""),
        0.5,
        lambda ns: ns.get("owner", ""),
    )

    # Pass 2: Synthesize next_steps — resolve contradictions and remove superseded items
    if deduped_next_steps and len(deduped_next_steps) > 3:
        deduped_next_steps = _synthesize_next_steps(deduped_next_steps, llm_call, speakers_list)

    # Pass 2.5: Use recap sections to find missing action items
    deduped_next_steps = _validate_completeness_from_recap(
        deduped_next_steps, utterances, speakers, llm_call, speakers_list
    )

    # Pass 3: Validate owners — ensure all owners are actual participants (code check, not LLM)
    deduped_next_steps = _validate_action_owners(deduped_next_steps, speakers, utterances)

    # Pass 4: Final dedup after synthesis (catches recap-generated duplicates)
    deduped_next_steps = _deduplicate_items(
        deduped_next_steps,
        lambda ns: ns.get("description", ""),
        0.35,  # Lower threshold after synthesis — catch near-dupes
        lambda ns: ns.get("owner", ""),
    )

    # Sort and merge details by timestamp
    all_details = _merge_details(all_details)

    # Calculate duration from timestamps in utterances
    duration = _estimate_duration(utterances)

    result = {
        "meeting_metadata": {
            "title": title,
            "date_mentioned": None,
            "participants": sorted(speakers),
            "duration_estimate": duration,
        },
        "summary": summary,
        "topics": deduped_topics,
        "next_steps": deduped_next_steps,
        "details": all_details,
        "trust_flags": list(set(all_concerns)),  # Deduplicated LLM-identified concerns
    }

    # Pass 5: Correct hallucinated names across all output fields
    all_known = speakers | mentioned_only
    result = _correct_names_in_output(result, all_known)

    return result


def assemble_output(
    extraction: ExtractionResult,
    all_persons: set[str],
    utterances: list[dict],
    provider: str = None,
) -> dict:
    """Assemble the final AI output JSON from extraction results."""

    # Merge participant names (e.g. "Mike" + "Mike Rodriguez" -> "Mike Rodriguez")
    all_persons = _merge_person_names(all_persons)

    # Deduplicate
    decisions = _deduplicate_items(extraction.decisions, lambda d: d.description, 0.6, lambda d: d.made_by)
    action_items = _deduplicate_items(extraction.action_items, lambda a: a.task, 0.45, lambda a: a.owner)
    risks = _deduplicate_items(extraction.risks, lambda r: r.description, 0.5)

    # Build output with quote verification
    output = {
        "meeting_metadata": {
            "title": None,
            "date_mentioned": None,
            "participants": sorted(all_persons),
            "duration_estimate": None,
        },
        "decisions": [],
        "action_items": [],
        "open_risks": [],
        "state_of_direction": "",
        "trust_flags": [],
    }

    unverified_count = 0

    for i, d in enumerate(decisions):
        verified = _verify_quote(d.source_quote, utterances)
        if not verified:
            unverified_count += 1
        output["decisions"].append({
            "id": f"D{i+1}",
            "description": d.description,
            "decision_type": d.decision_type,
            "made_by": d.made_by,
            "confidence": d.confidence,
            "confidence_rationale": "",
            "source_quote": d.source_quote if verified else "",
            "quote_verified": verified,
        })

    for i, a in enumerate(action_items):
        verified = _verify_quote(a.source_quote, utterances)
        if not verified:
            unverified_count += 1
        output["action_items"].append({
            "id": f"A{i+1}",
            "task": a.task,
            "owner": a.owner or "Unassigned",
            "deadline": a.deadline,
            "commitment_type": "unknown",
            "confidence": a.confidence,
            "confidence_rationale": "",
            "source_quote": a.source_quote if verified else "",
            "quote_verified": verified,
        })

    for i, r in enumerate(risks):
        verified = _verify_quote(r.source_quote, utterances)
        if not verified:
            unverified_count += 1
        output["open_risks"].append({
            "id": f"R{i+1}",
            "description": r.description,
            "raised_by": r.raised_by,
            "severity": r.severity,
            "source_quote": r.source_quote if verified else "",
            "quote_verified": verified,
        })

    # Generate title + summary with LLM (small call)
    try:
        from extraction_pipeline import _generate_summary
        output = _generate_summary(output, provider=provider)
    except Exception:
        logger.exception("Summary generation failed")
        if decisions:
            output["meeting_metadata"]["title"] = decisions[0].description[:60]

    # Trust flags
    if len(all_persons) < 3:
        output["trust_flags"].append("Small meeting with limited cross-validation")
    if len(utterances) < 20:
        output["trust_flags"].append("Short transcript")
    if unverified_count > 0:
        output["trust_flags"].append(f"{unverified_count} source quote(s) could not be verified against transcript")

    low_conf = sum(1 for d in output["decisions"] if d.get("confidence") == "low")
    low_conf += sum(1 for a in output["action_items"] if a.get("confidence") == "low")
    if low_conf > 0:
        output["trust_flags"].append(f"{low_conf} item(s) have low confidence")

    return output


# ---------------------------------------------------------------------------
# Main pipeline entry point
# ---------------------------------------------------------------------------

def run_hybrid_pipeline(
    meeting_id: str,
    raw_transcript: str,
    provider: str = None,
    progress_callback: callable = None,
    entity_callback: callable = None,
    cancel_check: callable = None,
) -> dict:
    """Run the hybrid extraction pipeline.

    1. Parse into utterances
    2. Classify each utterance (SetFit)
    3. Extract entities (GLiNER)
    4. Structure flagged utterances (LLM + Instructor)
    5. Assemble output
    """
    start_time = time.time()

    # Step 1: Parse
    if progress_callback:
        progress_callback("parsing", 0.05, "Parsing transcript into utterances...")
    utterances = parse_into_utterances(raw_transcript)
    logger.info("Parsed %d utterances from transcript (%d chars)", len(utterances), len(raw_transcript))

    if not utterances:
        logger.warning("No utterances found")
        return {"meeting_metadata": {"title": "Empty Meeting", "participants": []}, "decisions": [], "action_items": [], "open_risks": [], "state_of_direction": "", "trust_flags": ["No utterances found"]}

    # Step 2: Classify
    if progress_callback:
        progress_callback("classifying", 0.1, f"Classifying {len(utterances)} utterances...")
    utterances = classify_utterances(utterances)
    classifications = {}
    for u in utterances:
        c = u.get("classification", "other")
        classifications[c] = classifications.get(c, 0) + 1
    logger.info("Classification results: %s", classifications)

    flagged = [u for u in utterances if u.get("classification") in ("decision", "action_item", "risk")]
    logger.info("Flagged %d/%d utterances for LLM processing (%.0f%% filtered out)",
                len(flagged), len(utterances), (1 - len(flagged) / len(utterances)) * 100)

    if progress_callback:
        progress_callback("classifying", 0.2, f"Found {len(flagged)} items to analyze ({len(utterances) - len(flagged)} filtered out)")

    # Step 3: Extract entities with GLiNER
    if progress_callback:
        progress_callback("extracting_entities", 0.25, "Extracting names and dates...")
    utterances, gliner_persons = extract_entities_gliner(utterances)

    # Separate actual speakers (participants) from mentioned people
    speakers = set()
    for u in utterances:
        s = u.get("speaker", "")
        if s and s != "Unknown" and _is_real_person(s):
            speakers.add(s.strip())
    speakers = _merge_person_names(speakers)

    # All known names (speakers + mentioned) — used for attribution in prompts
    all_known_names = speakers | gliner_persons
    all_known_names = _merge_person_names(all_known_names)

    logger.info("Speakers (participants): %s", speakers)
    logger.info("All known names: %s", all_known_names)

    if progress_callback:
        progress_callback("extracting_entities", 0.3, f"Found {len(speakers)} participants")

    if cancel_check and cancel_check():
        return {"meeting_metadata": {"title": "Cancelled", "participants": sorted(speakers)}, "summary": "", "topics": [], "next_steps": [], "details": [], "trust_flags": ["Analysis was cancelled"]}

    # Step 4: Narrative extraction — topics, next steps, details
    if progress_callback:
        progress_callback("analyzing", 0.35, f"Analyzing {len(flagged)} key utterances...")

    output = assemble_narrative_output(
        flagged,
        speakers=speakers,
        mentioned_persons=gliner_persons,
        provider=provider,
        entity_callback=entity_callback,
    )

    elapsed = time.time() - start_time
    if progress_callback:
        progress_callback("complete", 1.0, f"Analysis complete ({elapsed:.0f}s)")

    logger.info("Hybrid pipeline complete in %.1fs: %d topics, %d next steps, %d details",
                elapsed, len(output.get("topics", [])), len(output.get("next_steps", [])), len(output.get("details", [])))

    return output
