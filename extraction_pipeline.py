"""LLM extraction pipeline with code-based post-processing for building knowledge graphs from meeting transcripts."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from knowledge_graph import KnowledgeGraph
from llm_client import generate, analyze_transcript

logger = logging.getLogger(__name__)

# --- Prompts ---

ENTITY_SYSTEM_PROMPT = """You are an entity extraction system. You identify people, topics, decisions, action items, and risks from meeting transcripts. Return structured JSON only."""

SUMMARY_SYSTEM_PROMPT = """You are a meeting analyst. Given a list of decisions, action items, and risks from a meeting, generate a concise title and summary. Return structured JSON only."""

ENTITY_PROMPT_TEMPLATE = """Extract ALL entities from this meeting transcript segment.

TRANSCRIPT SEGMENT:
{chunk}

Entity types to extract:
- person: participant names (ONLY actual human names, not "the class" or "the team")
- topic: subjects being discussed
- decision: things that were decided (explicit or emergent). For made_by, use ONLY the specific person's name who formulated/announced the decision — not groups, not surrounding context words.
- action_item: tasks someone committed to do (include owner, deadline if mentioned). Only extract DISTINCT tasks — if two phrases describe the same task, extract it ONCE.
- risk: concerns, blockers, potential problems raised

CONFIDENCE CALIBRATION — be strict:
- "high": ONLY when the person uses first-person singular + specific deliverable + specific timeframe with NO hedging. Example: "I'll have the report by Friday."
- "medium": Any hedging (probably, should, might), vague scope, or no specific deadline. Example: "I can probably look into that."
- "low": Vague, passive, deflecting, or assigned by someone else without confirmation. Example: "We should think about that." or "Someone needs to handle this."
- Default to "medium" when unsure. Do NOT default to "high".

For each decision, action_item, and risk:
1. Include a source_quote with the EXACT words from the transcript. Copy verbatim — do not paraphrase.
2. Include the speaker name (who said it) in the source_quote_speaker field.
3. For decisions, made_by must be a SINGLE person's name (not "the team" or "Paige's class").

Return JSON (no markdown fencing):
{{"entities": [
  {{"type": "person", "content": "name"}},
  {{"type": "topic", "content": "topic description"}},
  {{"type": "decision", "content": "what was decided", "properties": {{"confidence": "high|medium|low", "made_by": "person who made the decision", "decision_type": "explicit|emergent"}}, "source_quote": "exact words from transcript", "source_quote_speaker": "who said it"}},
  {{"type": "action_item", "content": "task description", "properties": {{"owner": "name", "deadline": "when", "confidence": "high|medium|low"}}, "source_quote": "exact words from transcript", "source_quote_speaker": "who said it"}},
  {{"type": "risk", "content": "concern description", "properties": {{"severity": "high|medium|low", "raised_by": "name"}}, "source_quote": "exact words from transcript", "source_quote_speaker": "who said it"}}
]}}"""

SUMMARY_PROMPT_TEMPLATE = """Given these meeting items, generate a title and summary.

DECISIONS:
{decisions}

ACTION ITEMS:
{action_items}

RISKS:
{risks}

PARTICIPANTS: {participants}

Return JSON (no markdown fencing):
{{"title": "concise meeting topic (5-10 words)", "state_of_direction": "2-3 sentence summary of overall project direction and momentum"}}}"""


# --- Chunking (Fix 7: Speaker-turn chunking) ---

def _format_turns_for_llm(turns: list[dict]) -> str:
    """Format speaker turns into clean [timestamp] Speaker: text format for LLM."""
    lines = []
    for turn in turns:
        speaker = turn.get("speaker", "Unknown")
        text = turn.get("text", "")
        # Extract timestamp if embedded in text (Otter format: "Name  HH:MM\ntext")
        ts_match = re.search(r"(\d{1,2}:\d{2})", text[:20])
        if ts_match:
            ts = ts_match.group(1)
            # Remove the speaker header line from the text
            text = re.sub(r"^[A-Za-z][A-Za-z .'\-]+\s+\d{1,2}:\d{2}\s*\n?", "", text).strip()
            lines.append(f"[{ts}] {speaker}: {text}")
        else:
            lines.append(f"{speaker}: {text}")
    return "\n\n".join(lines)


def normalize_transcript(text: str) -> str:
    """Convert any transcript format into clean [timestamp] Speaker: text format.
    Returns the normalized text. If no speaker turns detected, returns original."""
    turns = _split_by_speaker_turns(text)
    if turns and len(turns) >= 3:
        return _format_turns_for_llm(turns)
    return text


def chunk_transcript(text: str, chunk_size: int = 500, overlap: int = 100) -> list[dict]:
    """Split transcript into chunks. Uses speaker turns if detected, falls back to word count.
    IMPORTANT: text should already be normalized via normalize_transcript()."""
    turns = _split_by_speaker_turns(text)
    if turns and len(turns) >= 3:
        return _chunk_by_turns(turns, group_size=12)
    # Fallback to word-count chunking
    return _chunk_by_words(text, chunk_size, overlap)


def _split_by_speaker_turns(text: str) -> list[dict]:
    """Split transcript into individual speaker turns."""
    turn_pattern = re.compile(
        r"(?:^([A-Z][A-Za-z .'\-]+(?:\s+\([^)]+\))?)\s+\d{1,2}:\d{2}\s*$"  # Otter
        r"|^([A-Z][A-Za-z .'\-]{0,40}):\s+"  # Generic "Name: text"
        r")",
        re.MULTILINE
    )

    turns = []
    matches = list(turn_pattern.finditer(text))
    for i, match in enumerate(matches):
        speaker = match.group(1) or match.group(2) or "Unknown"
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        content = text[start:end].strip()
        if content:
            turns.append({"speaker": speaker.strip(), "text": content, "start": start, "end": end})

    return turns


def _chunk_by_turns(turns: list[dict], group_size: int = 12) -> list[dict]:
    """Group speaker turns into chunks of ~group_size turns.
    Since the input text is already normalized, we compute offsets into that text."""
    # Rebuild the full normalized text to get accurate character offsets
    all_formatted = _format_turns_for_llm(turns)

    chunks = []
    for i in range(0, len(turns), group_size):
        group = turns[i:i + group_size]
        chunk_text = _format_turns_for_llm(group)
        # Find this chunk's position in the full normalized text
        start_pos = all_formatted.find(chunk_text)
        if start_pos == -1:
            start_pos = 0
        end_pos = start_pos + len(chunk_text)
        chunks.append({
            "text": chunk_text,
            "start": start_pos,
            "end": end_pos,
        })
    return chunks


def _chunk_by_words(text: str, chunk_size: int = 500, overlap: int = 100) -> list[dict]:
    """Original word-count chunking as fallback."""
    words = text.split()
    if len(words) <= chunk_size:
        return [{"text": text, "start": 0, "end": len(text)}]

    chunks = []
    word_start = 0
    char_pos = 0
    while word_start < len(words):
        word_end = min(word_start + chunk_size, len(words))
        chunk_text = " ".join(words[word_start:word_end])
        start_char = text.find(words[word_start], char_pos) if word_start < len(words) else len(text)
        end_char = start_char + len(chunk_text)
        chunks.append({"text": chunk_text, "start": start_char, "end": end_char})
        char_pos = start_char
        word_start += chunk_size - overlap
    return chunks


# --- Speaker Extraction (Fix 4) ---

def _extract_speakers_from_transcript(raw_transcript: str) -> set[str]:
    """Extract speaker names from transcript format without LLM.
    Uses the same patterns as transcript_parser.py."""
    speakers = set()

    # Otter format: "Name  HH:MM"
    for match in re.finditer(r"^([A-Za-z][A-Za-z .'\-]+)\s+\d{1,2}:\d{2}\s*$", raw_transcript, re.MULTILINE):
        speakers.add(match.group(1).strip())

    # VTT voice tags: "<v Speaker Name>"
    for match in re.finditer(r"<v\s+([^>]+)>", raw_transcript):
        speakers.add(match.group(1).strip())

    # Zoom format: "Speaker Name: text" after timestamp lines
    for match in re.finditer(r"^\d+\n[\d:.]+ --> [\d:.]+\n([^:]{1,40}):", raw_transcript, re.MULTILINE):
        speakers.add(match.group(1).strip())

    # Generic "Name: text" at line start (common in many formats)
    for match in re.finditer(r"^([A-Z][A-Za-z .'\-]{1,40})\s*:\s+\S", raw_transcript, re.MULTILINE):
        name = match.group(1).strip()
        if len(name.split()) <= 5:  # Avoid matching long sentences
            speakers.add(name)

    return speakers


# --- Source Quote Verification (Fix 2/9) ---

_FILLER_WORDS = re.compile(r"\b(um|uh|like|you know|i mean|sort of|kind of|actually)\b", re.IGNORECASE)
_EXTRA_WHITESPACE = re.compile(r"\s+")


def _strip_fillers(text: str) -> str:
    """Remove filler words and normalize whitespace."""
    text = _FILLER_WORDS.sub(" ", text)
    text = _EXTRA_WHITESPACE.sub(" ", text)
    return text.strip()


def _verify_source_quotes(entities: list[dict], raw_transcript: str) -> list[dict]:
    """Check each entity's source_quote exists in the transcript. Flag unverified ones."""
    transcript_lower = raw_transcript.lower()
    transcript_no_fillers = _strip_fillers(transcript_lower)
    # Also strip punctuation for looser matching
    transcript_no_punct = re.sub(r"[\"'.,!?;:\-\u2014\u2013]", " ", transcript_lower)
    transcript_no_punct = _EXTRA_WHITESPACE.sub(" ", transcript_no_punct)

    for e in entities:
        quote = e.get("properties", {}).get("source_quote", "") or e.get("source_quote", "")
        if quote:
            e.setdefault("properties", {})["source_quote"] = quote
            quote_lower = quote.lower().strip().strip('"').strip("'")
            if len(quote_lower) > 10:
                verified = False
                # Exact match first
                if quote_lower in transcript_lower:
                    verified = True
                else:
                    # Try with filler words stripped from transcript
                    quote_no_fillers = _strip_fillers(quote_lower)
                    if quote_no_fillers in transcript_no_fillers:
                        verified = True
                    else:
                        # Try without punctuation
                        quote_no_punct = re.sub(r"[\"'.,!?;:\-\u2014\u2013]", " ", quote_lower)
                        quote_no_punct = _EXTRA_WHITESPACE.sub(" ", quote_no_punct).strip()
                        if quote_no_punct in transcript_no_punct:
                            verified = True
                        else:
                            # Fuzzy: 4-word sliding window (down from 5)
                            words = quote_no_fillers.split()
                            if len(words) >= 4:
                                for i in range(len(words) - 3):
                                    window = " ".join(words[i:i+4])
                                    if window in transcript_no_fillers:
                                        verified = True
                                        break
                e["properties"]["quote_verified"] = verified
            else:
                e["properties"]["quote_verified"] = False
        speaker = e.get("source_quote_speaker", "") or e.get("properties", {}).get("source_quote_speaker", "")
        if speaker:
            e.setdefault("properties", {})["source_quote_speaker"] = speaker
    return entities


# --- Trust Flags (Fix 6) ---

def _add_trust_flags(review_output: dict, raw_transcript: str, entities: list[dict]) -> dict:
    """Add rule-based trust flags to the review output."""
    flags = review_output.get("trust_flags", []) or []

    # Count speakers
    participants = review_output.get("meeting_metadata", {}).get("participants", [])
    if len(participants) < 3:
        flags.append("Small meeting with limited cross-validation")

    # Short transcript
    word_count = len(raw_transcript.split())
    if word_count < 500:
        flags.append("Short transcript — extraction may be less reliable")

    # Low confidence items
    low_confidence = sum(
        1 for d in review_output.get("decisions", [])
        if d.get("confidence") == "low"
    ) + sum(
        1 for a in review_output.get("action_items", [])
        if a.get("confidence") == "low"
    )
    if low_confidence > 0:
        flags.append(f"{low_confidence} item(s) have low confidence")

    # Unverified quotes
    unverified = sum(
        1 for e in entities
        if e.get("properties", {}).get("quote_verified") is False
    )
    if unverified > 0:
        flags.append(f"{unverified} source quote(s) could not be verified against transcript")

    review_output["trust_flags"] = flags
    return review_output


# --- Response Parsing ---

def parse_entity_response(response: dict) -> list[dict]:
    """Parse and validate entity extraction response."""
    entities = response.get("entities", [])
    return [e for e in entities if e.get("content", "").strip()]


def assign_entity_ids(entities: list[dict]) -> list[dict]:
    """Assign stable short IDs (E1, E2, ...) to entities."""
    for i, e in enumerate(entities):
        e["short_id"] = f"E{i + 1}"
    return entities


def parse_resolution_response(response: dict) -> dict:
    """Parse resolution (Pass 2) response with duplicates, updates, corrections, and relationships."""
    return {
        "duplicates": response.get("duplicates", []),
        "commitment_updates": response.get("commitment_updates", []),
        "type_corrections": response.get("type_corrections", []),
        "relationships": response.get("relationships", []),
    }


def parse_relationship_response(response: dict) -> list[dict]:
    """Parse relationship extraction response. Supports both old and new resolution format."""
    # New resolution format
    if "relationships" in response and any(k in response for k in ("duplicates", "commitment_updates", "type_corrections")):
        return response.get("relationships", [])
    return response.get("relationships", [])


def validate_edges(edges: list[dict], valid_ids: set[str]) -> list[dict]:
    """Filter out edges referencing non-existent entity IDs."""
    valid = []
    for edge in edges:
        if edge.get("source") in valid_ids and edge.get("target") in valid_ids:
            valid.append(edge)
        else:
            logger.warning("Rejected edge with invalid IDs: %s -> %s", edge.get("source"), edge.get("target"))
    return valid


def _format_entity_list(entities: list[dict]) -> str:
    """Format entities as a numbered list for the relationship prompt."""
    lines = []
    for e in entities:
        props = e.get("properties", {})
        prop_str = f" ({', '.join(f'{k}: {v}' for k, v in props.items())})" if props else ""
        lines.append(f"{e['short_id']}: [{e['type']}] {e['content']}{prop_str}")
    return "\n".join(lines)


# --- Deduplication (Fix 1: Semantic dedup) ---

DEDUP_THRESHOLDS = {
    "decision": 0.60,
    "action_item": 0.65,
    "risk": 0.70,
}

# Lower threshold when action items share the same owner
DEDUP_SAME_OWNER_THRESHOLD = 0.55


def _deduplicate_entities(entities: list[dict]) -> list[dict]:
    """Deduplicate entities using embedding similarity within each type."""
    from embeddings import get_embedding_model
    import numpy as np

    # Group by type
    by_type: dict[str, list[dict]] = {}
    for e in entities:
        by_type.setdefault(e["type"], []).append(e)

    unique = []
    model = get_embedding_model()

    for etype, group in by_type.items():
        if len(group) <= 1:
            unique.extend(group)
            continue

        # For persons and topics, exact name match is fine (they're short)
        if etype in ("person", "topic"):
            seen = set()
            for e in group:
                key = e["content"].strip().lower()
                if key not in seen:
                    seen.add(key)
                    unique.append(e)
            continue

        # Substring dedup: if one content is a substring of another, keep the longer one
        sorted_group = sorted(group, key=lambda e: len(e["content"]), reverse=True)
        substring_merged = set()
        for i, e in enumerate(sorted_group):
            for j in range(i + 1, len(sorted_group)):
                if j in substring_merged:
                    continue
                if sorted_group[j]["content"].strip().lower() in e["content"].strip().lower():
                    substring_merged.add(j)
                    logger.info("Substring dedup: '%s' is contained in '%s'",
                                sorted_group[j]["content"][:50], e["content"][:50])
        group = [e for i, e in enumerate(sorted_group) if i not in substring_merged]

        if len(group) <= 1:
            unique.extend(group)
            continue

        # For decisions, action_items, risks — use embedding similarity
        contents = [e["content"] for e in group]
        embeddings = model.encode(contents)

        # Mark which indices are duplicates
        merged = set()
        for i in range(len(group)):
            if i in merged:
                continue
            unique.append(group[i])
            for j in range(i + 1, len(group)):
                if j in merged:
                    continue
                sim = float(np.dot(embeddings[i], embeddings[j]) / (
                    np.linalg.norm(embeddings[i]) * np.linalg.norm(embeddings[j]) + 1e-8
                ))
                # Use lower threshold if same owner (for action items)
                threshold = DEDUP_THRESHOLDS.get(etype, 0.80)
                if etype == "action_item":
                    owner_i = (group[i].get("properties", {}).get("owner") or "").strip().lower()
                    owner_j = (group[j].get("properties", {}).get("owner") or "").strip().lower()
                    if owner_i and owner_j and owner_i == owner_j:
                        threshold = DEDUP_SAME_OWNER_THRESHOLD

                if sim > threshold:
                    merged.add(j)
                    logger.info("Merged duplicate entities: '%s' ~ '%s' (sim=%.3f, threshold=%.2f)",
                                group[i]["content"][:50], group[j]["content"][:50], sim, threshold)

    return unique


# --- Code-based Post-Processing (replaces LLM Pass 2) ---

_VOLUNTEERED_PATTERNS = [
    re.compile(r"\bi[''']?ll\b", re.IGNORECASE),
    re.compile(r"\bi will\b", re.IGNORECASE),
    re.compile(r"\bi[''']?m going to\b", re.IGNORECASE),
    re.compile(r"\blet me\b", re.IGNORECASE),
    re.compile(r"\bi can\b", re.IGNORECASE),
    re.compile(r"\bi[''']?ll take\b", re.IGNORECASE),
]

_ASSIGNED_PATTERNS = [
    re.compile(r"\bcan you\b", re.IGNORECASE),
    re.compile(r"\bcould you\b", re.IGNORECASE),
    re.compile(r"\byou should\b", re.IGNORECASE),
    re.compile(r"\byou need to\b", re.IGNORECASE),
    re.compile(r"\bplease\b.*\b(do|send|check|review|handle|submit|prepare)\b", re.IGNORECASE),
]

_CONDITIONAL_PATTERNS = [
    re.compile(r"\bprobably\b", re.IGNORECASE),
    re.compile(r"\bmaybe\b", re.IGNORECASE),
    re.compile(r"\bmight\b", re.IGNORECASE),
    re.compile(r"\btry to\b", re.IGNORECASE),
    re.compile(r"\bif\b.{0,40}\bthen\b", re.IGNORECASE),
    re.compile(r"\bshould\b", re.IGNORECASE),
    re.compile(r"\bhopefully\b", re.IGNORECASE),
]


def _classify_commitments(entities: list[dict]) -> list[dict]:
    """Classify action item commitment types using pattern matching on source quotes."""
    for e in entities:
        if e["type"] != "action_item":
            continue
        props = e.get("properties", {})
        if props.get("commitment_type") and props["commitment_type"] != "unknown":
            continue  # Already classified by LLM, don't override

        quote = props.get("source_quote", "") or ""
        content = e.get("content", "")
        text = quote if quote else content

        commitment_type = "unknown"

        # Check volunteered first (strongest signal)
        for pattern in _VOLUNTEERED_PATTERNS:
            if pattern.search(text):
                commitment_type = "volunteered"
                break

        # Check assigned (overrides volunteered if both present — "Can you" is stronger)
        if commitment_type != "volunteered":
            for pattern in _ASSIGNED_PATTERNS:
                if pattern.search(text):
                    commitment_type = "assigned"
                    break

        # Check conditional (overrides volunteered — hedging weakens commitment)
        if commitment_type == "volunteered":
            for pattern in _CONDITIONAL_PATTERNS:
                if pattern.search(text):
                    commitment_type = "conditional"
                    break

        # If no volunteered but conditional patterns found
        if commitment_type == "unknown":
            for pattern in _CONDITIONAL_PATTERNS:
                if pattern.search(text):
                    commitment_type = "conditional"
                    break

        e.setdefault("properties", {})["commitment_type"] = commitment_type

    return entities


def _build_relationships_from_entities(entities: list[dict]) -> list[dict]:
    """Build relationship edges deterministically from entity properties."""
    edges = []

    # Build person name → short_id lookup
    person_ids: dict[str, str] = {}
    for e in entities:
        if e["type"] == "person":
            person_ids[e["content"].strip().lower()] = e["short_id"]

    def _find_person_id(name: str) -> str | None:
        """Find person entity by name (case-insensitive, partial match)."""
        if not name:
            return None
        name_lower = name.strip().lower()
        # Exact match
        if name_lower in person_ids:
            return person_ids[name_lower]
        # Partial match: "Cody" matches "Cody Hayashi"
        for full_name, sid in person_ids.items():
            if name_lower in full_name or full_name in name_lower:
                return sid
        return None

    for e in entities:
        props = e.get("properties", {})

        if e["type"] == "decision":
            person_sid = _find_person_id(props.get("made_by", ""))
            if person_sid:
                edges.append({"source": person_sid, "edge_type": "DECIDED", "target": e["short_id"]})

        elif e["type"] == "action_item":
            person_sid = _find_person_id(props.get("owner", ""))
            if person_sid:
                edges.append({"source": person_sid, "edge_type": "OWNS", "target": e["short_id"]})

        elif e["type"] == "risk":
            person_sid = _find_person_id(props.get("raised_by", ""))
            if person_sid:
                edges.append({"source": person_sid, "edge_type": "RAISED", "target": e["short_id"]})

    # Link speakers to topics they discussed (via source_quote_speaker)
    for e in entities:
        if e["type"] == "topic":
            continue
        speaker = e.get("properties", {}).get("source_quote_speaker", "")
        if speaker:
            person_sid = _find_person_id(speaker)
            if person_sid:
                # Find related topics (by keyword overlap in content)
                for t in entities:
                    if t["type"] == "topic":
                        topic_words = set(t["content"].lower().split())
                        content_words = set(e["content"].lower().split())
                        if topic_words & content_words:
                            edges.append({"source": person_sid, "edge_type": "DISCUSSED", "target": t["short_id"]})

    return edges


_ACTION_VERB_PATTERNS = [
    re.compile(r"\bneed(?:s)? to\b", re.IGNORECASE),
    re.compile(r"\bshould\b", re.IGNORECASE),
    re.compile(r"\bwill have to\b", re.IGNORECASE),
    re.compile(r"\bmust\b", re.IGNORECASE),
    re.compile(r"\bhas to\b", re.IGNORECASE),
    re.compile(r"\btask(?:ed)?\b", re.IGNORECASE),
    re.compile(r"\bset up\b", re.IGNORECASE),
    re.compile(r"\bsubmit\b", re.IGNORECASE),
    re.compile(r"\bcomplete\b", re.IGNORECASE),
    re.compile(r"\bfinish\b", re.IGNORECASE),
    re.compile(r"\bprepare\b", re.IGNORECASE),
]


def _correct_entity_types(entities: list[dict]) -> list[dict]:
    """Reclassify mistyped entities using heuristics. Conservative — only on strong signal."""
    for e in entities:
        if e["type"] == "decision":
            props = e.get("properties", {})
            made_by = props.get("made_by", "")
            content = e["content"]

            # A "decision" with no attribution and action verb patterns → action_item
            if not made_by or not made_by.strip():
                action_score = sum(1 for p in _ACTION_VERB_PATTERNS if p.search(content))
                if action_score >= 1:
                    logger.info("Reclassified decision -> action_item: '%s' (action_score=%d)",
                                content[:60], action_score)
                    e["type"] = "action_item"

        elif e["type"] == "risk":
            content = e["content"]
            # A "risk" that reads like a task
            action_score = sum(1 for p in _ACTION_VERB_PATTERNS if p.search(content))
            if action_score >= 2:  # Stricter for risk → action_item
                logger.info("Reclassified risk -> action_item: '%s' (action_score=%d)",
                            content[:60], action_score)
                e["type"] = "action_item"

    return entities


# --- Code-based Assembly (replaces LLM Pass 3) ---

def _assemble_review_from_entities(entities: list[dict], edges: list[dict]) -> dict:
    """Build the final review JSON directly from entities and edges. No LLM needed."""
    decisions = []
    action_items = []
    risks = []
    participants = []

    for e in entities:
        props = e.get("properties", {})

        if e["type"] == "person":
            if props.get("was_present", True):
                participants.append(e["content"])

        elif e["type"] == "decision":
            made_by = props.get("made_by")
            # Ensure made_by is None if empty, never empty string
            if made_by and not made_by.strip():
                made_by = None
            decisions.append({
                "id": f"D{len(decisions) + 1}",
                "description": e["content"],
                "decision_type": props.get("decision_type", "emergent"),
                "made_by": made_by,
                "confidence": props.get("confidence", "medium"),
                "confidence_rationale": props.get("confidence_rationale", ""),
                "source_quote": props.get("source_quote", ""),
                "source_quote_speaker": props.get("source_quote_speaker", ""),
                "source_start": e.get("chunk_start"),
                "source_end": e.get("chunk_end"),
            })

        elif e["type"] == "action_item":
            owner = props.get("owner")
            if owner and not owner.strip():
                owner = "Unassigned"
            action_items.append({
                "id": f"A{len(action_items) + 1}",
                "task": e["content"],
                "owner": owner or "Unassigned",
                "deadline": props.get("deadline"),
                "commitment_type": props.get("commitment_type", "unknown"),
                "confidence": props.get("confidence", "medium"),
                "confidence_rationale": props.get("confidence_rationale", ""),
                "source_quote": props.get("source_quote", ""),
                "source_quote_speaker": props.get("source_quote_speaker", ""),
                "source_start": e.get("chunk_start"),
                "source_end": e.get("chunk_end"),
            })

        elif e["type"] == "risk":
            raised_by = props.get("raised_by")
            if raised_by and not raised_by.strip():
                raised_by = None
            risks.append({
                "id": f"R{len(risks) + 1}",
                "description": e["content"],
                "raised_by": raised_by,
                "severity": props.get("severity", "medium"),
                "source_quote": props.get("source_quote", ""),
                "source_quote_speaker": props.get("source_quote_speaker", ""),
                "source_start": e.get("chunk_start"),
                "source_end": e.get("chunk_end"),
            })

    return {
        "meeting_metadata": {
            "title": None,  # Filled by small LLM call
            "date_mentioned": None,
            "participants": participants,
            "duration_estimate": None,
        },
        "decisions": decisions,
        "action_items": action_items,
        "open_risks": risks,
        "state_of_direction": "",  # Filled by small LLM call
        "trust_flags": [],
    }


def _generate_summary(review: dict, provider: str = None) -> dict:
    """Small LLM call: generate title + state_of_direction from assembled review."""
    decisions_text = "\n".join(
        f"- {d['description']}" for d in review.get("decisions", [])
    ) or "(none)"
    actions_text = "\n".join(
        f"- {a['task']} (owner: {a.get('owner', '?')})" for a in review.get("action_items", [])
    ) or "(none)"
    risks_text = "\n".join(
        f"- {r['description']}" for r in review.get("open_risks", [])
    ) or "(none)"
    participants = ", ".join(review.get("meeting_metadata", {}).get("participants", []))

    prompt = SUMMARY_PROMPT_TEMPLATE.format(
        decisions=decisions_text,
        action_items=actions_text,
        risks=risks_text,
        participants=participants,
    )

    try:
        result = generate(prompt, provider=provider, system_prompt=SUMMARY_SYSTEM_PROMPT)
        if result.get("title"):
            review["meeting_metadata"]["title"] = result["title"]
        if result.get("state_of_direction"):
            review["state_of_direction"] = result["state_of_direction"]
    except Exception:
        logger.exception("Summary generation failed, using fallback title")
        # Fallback: use first decision or first topic as title
        if review["decisions"]:
            review["meeting_metadata"]["title"] = review["decisions"][0]["description"][:60]
        else:
            review["meeting_metadata"]["title"] = "Meeting Analysis"

    return review


# --- Pipeline ---

def run_extraction_pipeline(
    meeting_id: str,
    raw_transcript: str,
    provider: str = None,
    output_schema: str = None,
    progress_callback: callable = None,
) -> dict:
    """Run the full 3-pass extraction pipeline.

    Returns the review JSON (same shape as ai_output_json) and populates
    the knowledge graph in SQLite.

    Falls back to single-shot analyze_transcript() if the pipeline fails.
    """
    from llm_client import OUTPUT_SCHEMA
    if output_schema is None:
        output_schema = OUTPUT_SCHEMA

    kg = KnowledgeGraph()

    # Clear any existing graph for this meeting (reindex case)
    kg.clear_meeting(meeting_id)

    # Fix 4: Pre-extract speakers from transcript format (no LLM)
    known_speakers = _extract_speakers_from_transcript(raw_transcript)
    logger.info("Pre-extracted %d speakers from transcript format: %s", len(known_speakers), known_speakers)

    # Normalize transcript — single canonical text used for LLM, verification, and viewer
    clean_transcript = normalize_transcript(raw_transcript)

    try:
        # --- Pass 1: Entity Extraction ---
        if progress_callback:
            progress_callback("extracting_entities", 0.1, "Extracting entities from transcript...")
        logger.info("Pass 1: Extracting entities from meeting %s", meeting_id)
        chunks = chunk_transcript(clean_transcript)
        all_entities: list[dict] = []

        for chunk in chunks:
            prompt = ENTITY_PROMPT_TEMPLATE.format(chunk=chunk["text"])
            try:
                response = generate(prompt, provider=provider, system_prompt=ENTITY_SYSTEM_PROMPT)
                entities = parse_entity_response(response)
                # Attach chunk offset info — offsets into clean_transcript
                for e in entities:
                    e["chunk_start"] = chunk["start"]
                    e["chunk_end"] = chunk["end"]
                all_entities.extend(entities)
            except Exception:
                logger.exception("Pass 1 failed for chunk at position %d", chunk["start"])
                continue

        if not all_entities:
            logger.warning("Pass 1 produced zero entities, falling back to single-shot")
            if progress_callback:
                progress_callback("fallback", 0.5, "Using fallback analysis...")
            return _fallback_single_shot(raw_transcript, provider)

        # Verify source quotes against the clean transcript (same text LLM saw)
        all_entities = _verify_source_quotes(all_entities, clean_transcript)

        # Fix 1: Semantic dedup
        all_entities = _deduplicate_entities(all_entities)
        all_entities = assign_entity_ids(all_entities)

        # Fix 4: Mark person entities with was_present based on transcript speakers
        known_speakers_lower = {s.lower() for s in known_speakers}
        for e in all_entities:
            if e["type"] == "person":
                e.setdefault("properties", {})["was_present"] = (
                    e["content"].strip().lower() in known_speakers_lower
                )

        # --- Post-Processing (code-based, replaces LLM Pass 2) ---
        if progress_callback:
            progress_callback("building_relationships", 0.4, f"Processing {len(all_entities)} entities...")
        logger.info("Post-processing: type correction, commitment classification, relationships for meeting %s", meeting_id)

        # Step 1: Correct mistyped entities
        all_entities = _correct_entity_types(all_entities)

        # Step 2: Classify commitment types for action items
        all_entities = _classify_commitments(all_entities)

        # Step 3: Build relationships from entity properties
        all_edges = _build_relationships_from_entities(all_entities)
        valid_short_ids = {e["short_id"] for e in all_entities}
        all_edges = validate_edges(all_edges, valid_short_ids)

        # Store entities in graph
        entity_id_map = {}  # short_id -> graph node_id
        counters: dict[str, int] = {}

        for e in all_entities:
            etype = e["type"]
            if etype == "person":
                node_id = kg.find_or_create_person(e["content"])
            elif etype == "topic":
                node_id = kg.find_or_create_topic(e["content"])
            else:
                counters[etype] = counters.get(etype, 0) + 1
                node_id = kg.add_meeting_entity(
                    meeting_id, etype, e["content"], counters[etype],
                    properties=e.get("properties"),
                    source_start=e.get("chunk_start"),
                    source_end=e.get("chunk_end"),
                )
            entity_id_map[e["short_id"]] = node_id

        # Store transcript chunks
        for i, chunk in enumerate(chunks):
            kg.add_transcript_chunk(meeting_id, i, chunk["text"],
                                    source_start=chunk["start"], source_end=chunk["end"])

        # Store edges in graph
        for edge in all_edges:
            src_graph_id = entity_id_map.get(edge["source"])
            tgt_graph_id = entity_id_map.get(edge["target"])
            if src_graph_id and tgt_graph_id:
                kg.add_edge(src_graph_id, tgt_graph_id, edge["edge_type"], meeting_id)

        # --- Assembly + Summary (code-based, replaces LLM Pass 3) ---
        if progress_callback:
            progress_callback("synthesizing", 0.7, "Assembling meeting analysis...")
        logger.info("Assembly: building review JSON for meeting %s", meeting_id)

        review_output = _assemble_review_from_entities(all_entities, all_edges)

        # One small LLM call for title + state_of_direction
        if progress_callback:
            progress_callback("summarizing", 0.85, "Generating summary...")
        review_output = _generate_summary(review_output, provider=provider)

        # Add trust flags as post-processing
        review_output = _add_trust_flags(review_output, clean_transcript, all_entities)

        if progress_callback:
            progress_callback("complete", 1.0, "Analysis complete")
        logger.info("Pipeline complete for meeting %s: %d nodes, %d edges",
                     meeting_id, len(subgraph["nodes"]), len(subgraph["edges"]))

        # Include the normalized transcript so the viewer shows the same text
        # that the LLM saw (and that source_start/source_end point into)
        review_output["_clean_transcript"] = clean_transcript

        return review_output

    except Exception:
        logger.exception("Pipeline failed entirely for meeting %s, falling back to single-shot", meeting_id)
        if progress_callback:
            progress_callback("fallback", 0.5, "Using fallback analysis...")
        return _fallback_single_shot(raw_transcript, provider)


def _fallback_single_shot(raw_transcript: str, provider: str = None) -> dict:
    """Fall back to the existing single-shot analyze_transcript."""
    from transcript_parser import parse_transcript
    utterances = parse_transcript(raw_transcript)
    return analyze_transcript(utterances, provider=provider)


def _assemble_review_from_graph(subgraph: dict) -> dict:
    """Build a minimal review JSON directly from graph nodes when Pass 3 fails."""
    decisions = []
    action_items = []
    risks = []
    participants = []

    for node in subgraph["nodes"]:
        props = node.get("properties", {})
        if node["node_type"] == "decision":
            decisions.append({
                "id": f"D{len(decisions) + 1}",
                "description": node["content"],
                "decision_type": props.get("decision_type", "emergent"),
                "made_by": props.get("made_by", "Unknown"),
                "confidence": props.get("confidence", "medium"),
                "confidence_rationale": "Assembled from knowledge graph",
                "source_quote": "",
            })
        elif node["node_type"] == "action_item":
            action_items.append({
                "id": f"A{len(action_items) + 1}",
                "task": node["content"],
                "owner": props.get("owner", "Unassigned"),
                "deadline": props.get("deadline"),
                "commitment_type": props.get("commitment_type", "unknown"),
                "confidence": props.get("confidence", "medium"),
                "confidence_rationale": "Assembled from knowledge graph",
                "source_quote": "",
            })
        elif node["node_type"] == "risk":
            risks.append({
                "id": f"R{len(risks) + 1}",
                "description": node["content"],
                "raised_by": props.get("raised_by", "Unknown"),
                "severity": props.get("severity", "medium"),
                "source_quote": "",
            })
        elif node["node_type"] == "person":
            participants.append(node["content"])

    return {
        "meeting_metadata": {
            "title": "Meeting Analysis",
            "date_mentioned": None,
            "participants": participants,
            "duration_estimate": None,
        },
        "decisions": decisions,
        "action_items": action_items,
        "open_risks": risks,
        "state_of_direction": "",
        "trust_flags": ["Analysis assembled from knowledge graph (Pass 3 synthesis failed)"],
    }
