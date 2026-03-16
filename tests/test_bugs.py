"""Tests that reproduce specific bugs before fixing them."""
import inspect

import pytest


# === Bug 1: generate() uses wrong system prompt for RAG and read-ahead ===

def test_general_system_prompt_exists():
    """GENERAL_SYSTEM_PROMPT constant should exist and differ from SYSTEM_PROMPT."""
    from llm_client import SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT
    assert "meeting analyst" in SYSTEM_PROMPT.lower()
    assert "meeting analyst" not in GENERAL_SYSTEM_PROMPT.lower()


def test_analyze_with_anthropic_accepts_system_prompt():
    """_analyze_with_anthropic should accept an optional system_prompt parameter."""
    from llm_client import _analyze_with_anthropic
    sig = inspect.signature(_analyze_with_anthropic)
    assert "system_prompt" in sig.parameters


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
