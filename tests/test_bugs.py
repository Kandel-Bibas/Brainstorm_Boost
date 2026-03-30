"""Tests that reproduce specific bugs before fixing them."""
import inspect

import pytest


# === Bug 1: generate() uses wrong system prompt for RAG and read-ahead ===

def test_general_system_prompt_exists():
    """GENERAL_SYSTEM_PROMPT constant should exist and differ from SYSTEM_PROMPT."""
    from llm_client import SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT
    assert "meeting analyst" in SYSTEM_PROMPT.lower()
    assert "meeting analyst" not in GENERAL_SYSTEM_PROMPT.lower()


def test_analyze_with_gemini_accepts_system_prompt():
    """_analyze_with_gemini should accept an optional system_prompt parameter."""
    from llm_client import _analyze_with_gemini
    sig = inspect.signature(_analyze_with_gemini)
    assert "system_prompt" in sig.parameters


def test_analyze_with_ollama_accepts_system_prompt():
    """_analyze_with_ollama should accept an optional system_prompt parameter."""
    from llm_client import _analyze_with_ollama
    sig = inspect.signature(_analyze_with_ollama)
    assert "system_prompt" in sig.parameters


# === Bug 3: shared embedding model ===

def test_shared_embedding_module_exists():
    """embeddings.py should provide a shared get_embedding_model function."""
    from embeddings import get_embedding_model
    assert callable(get_embedding_model)


def test_meeting_memory_uses_shared_embeddings():
    """meeting_memory should import from embeddings, not have its own singleton."""
    import meeting_memory
    # Should not have a module-level _embedding_model or _get_embedding_model
    assert not hasattr(meeting_memory, "_get_embedding_model"), \
        "meeting_memory should use shared embeddings module"


def test_live_session_uses_shared_embeddings():
    """live_session should import from embeddings, not have its own singleton."""
    import live_session
    assert not hasattr(live_session, "_get_embedding_model"), \
        "live_session should use shared embeddings module"


# === Bug 5: ChromaDB ID collision on None item IDs ===

def test_index_meeting_without_item_ids(tmp_path):
    """Items without IDs should not collide — both should be indexed."""
    from meeting_memory import MeetingMemory
    memory = MeetingMemory(persist_dir=str(tmp_path / "chroma_test"))
    output = {
        "meeting_metadata": {"title": "Test"},
        "decisions": [
            {"description": "Decision A", "source_quote": "quote A"},
            {"description": "Decision B", "source_quote": "quote B"},
        ],
        "action_items": [],
        "open_risks": [],
    }
    memory.index_meeting("m1", output)
    results = memory.query("decision")
    assert len(results) >= 2  # Both should be indexed, not overwritten


# === Bug 11: IdeaBoard O(1) lookup ===

def test_idea_board_has_ideas_by_id():
    """IdeaBoard should maintain an _ideas_by_id dict for O(1) lookup."""
    from idea_board import IdeaBoard
    board = IdeaBoard(session_id="test")
    idea_id = board.submit_idea("Test idea")
    assert hasattr(board, "_ideas_by_id")
    assert idea_id in board._ideas_by_id
    assert board._ideas_by_id[idea_id]["text"] == "Test idea"


# === Bug: made_by empty on assembled decisions ===

def test_made_by_preserved_in_assembly():
    """Decisions assembled from entities must preserve made_by from entity properties."""
    from extraction_pipeline import _assemble_review_from_entities

    entities = [
        {"short_id": "E1", "type": "person", "content": "Alice", "properties": {"was_present": True}},
        {"short_id": "E2", "type": "decision", "content": "Use React for the frontend",
         "properties": {"confidence": "high", "made_by": "Alice", "decision_type": "explicit",
                        "source_quote": "I think we should use React"}},
    ]
    edges = [{"source": "E1", "edge_type": "DECIDED", "target": "E2"}]

    result = _assemble_review_from_entities(entities, edges)
    assert len(result["decisions"]) == 1
    assert result["decisions"][0]["made_by"] == "Alice"


def test_made_by_not_shown_as_empty_string():
    """If made_by is genuinely unknown, it should be null — never an empty string."""
    from extraction_pipeline import _assemble_review_from_entities

    entities = [
        {"short_id": "E1", "type": "decision", "content": "Use Python",
         "properties": {"confidence": "medium"}},
    ]
    result = _assemble_review_from_entities(entities, [])
    made_by = result["decisions"][0]["made_by"]
    assert made_by is None or (isinstance(made_by, str) and len(made_by.strip()) > 0), \
        f"made_by should be None or a real name, got: {made_by!r}"


# === Bug: duplicate decisions not caught ===

def test_paraphrased_decisions_deduped(mock_embedding_model):
    """Two decisions that say the same thing in different words should be merged."""
    import numpy as np
    from extraction_pipeline import _deduplicate_entities

    # Make the mock return very similar vectors for the two decisions
    call_count = [0]
    original_encode = mock_embedding_model.encode

    def controlled_encode(texts, **kwargs):
        n = len(texts) if isinstance(texts, list) else 1
        vecs = np.ones((n, 384), dtype=np.float32)
        # Make all decision vectors nearly identical (cosine sim ~0.99)
        for i in range(n):
            vecs[i][0] += i * 0.01
        return vecs

    mock_embedding_model.encode = controlled_encode

    entities = [
        {"type": "decision", "content": "Only 4 people from Paige McNeil's team will be attending",
         "properties": {"confidence": "medium"}},
        {"type": "decision", "content": "The attendees will be the four people from the team",
         "properties": {"confidence": "medium"}},
    ]
    result = _deduplicate_entities(entities)
    assert len([e for e in result if e["type"] == "decision"]) == 1, \
        "Paraphrased decisions should be deduped into one"


# === Bug: over-extraction of action items ===

def test_same_owner_similar_actions_deduped(mock_embedding_model):
    """Action items with same owner and similar content should be merged."""
    import numpy as np
    from extraction_pipeline import _deduplicate_entities

    def controlled_encode(texts, **kwargs):
        n = len(texts) if isinstance(texts, list) else 1
        vecs = np.ones((n, 384), dtype=np.float32)
        for i in range(n):
            vecs[i][0] += i * 0.01
        return vecs

    mock_embedding_model.encode = controlled_encode

    entities = [
        {"type": "action_item", "content": "Check with Mark and Chris about their availability to meet with Paige and team in Hawaii",
         "properties": {"owner": "Cody", "confidence": "medium"}},
        {"type": "action_item", "content": "Check with Mark and Chris on their schedule",
         "properties": {"owner": "Cody", "confidence": "medium"}},
    ]
    result = _deduplicate_entities(entities)
    assert len([e for e in result if e["type"] == "action_item"]) == 1, \
        "Similar action items with same owner should be merged"


# === Bug: source quotes unverified due to strict matching ===

def test_source_quote_with_filler_words_verifies():
    """Source quotes should verify even when transcript has filler words (um, uh, like)."""
    from extraction_pipeline import _verify_source_quotes

    transcript = "I think we should, um, use the new framework for this project"
    entities = [
        {"type": "decision", "content": "Use new framework",
         "properties": {"source_quote": "I think we should use the new framework"}},
    ]
    result = _verify_source_quotes(entities, transcript)
    assert result[0]["properties"]["quote_verified"] is True, \
        "Quote should verify even when transcript has filler words"


def test_source_quote_with_4_word_window_verifies():
    """4-word sliding window should catch quotes that 5-word window misses."""
    from extraction_pipeline import _verify_source_quotes

    transcript = "we decided to go with the lithium battery option for drones"
    entities = [
        {"type": "decision", "content": "Use lithium batteries",
         "properties": {"source_quote": "decided to go with lithium battery option"}},
    ]
    result = _verify_source_quotes(entities, transcript)
    assert result[0]["properties"]["quote_verified"] is True


# === New code functions should exist ===

def test_classify_commitments_exists():
    """_classify_commitments function should exist and classify action items."""
    from extraction_pipeline import _classify_commitments

    entities = [
        {"type": "action_item", "content": "Send the report",
         "properties": {"source_quote": "I'll send the report by Friday"}},
        {"type": "action_item", "content": "Review the docs",
         "properties": {"source_quote": "Can you review the docs?"}},
        {"type": "action_item", "content": "Maybe look into caching",
         "properties": {"source_quote": "I might try to look into caching"}},
    ]
    result = _classify_commitments(entities)
    action_items = [e for e in result if e["type"] == "action_item"]
    assert action_items[0]["properties"]["commitment_type"] == "volunteered"
    assert action_items[1]["properties"]["commitment_type"] == "assigned"
    assert action_items[2]["properties"]["commitment_type"] == "conditional"


def test_build_relationships_from_entities():
    """_build_relationships_from_entities should create edges from entity properties."""
    from extraction_pipeline import _build_relationships_from_entities

    entities = [
        {"short_id": "E1", "type": "person", "content": "Alice", "properties": {}},
        {"short_id": "E2", "type": "decision", "content": "Use React",
         "properties": {"made_by": "Alice"}},
        {"short_id": "E3", "type": "action_item", "content": "Set up repo",
         "properties": {"owner": "Alice"}},
        {"short_id": "E4", "type": "risk", "content": "Tight deadline",
         "properties": {"raised_by": "Alice"}},
    ]
    edges = _build_relationships_from_entities(entities)
    edge_types = {(e["source"], e["edge_type"], e["target"]) for e in edges}
    assert ("E1", "DECIDED", "E2") in edge_types
    assert ("E1", "OWNS", "E3") in edge_types
    assert ("E1", "RAISED", "E4") in edge_types


def test_correct_entity_types():
    """_correct_entity_types should reclassify mistyped entities."""
    from extraction_pipeline import _correct_entity_types

    entities = [
        {"type": "decision", "content": "Need to set up the CI pipeline",
         "properties": {}},  # Looks like an action item
        {"type": "decision", "content": "We will use React for the frontend",
         "properties": {"made_by": "Alice"}},  # Genuine decision, should stay
    ]
    result = _correct_entity_types(entities)
    assert result[0]["type"] == "action_item", "Action-like 'decision' should be reclassified"
    assert result[1]["type"] == "decision", "Real decision should stay as decision"
