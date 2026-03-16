"""Tests for the ChatSession class."""
from __future__ import annotations

from unittest.mock import MagicMock, call, patch

import pytest


class TestCreateNewSession:
    def test_create_new_session(self):
        from chat_session import ChatSession
        session = ChatSession()
        assert session.session_id is not None
        assert isinstance(session.session_id, str)
        assert len(session.session_id) > 0

    def test_new_session_is_persisted(self):
        from chat_session import ChatSession
        from database import get_chat_session
        session = ChatSession()
        db_session = get_chat_session(session.session_id)
        assert db_session is not None
        assert db_session["id"] == session.session_id


class TestLoadExistingSession:
    def test_load_existing_session(self):
        from chat_session import ChatSession
        from database import create_chat_session
        existing_id = create_chat_session()
        session = ChatSession(session_id=existing_id)
        assert session.session_id == existing_id

    def test_load_nonexistent_raises(self):
        from chat_session import ChatSession
        with pytest.raises(ValueError, match="not found"):
            ChatSession(session_id="nonexistent-id-xyz")


class TestBuildConversationHistory:
    def test_build_conversation_history(self):
        from chat_session import ChatSession
        from database import add_chat_message
        session = ChatSession()
        add_chat_message(session.session_id, "user", "Hello")
        add_chat_message(session.session_id, "assistant", "Hi there!")

        history = session._build_conversation_history()
        assert len(history) == 2
        assert history[0]["role"] == "user"
        assert history[1]["role"] == "assistant"

    def test_history_respects_max_limit(self):
        from chat_session import ChatSession, MAX_HISTORY_MESSAGES
        from database import add_chat_message

        session = ChatSession()
        for i in range(MAX_HISTORY_MESSAGES + 5):
            add_chat_message(session.session_id, "user", f"Msg {i}")

        history = session._build_conversation_history()
        assert len(history) == MAX_HISTORY_MESSAGES

    def test_empty_history(self):
        from chat_session import ChatSession
        session = ChatSession()
        history = session._build_conversation_history()
        assert history == []


class TestBuildRagContextNoMeeting:
    def test_build_rag_context_no_meeting(self, tmp_path):
        """Query without context_meeting_id uses 5 global results."""
        from chat_session import ChatSession

        mock_memory = MagicMock()
        mock_memory.query.return_value = [
            {"content": "Decision: Go with Python", "meeting_title": "Arch Meeting", "meeting_id": "m1"},
        ]

        session = ChatSession()
        context = session._build_rag_context("What did we decide?", mock_memory)

        mock_memory.query.assert_called_once_with("What did we decide?", top_k=5)
        assert len(context) == 1

    def test_rag_context_empty_when_no_results(self, tmp_path):
        from chat_session import ChatSession

        mock_memory = MagicMock()
        mock_memory.query.return_value = []

        session = ChatSession()
        context = session._build_rag_context("Anything?", mock_memory)
        assert context == []


class TestBuildRagContextWithMeeting:
    def test_build_rag_context_with_meeting(self, tmp_path):
        """Two-query strategy when context_meeting_id is set:
        first query scoped to the meeting (3), then global (3)."""
        from chat_session import ChatSession

        mock_memory = MagicMock()
        # Return different results per call
        mock_memory.query.side_effect = [
            # First call: large query so we can filter by meeting_id
            [
                {"content": "Scoped item 1", "meeting_title": "Sprint 1", "meeting_id": "mtg-1"},
                {"content": "Scoped item 2", "meeting_title": "Sprint 1", "meeting_id": "mtg-1"},
                {"content": "Other meeting item", "meeting_title": "Other", "meeting_id": "mtg-9"},
            ],
            # Second call: global query
            [
                {"content": "Global item 1", "meeting_title": "Arch Meeting", "meeting_id": "mtg-2"},
            ],
        ]

        session = ChatSession()
        context = session._build_rag_context(
            "Tell me about sprint 1", mock_memory, context_meeting_id="mtg-1"
        )

        # Two queries should have been made
        assert mock_memory.query.call_count == 2
        # Combined results should be non-empty
        assert len(context) > 0

    def test_no_duplicate_content_in_combined_results(self, tmp_path):
        """Items appearing in both scoped and global queries are deduplicated."""
        from chat_session import ChatSession

        shared_item = {"content": "Same item", "meeting_title": "M1", "meeting_id": "mtg-1"}

        mock_memory = MagicMock()
        mock_memory.query.side_effect = [
            [shared_item],
            [shared_item],
        ]

        session = ChatSession()
        context = session._build_rag_context("Question", mock_memory, context_meeting_id="mtg-1")

        contents = [c["content"] for c in context]
        assert len(contents) == len(set(contents))
