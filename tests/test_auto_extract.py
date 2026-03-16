"""Tests for auto-extraction of action items and speaker profiles on approve."""
from __future__ import annotations

import json
import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from database import (
    create_meeting,
    update_ai_output,
    get_open_action_items,
    get_speaker_profile_by_name,
)

transport = ASGITransport(app=app)

VERIFIED_OUTPUT = {
    "meeting_metadata": {
        "title": "Q1 Planning",
        "date_mentioned": "2026-03-15",
        "participants": ["Alice", "Bob"],
    },
    "state_of_direction": "Team is aligned on goals.",
    "decisions": [],
    "action_items": [
        {
            "id": "a1",
            "task": "Set up CI pipeline",
            "owner": "Alice",
            "deadline": "2026-03-20",
            "confidence": "high",
            "source_quote": "Alice will set up CI by end of week",
        },
        {
            "id": "a2",
            "task": "Write API docs",
            "owner": "Bob",
            "deadline": None,
            "confidence": "medium",
            "source_quote": None,
        },
    ],
    "open_risks": [],
    "trust_flags": [],
}


@pytest.fixture
async def approved_meeting():
    """Create a meeting, set it to analyzed state, then approve it via the API."""
    meeting_id = create_meeting(
        title="Q1 Planning",
        raw_transcript="Alice: Let's set up CI. Bob: I'll write API docs.",
        utterances=[
            {"speaker": "Alice", "text": "Let's set up CI."},
            {"speaker": "Bob", "text": "I'll write API docs."},
        ],
    )
    update_ai_output(meeting_id, VERIFIED_OUTPUT)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/approve",
            json={"meeting_id": meeting_id, "verified_output": VERIFIED_OUTPUT},
        )
    assert res.status_code == 200, f"Approve failed: {res.text}"
    return meeting_id


@pytest.mark.asyncio
async def test_approve_extracts_action_items(approved_meeting):
    """After approval, action items should be persisted in the database."""
    items = get_open_action_items()
    task_names = [item["task"] for item in items]
    assert "Set up CI pipeline" in task_names
    assert "Write API docs" in task_names


@pytest.mark.asyncio
async def test_approve_action_items_have_correct_owners(approved_meeting):
    """Extracted action items must carry the correct owner field."""
    items = get_open_action_items()
    by_task = {item["task"]: item for item in items}
    assert by_task["Set up CI pipeline"]["owner"] == "Alice"
    assert by_task["Write API docs"]["owner"] == "Bob"


@pytest.mark.asyncio
async def test_approve_action_items_include_meeting_title(approved_meeting):
    """get_open_action_items must join with meetings and expose meeting_title."""
    items = get_open_action_items()
    assert all(item["meeting_title"] == "Q1 Planning" for item in items)


@pytest.mark.asyncio
async def test_approve_action_items_linked_to_meeting(approved_meeting):
    """Extracted action items must be linked to the correct meeting_id."""
    items = get_open_action_items()
    assert all(item["meeting_id"] == approved_meeting for item in items)


@pytest.mark.asyncio
async def test_approve_creates_speaker_profiles(approved_meeting):
    """Participants in verified_output should have speaker profiles created."""
    alice = get_speaker_profile_by_name("Alice")
    bob = get_speaker_profile_by_name("Bob")
    assert alice is not None, "Alice should have a speaker profile"
    assert bob is not None, "Bob should have a speaker profile"


@pytest.mark.asyncio
async def test_approve_speaker_profile_has_meeting_count(approved_meeting):
    """Speaker profiles should have a meeting_count >= 1 after approval."""
    alice = get_speaker_profile_by_name("Alice")
    assert alice["meeting_count"] >= 1


@pytest.mark.asyncio
async def test_approve_speaker_profile_includes_topic(approved_meeting):
    """Speaker profiles should include the meeting title as a topic."""
    alice = get_speaker_profile_by_name("Alice")
    assert "Q1 Planning" in alice["topics"]


@pytest.mark.asyncio
async def test_approve_still_returns_200_with_no_action_items():
    """Approval with no action_items in verified_output should still succeed."""
    meeting_id = create_meeting(
        title="Quick Sync",
        raw_transcript=" ".join(["word"] * 60),
        utterances=[{"speaker": "Carol", "text": "Quick sync done."}],
    )
    empty_output = {
        "meeting_metadata": {"title": "Quick Sync", "participants": ["Carol"]},
        "action_items": [],
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/approve",
            json={"meeting_id": meeting_id, "verified_output": empty_output},
        )
    assert res.status_code == 200
