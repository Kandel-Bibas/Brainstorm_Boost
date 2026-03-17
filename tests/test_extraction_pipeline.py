import pytest
from extraction_pipeline import (
    chunk_transcript, parse_entity_response, parse_relationship_response,
    parse_resolution_response, assign_entity_ids, validate_edges,
    _split_by_speaker_turns, _chunk_by_words, _chunk_by_turns,
    _verify_source_quotes, _add_trust_flags, _extract_speakers_from_transcript,
)


def test_chunk_transcript_short():
    """Short text without speaker patterns falls back to word chunking — single chunk."""
    text = "Hello world this is a short transcript"
    chunks = chunk_transcript(text, chunk_size=100, overlap=20)
    assert len(chunks) == 1
    assert chunks[0]["text"] == text


def test_chunk_transcript_long():
    """Long text without speaker patterns falls back to word chunking — multiple chunks."""
    words = ["word"] * 200
    text = " ".join(words)
    chunks = chunk_transcript(text, chunk_size=50, overlap=10)
    assert len(chunks) > 1
    # Chunks should overlap
    assert chunks[0]["end"] > chunks[1]["start"] or len(chunks) == 1


def test_chunk_transcript_speaker_turns():
    """Text with speaker turn patterns should use speaker-turn chunking."""
    lines = []
    for i in range(6):
        lines.append(f"Speaker{i}: This is a statement from speaker {i} about something.")
    text = "\n".join(lines)
    chunks = chunk_transcript(text)
    # Should detect >= 3 speaker turns and use turn-based chunking
    assert len(chunks) >= 1
    assert chunks[0]["start"] == 0


def test_split_by_speaker_turns():
    """Test speaker turn detection from various formats."""
    text = """Alice: I think we should use the new framework.
Bob: That sounds good, let me check the timeline.
Charlie: I have concerns about the budget."""
    turns = _split_by_speaker_turns(text)
    assert len(turns) == 3
    assert turns[0]["speaker"] == "Alice"
    assert turns[1]["speaker"] == "Bob"
    assert turns[2]["speaker"] == "Charlie"


def test_split_by_speaker_turns_otter_format():
    """Test speaker turn detection from Otter format."""
    text = """Alice  0:00
Hello everyone, let's get started.

Bob  0:15
Sure, I have the updates ready.

Charlie  0:30
Great, let me share my screen."""
    turns = _split_by_speaker_turns(text)
    assert len(turns) == 3
    assert turns[0]["speaker"] == "Alice"
    assert turns[1]["speaker"] == "Bob"


def test_split_by_speaker_turns_no_speakers():
    """No speaker patterns should return empty list."""
    text = "This is just a plain paragraph with no speaker formatting at all."
    turns = _split_by_speaker_turns(text)
    assert len(turns) == 0


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


def test_parse_resolution_response():
    """Test parsing the new resolution format from Pass 2."""
    response = {
        "duplicates": [{"keep": "E1", "remove": "E5", "reason": "same decision rephrased"}],
        "commitment_updates": [{"entity_id": "E4", "commitment_type": "volunteered"}],
        "type_corrections": [{"entity_id": "E3", "current_type": "decision", "correct_type": "action_item", "reason": "task"}],
        "relationships": [
            {"source": "E1", "edge_type": "DECIDED", "target": "E2"},
        ],
    }
    result = parse_resolution_response(response)
    assert len(result["duplicates"]) == 1
    assert result["duplicates"][0]["remove"] == "E5"
    assert len(result["commitment_updates"]) == 1
    assert result["commitment_updates"][0]["commitment_type"] == "volunteered"
    assert len(result["type_corrections"]) == 1
    assert result["type_corrections"][0]["correct_type"] == "action_item"
    assert len(result["relationships"]) == 1


def test_parse_resolution_response_empty():
    """Resolution response with missing keys should default to empty lists."""
    result = parse_resolution_response({})
    assert result["duplicates"] == []
    assert result["commitment_updates"] == []
    assert result["type_corrections"] == []
    assert result["relationships"] == []


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


def test_verify_source_quotes_verified():
    """Quotes that exist in transcript should be marked verified."""
    transcript = "Let's go with lithium-polymer batteries for the prototype."
    entities = [
        {
            "type": "decision",
            "content": "Use lithium-polymer batteries",
            "source_quote": "go with lithium-polymer batteries",
        },
    ]
    result = _verify_source_quotes(entities, transcript)
    assert result[0]["properties"]["quote_verified"] is True
    assert result[0]["properties"]["source_quote"] == "go with lithium-polymer batteries"


def test_verify_source_quotes_unverified():
    """Quotes not in transcript should be marked unverified."""
    transcript = "We discussed the budget for next quarter."
    entities = [
        {
            "type": "decision",
            "content": "Increase the budget",
            "source_quote": "this quote does not exist in the transcript at all",
        },
    ]
    result = _verify_source_quotes(entities, transcript)
    assert result[0]["properties"]["quote_verified"] is False


def test_verify_source_quotes_short_quote():
    """Very short quotes (<=10 chars) are too generic to verify, marked False."""
    transcript = "Short text here."
    entities = [
        {
            "type": "decision",
            "content": "Something",
            "source_quote": "short",
        },
    ]
    result = _verify_source_quotes(entities, transcript)
    # Short quotes cannot be reliably verified, so they are marked unverified
    assert result[0]["properties"]["quote_verified"] is False


def test_verify_source_quotes_no_quote():
    """Entities without source_quote should pass through unchanged."""
    transcript = "Some transcript text."
    entities = [
        {"type": "person", "content": "Alice"},
    ]
    result = _verify_source_quotes(entities, transcript)
    assert "properties" not in result[0] or "quote_verified" not in result[0].get("properties", {})


def test_add_trust_flags_small_meeting():
    """Small meetings should get a trust flag."""
    review = {
        "meeting_metadata": {"participants": ["Alice", "Bob"]},
        "decisions": [],
        "action_items": [],
    }
    result = _add_trust_flags(review, "short transcript", [])
    assert any("Small meeting" in f for f in result["trust_flags"])


def test_add_trust_flags_short_transcript():
    """Short transcripts should get a trust flag."""
    review = {
        "meeting_metadata": {"participants": ["Alice", "Bob", "Charlie"]},
        "decisions": [],
        "action_items": [],
    }
    short_text = " ".join(["word"] * 100)
    result = _add_trust_flags(review, short_text, [])
    assert any("Short transcript" in f for f in result["trust_flags"])


def test_add_trust_flags_low_confidence():
    """Low-confidence items should be flagged."""
    review = {
        "meeting_metadata": {"participants": ["Alice", "Bob", "Charlie"]},
        "decisions": [{"confidence": "low"}, {"confidence": "high"}],
        "action_items": [{"confidence": "low"}],
    }
    long_text = " ".join(["word"] * 600)
    result = _add_trust_flags(review, long_text, [])
    assert any("low confidence" in f for f in result["trust_flags"])


def test_add_trust_flags_unverified_quotes():
    """Unverified quotes should be flagged."""
    review = {
        "meeting_metadata": {"participants": ["Alice", "Bob", "Charlie"]},
        "decisions": [],
        "action_items": [],
    }
    entities = [
        {"properties": {"quote_verified": False}},
        {"properties": {"quote_verified": True}},
        {"properties": {"quote_verified": False}},
    ]
    long_text = " ".join(["word"] * 600)
    result = _add_trust_flags(review, long_text, entities)
    assert any("2 source quote" in f for f in result["trust_flags"])


def test_add_trust_flags_clean():
    """A well-formed meeting should have no trust flags."""
    review = {
        "meeting_metadata": {"participants": ["Alice", "Bob", "Charlie"]},
        "decisions": [{"confidence": "high"}],
        "action_items": [{"confidence": "high"}],
    }
    long_text = " ".join(["word"] * 600)
    result = _add_trust_flags(review, long_text, [])
    assert result["trust_flags"] == []


def test_extract_speakers_otter():
    """Should extract speakers from Otter format."""
    transcript = """Alice  0:00
Hello everyone.

Bob  0:15
Hi Alice."""
    speakers = _extract_speakers_from_transcript(transcript)
    assert "Alice" in speakers
    assert "Bob" in speakers


def test_extract_speakers_vtt_voice():
    """Should extract speakers from VTT voice tags."""
    transcript = '<v Alice Smith>Hello everyone</v>\n<v Bob Jones>Hi there</v>'
    speakers = _extract_speakers_from_transcript(transcript)
    assert "Alice Smith" in speakers
    assert "Bob Jones" in speakers


def test_extract_speakers_generic_colon():
    """Should extract speakers from 'Name: text' format."""
    transcript = """Alice: I think we should proceed.
Bob: Agreed, let's do it."""
    speakers = _extract_speakers_from_transcript(transcript)
    assert "Alice" in speakers
    assert "Bob" in speakers


def test_extract_speakers_empty():
    """Plain text with no speaker patterns should return empty set."""
    transcript = "This is just a plain paragraph with no speakers."
    speakers = _extract_speakers_from_transcript(transcript)
    assert len(speakers) == 0
