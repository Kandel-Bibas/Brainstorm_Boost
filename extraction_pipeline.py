"""3-pass LLM extraction pipeline for building knowledge graphs from meeting transcripts."""
from __future__ import annotations

import json
import logging
from typing import Any

from knowledge_graph import KnowledgeGraph
from llm_client import generate, analyze_transcript

logger = logging.getLogger(__name__)

# --- Prompts ---

ENTITY_SYSTEM_PROMPT = """You are an entity extraction system. You identify people, topics, decisions, action items, and risks from meeting transcripts. Return structured JSON only."""

RELATIONSHIP_SYSTEM_PROMPT = """You are a relationship extraction system. Given a list of numbered entities from a meeting, you identify how they are connected. Return structured JSON only."""

SYNTHESIS_SYSTEM_PROMPT = """You are a meeting analyst. Given a structured knowledge graph of a meeting, you produce a comprehensive meeting analysis. Return structured JSON only."""

ENTITY_PROMPT_TEMPLATE = """Extract ALL entities from this meeting transcript segment.

TRANSCRIPT SEGMENT:
{chunk}

Entity types to extract:
- person: participant names
- topic: subjects being discussed
- decision: things that were decided (explicit or emergent)
- action_item: tasks someone committed to do (include owner, deadline if mentioned)
- risk: concerns, blockers, potential problems raised

Return JSON (no markdown fencing):
{{"entities": [
  {{"type": "person", "content": "name"}},
  {{"type": "topic", "content": "topic description"}},
  {{"type": "decision", "content": "what was decided", "properties": {{"confidence": "high|medium|low"}}}},
  {{"type": "action_item", "content": "task description", "properties": {{"owner": "name", "deadline": "when", "confidence": "high|medium|low"}}}},
  {{"type": "risk", "content": "concern description", "properties": {{"severity": "high|medium|low", "raised_by": "name"}}}}
]}}"""

RELATIONSHIP_PROMPT_TEMPLATE = """Identify relationships between these numbered entities from a meeting.

ENTITIES (use ONLY these IDs):
{entity_list}

TRANSCRIPT CONTEXT:
{context}

Relationship types:
- DECIDED: person → decision
- RATIFIED: person → decision (confirmed/agreed)
- OWNS: person → action_item
- RAISED: person → risk
- DISCUSSED: person → topic
- DEPENDS_ON: action_item → action_item
- RELATES_TO: any → any (general connection)

Return JSON (no markdown fencing):
{{"relationships": [
  {{"source": "E1", "edge_type": "DECIDED", "target": "E3"}}
]}}

IMPORTANT: Use ONLY the entity IDs listed above. Do not invent new IDs."""

SYNTHESIS_PROMPT_TEMPLATE = """Produce a structured meeting analysis from this knowledge graph.

KNOWLEDGE GRAPH:
{graph_text}

Return JSON matching this schema (no markdown fencing):
{schema}

Use ONLY information present in the knowledge graph. Every item must trace back to a graph node."""


# --- Chunking ---

def chunk_transcript(text: str, chunk_size: int = 500, overlap: int = 100) -> list[dict]:
    """Split transcript into overlapping chunks by word count. Returns list of {text, start, end}."""
    words = text.split()
    if len(words) <= chunk_size:
        return [{"text": text, "start": 0, "end": len(text)}]

    chunks = []
    word_start = 0
    char_pos = 0

    while word_start < len(words):
        word_end = min(word_start + chunk_size, len(words))
        chunk_text = " ".join(words[word_start:word_end])

        # Approximate character positions
        start_char = text.find(words[word_start], char_pos) if word_start < len(words) else len(text)
        end_char = start_char + len(chunk_text)

        chunks.append({"text": chunk_text, "start": start_char, "end": end_char})

        char_pos = start_char
        word_start += chunk_size - overlap

    return chunks


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


def parse_relationship_response(response: dict) -> list[dict]:
    """Parse relationship extraction response."""
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


# --- Pipeline ---

def run_extraction_pipeline(
    meeting_id: str,
    raw_transcript: str,
    provider: str = None,
    output_schema: str = None,
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

    try:
        # --- Pass 1: Entity Extraction ---
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
            return _fallback_single_shot(raw_transcript, provider)

        # Deduplicate persons and topics
        all_entities = _deduplicate_entities(all_entities)
        all_entities = assign_entity_ids(all_entities)

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

        # --- Pass 2: Relationship Extraction ---
        logger.info("Pass 2: Extracting relationships for meeting %s", meeting_id)
        valid_short_ids = {e["short_id"] for e in all_entities}

        # Batch entities into groups of ~30
        batch_size = 30
        all_edges: list[dict] = []
        for batch_start in range(0, len(all_entities), batch_size):
            batch = all_entities[batch_start:batch_start + batch_size]
            entity_list = _format_entity_list(batch)

            # Use relevant transcript context for this batch
            context = raw_transcript[:3000]  # First 3000 chars as context

            prompt = RELATIONSHIP_PROMPT_TEMPLATE.format(
                entity_list=entity_list, context=context
            )
            try:
                response = generate(prompt, provider=provider, system_prompt=RELATIONSHIP_SYSTEM_PROMPT)
                edges = parse_relationship_response(response)
                edges = validate_edges(edges, valid_short_ids)
                all_edges.extend(edges)
            except Exception:
                logger.exception("Pass 2 failed for entity batch starting at %d", batch_start)
                continue

        # Store edges in graph
        for edge in all_edges:
            src_graph_id = entity_id_map.get(edge["source"])
            tgt_graph_id = entity_id_map.get(edge["target"])
            if src_graph_id and tgt_graph_id:
                kg.add_edge(src_graph_id, tgt_graph_id, edge["edge_type"], meeting_id)

        # --- Pass 3: Review Synthesis ---
        logger.info("Pass 3: Synthesizing review for meeting %s", meeting_id)
        subgraph = kg.get_meeting_subgraph(meeting_id)
        graph_text = kg.serialize_subgraph_for_prompt(subgraph)

        prompt = SYNTHESIS_PROMPT_TEMPLATE.format(graph_text=graph_text, schema=output_schema)
        try:
            review_output = generate(prompt, provider=provider, system_prompt=SYNTHESIS_SYSTEM_PROMPT)
        except Exception:
            logger.exception("Pass 3 failed, assembling minimal review from graph")
            review_output = _assemble_review_from_graph(subgraph)

        logger.info("Pipeline complete for meeting %s: %d nodes, %d edges",
                     meeting_id, len(subgraph["nodes"]), len(subgraph["edges"]))
        return review_output

    except Exception:
        logger.exception("Pipeline failed entirely for meeting %s, falling back to single-shot", meeting_id)
        return _fallback_single_shot(raw_transcript, provider)


def _deduplicate_entities(entities: list[dict]) -> list[dict]:
    """Deduplicate by type + normalized content."""
    seen = set()
    unique = []
    for e in entities:
        key = (e["type"], e["content"].strip().lower())
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return unique


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
