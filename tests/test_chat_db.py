"""Tests for chat session and message CRUD functions."""
from __future__ import annotations

import pytest
from database import (
    create_chat_session,
    get_chat_session,
    add_chat_message,
    get_chat_messages,
)


class TestCreateAndGetSession:
    def test_create_and_get_session(self):
        session_id = create_chat_session()
        assert isinstance(session_id, str)
        assert len(session_id) > 0

        session = get_chat_session(session_id)
        assert session is not None
        assert session["id"] == session_id
        assert "created_at" in session

    def test_get_nonexistent_session_returns_none(self):
        result = get_chat_session("nonexistent-id-xyz")
        assert result is None

    def test_multiple_sessions_have_unique_ids(self):
        id1 = create_chat_session()
        id2 = create_chat_session()
        assert id1 != id2


class TestAddAndGetMessages:
    def test_add_and_get_messages(self):
        session_id = create_chat_session()
        msg_id = add_chat_message(session_id, "user", "Hello!")
        assert isinstance(msg_id, str)

        messages = get_chat_messages(session_id)
        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "Hello!"
        assert messages[0]["id"] == msg_id

    def test_sources_parsing(self):
        session_id = create_chat_session()
        sources = ["Meeting A", "Meeting B"]
        add_chat_message(session_id, "assistant", "Answer", sources=sources)

        messages = get_chat_messages(session_id)
        assert len(messages) == 1
        assert messages[0]["sources"] == sources

    def test_no_sources_returns_none(self):
        session_id = create_chat_session()
        add_chat_message(session_id, "user", "No sources message")
        messages = get_chat_messages(session_id)
        assert messages[0]["sources"] is None

    def test_context_meeting_id_stored(self):
        session_id = create_chat_session()
        add_chat_message(session_id, "user", "Scoped msg", context_meeting_id="mtg-123")
        messages = get_chat_messages(session_id)
        assert messages[0]["context_meeting_id"] == "mtg-123"

    def test_messages_in_chronological_order(self):
        session_id = create_chat_session()
        add_chat_message(session_id, "user", "First")
        add_chat_message(session_id, "assistant", "Second")
        add_chat_message(session_id, "user", "Third")
        messages = get_chat_messages(session_id)
        assert messages[0]["content"] == "First"
        assert messages[1]["content"] == "Second"
        assert messages[2]["content"] == "Third"


class TestGetMessagesEmptySession:
    def test_get_messages_empty_session(self):
        session_id = create_chat_session()
        messages = get_chat_messages(session_id)
        assert messages == []


class TestGetRecentMessagesLimit:
    def test_get_recent_messages_limit(self):
        session_id = create_chat_session()

        # Add 15 messages
        for i in range(15):
            add_chat_message(session_id, "user", f"Message {i}")

        # Get last 10
        messages = get_chat_messages(session_id, limit=10)
        assert len(messages) == 10

        # Verify these are the most recent 10 (messages 5-14), in chronological order
        assert messages[0]["content"] == "Message 5"
        assert messages[-1]["content"] == "Message 14"

    def test_limit_larger_than_total(self):
        session_id = create_chat_session()
        for i in range(3):
            add_chat_message(session_id, "user", f"Msg {i}")
        messages = get_chat_messages(session_id, limit=10)
        assert len(messages) == 3

    def test_limit_none_returns_all(self):
        session_id = create_chat_session()
        for i in range(15):
            add_chat_message(session_id, "user", f"Msg {i}")
        messages = get_chat_messages(session_id, limit=None)
        assert len(messages) == 15
