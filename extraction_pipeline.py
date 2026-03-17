"""3-pass LLM extraction pipeline for building knowledge graphs from meeting transcripts."""
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

RESOLUTION_SYSTEM_PROMPT = """You are a meeting analysis reviewer. You clean, enrich, and connect entities extracted from meeting transcripts. You identify duplicates, classify commitment types, correct entity types, and map relationships. Return structured JSON only."""

SYNTHESIS_SYSTEM_PROMPT = """You are a meeting analyst. Given a structured knowledge graph of a meeting, you produce a comprehensive meeting analysis. Return structured JSON only."""

ENTITY_PROMPT_TEMPLATE = """Extract ALL entities from this meeting transcript segment.

TRANSCRIPT SEGMENT:
{chunk}

Entity types to extract:
- person: participant names
- topic: subjects being discussed
- decision: things that were decided (explicit or emergent). Include WHO made/formulated the decision.
- action_item: tasks someone committed to do (include owner, deadline if mentioned)
- risk: concerns, blockers, potential problems raised

For each decision, action_item, and risk:
1. Include a source_quote with the EXACT words from the transcript. Copy verbatim — do not paraphrase.
2. Include the speaker name (who said it) in the source_quote_speaker field.
3. For decisions, always include made_by (who formulated/announced the decision).

Return JSON (no markdown fencing):
{{"entities": [
  {{"type": "person", "content": "name"}},
  {{"type": "topic", "content": "topic description"}},
  {{"type": "decision", "content": "what was decided", "properties": {{"confidence": "high|medium|low", "made_by": "person who made the decision", "decision_type": "explicit|emergent"}}, "source_quote": "exact words from transcript", "source_quote_speaker": "who said it"}},
  {{"type": "action_item", "content": "task description", "properties": {{"owner": "name", "deadline": "when", "confidence": "high|medium|low"}}, "source_quote": "exact words from transcript", "source_quote_speaker": "who said it"}},
  {{"type": "risk", "content": "concern description", "properties": {{"severity": "high|medium|low", "raised_by": "name"}}, "source_quote": "exact words from transcript", "source_quote_speaker": "who said it"}}
]}}"""

RESOLUTION_PROMPT_TEMPLATE = """You are reviewing and enriching entities extracted from a meeting transcript.

ENTITIES (use ONLY these IDs):
{entity_list}

TRANSCRIPT CONTEXT:
{context}

Perform these tasks:

1. FLAG DUPLICATES: List any entity pairs that are semantically the same thing.
2. CLASSIFY COMMITMENTS: For each action_item, determine:
   - commitment_type: "volunteered" (person offered), "assigned" (someone else directed them), "conditional" (hedged/qualified)
3. CORRECT TYPES: Flag any entity whose type seems wrong (e.g., a "decision" that is actually an observation or question).
4. IDENTIFY RELATIONSHIPS using these types:
   - DECIDED: person -> decision
   - RATIFIED: person -> decision
   - OWNS: person -> action_item
   - RAISED: person -> risk
   - DISCUSSED: person -> topic
   - DEPENDS_ON: action_item -> action_item
   - RELATES_TO: any -> any

Return JSON (no markdown fencing):
{{
  "duplicates": [{{"keep": "E1", "remove": "E5", "reason": "same decision rephrased"}}],
  "commitment_updates": [{{"entity_id": "E4", "commitment_type": "volunteered"}}],
  "type_corrections": [{{"entity_id": "E3", "current_type": "decision", "correct_type": "action_item", "reason": "this is a task, not a decision"}}],
  "relationships": [
    {{"source": "E1", "edge_type": "DECIDED", "target": "E3"}}
  ]
}}

IMPORTANT: Use ONLY the entity IDs listed above."""

SYNTHESIS_PROMPT_TEMPLATE = """Produce a structured meeting analysis from this knowledge graph.

KNOWLEDGE GRAPH:
{graph_text}

Return JSON matching this schema (no markdown fencing):
{schema}

Use ONLY information present in the knowledge graph. Every item must trace back to a graph node."""


# --- Chunking (Fix 7: Speaker-turn chunking) ---

def chunk_transcript(text: str, chunk_size: int = 500, overlap: int = 100) -> list[dict]:
    """Split transcript into chunks. Uses speaker turns if detected, falls back to word count."""
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
    """Group speaker turns into chunks of ~group_size turns."""
    chunks = []
    for i in range(0, len(turns), group_size):
        group = turns[i:i + group_size]
        text = "\n\n".join(t["text"] for t in group)
        chunks.append({
            "text": text,
            "start": group[0]["start"],
            "end": group[-1]["end"],
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

def _verify_source_quotes(entities: list[dict], raw_transcript: str) -> list[dict]:
    """Check each entity's source_quote exists in the transcript. Flag unverified ones."""
    transcript_lower = raw_transcript.lower()
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
                    # Fuzzy: check if any 5-word window exists in transcript
                    words = quote_lower.split()
                    if len(words) >= 5:
                        for i in range(len(words) - 4):
                            window = " ".join(words[i:i+5])
                            if window in transcript_lower:
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
    "decision": 0.75,
    "action_item": 0.80,
    "risk": 0.80,
}


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
                threshold = DEDUP_THRESHOLDS.get(etype, 0.80)
                if sim > threshold:
                    merged.add(j)
                    logger.info("Merged duplicate entities: '%s' ~ '%s' (sim=%.3f)",
                                group[i]["content"][:50], group[j]["content"][:50], sim)

    return unique


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

    try:
        # --- Pass 1: Entity Extraction ---
        if progress_callback:
            progress_callback("extracting_entities", 0.1, "Extracting entities from transcript...")
        logger.info("Pass 1: Extracting entities from meeting %s", meeting_id)
        chunks = chunk_transcript(raw_transcript)
        all_entities: list[dict] = []

        for chunk in chunks:
            prompt = ENTITY_PROMPT_TEMPLATE.format(chunk=chunk["text"])
            try:
                response = generate(prompt, provider=provider, system_prompt=ENTITY_SYSTEM_PROMPT)
                entities = parse_entity_response(response)
                # Attach chunk offset info
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

        # Fix 2/9: Verify source quotes programmatically
        all_entities = _verify_source_quotes(all_entities, raw_transcript)

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

        # --- Pass 2: Structured Resolution (Fix 8) ---
        if progress_callback:
            progress_callback("building_relationships", 0.4, f"Building relationships between {len(all_entities)} entities...")
        logger.info("Pass 2: Resolution and relationships for meeting %s", meeting_id)
        valid_short_ids = {e["short_id"] for e in all_entities}

        # Batch entities into groups of ~30
        batch_size = 30
        all_edges: list[dict] = []
        all_duplicates: list[dict] = []
        all_commitment_updates: list[dict] = []
        all_type_corrections: list[dict] = []

        for batch_start in range(0, len(all_entities), batch_size):
            batch = all_entities[batch_start:batch_start + batch_size]
            entity_list = _format_entity_list(batch)

            # Fix 3: Use entity chunks, not hardcoded [:3000]
            chunk_ranges = set()
            for entity in batch:
                cs = entity.get("chunk_start")
                ce = entity.get("chunk_end")
                if cs is not None and ce is not None:
                    chunk_ranges.add((cs, ce))

            if chunk_ranges:
                sorted_ranges = sorted(chunk_ranges)
                context_parts = []
                for start, end in sorted_ranges:
                    context_parts.append(raw_transcript[start:end])
                context = "\n...\n".join(context_parts)
            else:
                context = raw_transcript[:3000]  # fallback

            prompt = RESOLUTION_PROMPT_TEMPLATE.format(
                entity_list=entity_list, context=context
            )
            try:
                response = generate(prompt, provider=provider, system_prompt=RESOLUTION_SYSTEM_PROMPT)
                resolution = parse_resolution_response(response)

                edges = resolution["relationships"]
                edges = validate_edges(edges, valid_short_ids)
                all_edges.extend(edges)

                all_duplicates.extend(resolution["duplicates"])
                all_commitment_updates.extend(resolution["commitment_updates"])
                all_type_corrections.extend(resolution["type_corrections"])
            except Exception:
                logger.exception("Pass 2 failed for entity batch starting at %d", batch_start)
                continue

        # Apply duplicate merges from Pass 2 (backup to embedding dedup)
        ids_to_remove = set()
        for dup in all_duplicates:
            remove_id = dup.get("remove")
            if remove_id and remove_id in valid_short_ids:
                ids_to_remove.add(remove_id)
                logger.info("Pass 2 flagged duplicate: remove %s, keep %s (%s)",
                            remove_id, dup.get("keep"), dup.get("reason", ""))

        if ids_to_remove:
            all_entities = [e for e in all_entities if e["short_id"] not in ids_to_remove]
            valid_short_ids -= ids_to_remove

        # Apply commitment_type updates
        entity_by_id = {e["short_id"]: e for e in all_entities}
        for update in all_commitment_updates:
            eid = update.get("entity_id")
            if eid in entity_by_id:
                entity_by_id[eid].setdefault("properties", {})["commitment_type"] = update["commitment_type"]

        # Apply type corrections
        for correction in all_type_corrections:
            eid = correction.get("entity_id")
            if eid in entity_by_id:
                old_type = entity_by_id[eid]["type"]
                new_type = correction.get("correct_type")
                if new_type and new_type != old_type:
                    logger.info("Pass 2 corrected type for %s: %s -> %s (%s)",
                                eid, old_type, new_type, correction.get("reason", ""))
                    entity_by_id[eid]["type"] = new_type

        # Store edges in graph
        for edge in all_edges:
            src_graph_id = entity_id_map.get(edge["source"])
            tgt_graph_id = entity_id_map.get(edge["target"])
            if src_graph_id and tgt_graph_id:
                kg.add_edge(src_graph_id, tgt_graph_id, edge["edge_type"], meeting_id)

        # --- Pass 3: Review Synthesis ---
        if progress_callback:
            progress_callback("synthesizing", 0.7, "Synthesizing meeting analysis...")
        logger.info("Pass 3: Synthesizing review for meeting %s", meeting_id)
        subgraph = kg.get_meeting_subgraph(meeting_id)
        graph_text = kg.serialize_subgraph_for_prompt(subgraph)

        prompt = SYNTHESIS_PROMPT_TEMPLATE.format(graph_text=graph_text, schema=output_schema)
        try:
            review_output = generate(prompt, provider=provider, system_prompt=SYNTHESIS_SYSTEM_PROMPT)
        except Exception:
            logger.exception("Pass 3 failed, assembling minimal review from graph")
            review_output = _assemble_review_from_graph(subgraph)

        # Fix 6: Add trust flags as post-processing
        review_output = _add_trust_flags(review_output, raw_transcript, all_entities)

        if progress_callback:
            progress_callback("complete", 1.0, "Analysis complete")
        logger.info("Pipeline complete for meeting %s: %d nodes, %d edges",
                     meeting_id, len(subgraph["nodes"]), len(subgraph["edges"]))
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
