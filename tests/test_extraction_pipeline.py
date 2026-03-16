import pytest
from extraction_pipeline import (
    chunk_transcript, parse_entity_response, parse_relationship_response,
    assign_entity_ids, validate_edges,
)


def test_chunk_transcript_short():
    text = "Hello world this is a short transcript"
    chunks = chunk_transcript(text, chunk_size=100, overlap=20)
    assert len(chunks) == 1
    assert chunks[0]["text"] == text


def test_chunk_transcript_long():
    words = ["word"] * 200
    text = " ".join(words)
    chunks = chunk_transcript(text, chunk_size=50, overlap=10)
    assert len(chunks) > 1
    # Chunks should overlap
    assert chunks[0]["end"] > chunks[1]["start"] or len(chunks) == 1


def test_parse_entity_response_valid():
    response = {
        "entities": [
            {"type": "person", "content": "Alice", "start": 0, "end": 5},
            {"type": "decision", "content": "Use lithium", "start": 20, "end": 40,
             "properties": {"confidence": "high"}},
        ]
    }
    entities = parse_entity_response(response)
    assert len(entities) == 2
    assert entities[0]["type"] == "person"
    assert entities[1]["properties"]["confidence"] == "high"


def test_parse_entity_response_filters_empty():
    response = {
        "entities": [
            {"type": "person", "content": "", "start": 0, "end": 0},
            {"type": "decision", "content": "Valid decision", "start": 10, "end": 30},
        ]
    }
    entities = parse_entity_response(response)
    assert len(entities) == 1


def test_assign_entity_ids():
    entities = [
        {"type": "person", "content": "Alice"},
        {"type": "decision", "content": "Use lithium"},
        {"type": "person", "content": "Bob"},
    ]
    labeled = assign_entity_ids(entities)
    assert labeled[0]["short_id"] == "E1"
    assert labeled[1]["short_id"] == "E2"
    assert labeled[2]["short_id"] == "E3"


def test_parse_relationship_response():
    response = {
        "relationships": [
            {"source": "E1", "edge_type": "DECIDED", "target": "E2"},
            {"source": "E3", "edge_type": "OWNS", "target": "E4"},
        ]
    }
    edges = parse_relationship_response(response)
    assert len(edges) == 2
    assert edges[0]["source"] == "E1"
    assert edges[0]["edge_type"] == "DECIDED"


def test_validate_edges_filters_invalid():
    valid_ids = {"E1", "E2", "E3"}
    edges = [
        {"source": "E1", "edge_type": "DECIDED", "target": "E2"},
        {"source": "E1", "edge_type": "OWNS", "target": "E99"},  # E99 doesn't exist
        {"source": "E5", "edge_type": "RAISED", "target": "E2"},  # E5 doesn't exist
    ]
    valid = validate_edges(edges, valid_ids)
    assert len(valid) == 1
    assert valid[0]["target"] == "E2"
