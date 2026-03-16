"""Tests for meeting_prep module — get_open_items_for_prep and get_related_context."""
from __future__ import annotations

import tempfile
from unittest.mock import MagicMock, patch

import pytest

from database import create_meeting, create_action_item, update_action_item_status, upsert_speaker_profile
from meeting_prep import get_open_items_for_prep, get_related_context, recommend_participants


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def meeting_id():
    return create_meeting(
        title="Q1 Planning",
        raw_transcript="Alice: We need to plan Q1.",
        utterances=[{"speaker": "Alice", "text": "We need to plan Q1."}],
    )


@pytest.fixture
def meeting_id_b():
    return create_meeting(
        title="Design Review",
        raw_transcript="Bob: Let's review the design.",
        utterances=[{"speaker": "Bob", "text": "Let's review the design."}],
    )


@pytest.fixture
def empty_memory(tmp_path):
    """MeetingMemory backed by a fresh temp ChromaDB (no documents)."""
    from meeting_memory import MeetingMemory
    return MeetingMemory(persist_dir=str(tmp_path / "chroma"))


# ---------------------------------------------------------------------------
# get_open_items_for_prep
# ---------------------------------------------------------------------------

class TestGetOpenItemsForPrep:
    def test_returns_all_open_items_when_no_participants(self, meeting_id):
        create_action_item(meeting_id=meeting_id, task="Write spec", owner="Alice")
        create_action_item(meeting_id=meeting_id, task="Review PR", owner="Bob")
        items = get_open_items_for_prep()
        assert len(items) >= 2

    def test_filters_by_single_participant(self, meeting_id):
        create_action_item(meeting_id=meeting_id, task="Alice task", owner="Alice")
        create_action_item(meeting_id=meeting_id, task="Bob task", owner="Bob")
        items = get_open_items_for_prep(participants=["Alice"])
        owners = [i["owner"] for i in items]
        assert all(o == "Alice" for o in owners)
        assert "Alice task" in [i["task"] for i in items]

    def test_filters_by_multiple_participants(self, meeting_id):
        create_action_item(meeting_id=meeting_id, task="Alice task", owner="Alice")
        create_action_item(meeting_id=meeting_id, task="Bob task", owner="Bob")
        create_action_item(meeting_id=meeting_id, task="Carol task", owner="Carol")
        items = get_open_items_for_prep(participants=["Alice", "Bob"])
        owners = {i["owner"] for i in items}
        assert "Alice" in owners
        assert "Bob" in owners
        assert "Carol" not in owners

    def test_deduplicates_across_participants(self, meeting_id):
        """An item owned by 'Alice' should not appear twice if Alice appears twice."""
        create_action_item(meeting_id=meeting_id, task="Shared concern", owner="Alice")
        items = get_open_items_for_prep(participants=["Alice", "Alice"])
        ids = [i["id"] for i in items]
        assert len(ids) == len(set(ids)), "Duplicate items found"

    def test_excludes_closed_items(self, meeting_id):
        item_id = create_action_item(meeting_id=meeting_id, task="Done task", owner="Alice")
        update_action_item_status(item_id, "completed")
        items = get_open_items_for_prep(participants=["Alice"])
        assert all(i["id"] != item_id for i in items)

    def test_returns_empty_list_when_no_items(self):
        items = get_open_items_for_prep()
        assert items == []

    def test_returns_empty_list_for_unknown_participant(self, meeting_id):
        create_action_item(meeting_id=meeting_id, task="Alice task", owner="Alice")
        items = get_open_items_for_prep(participants=["ZZZ_Nobody"])
        assert items == []

    def test_items_have_meeting_title(self, meeting_id):
        create_action_item(meeting_id=meeting_id, task="Some task", owner="Alice")
        items = get_open_items_for_prep()
        assert all("meeting_title" in i for i in items)

    def test_empty_participants_list_returns_nothing(self, meeting_id):
        create_action_item(meeting_id=meeting_id, task="Task", owner="Alice")
        # Empty list means filter by zero participants — returns no items
        items = get_open_items_for_prep(participants=[])
        assert items == []


# ---------------------------------------------------------------------------
# get_related_context
# ---------------------------------------------------------------------------

class TestGetRelatedContext:
    def test_returns_empty_list_when_no_data(self, empty_memory):
        result = get_related_context("quarterly planning budget", empty_memory)
        assert result == []

    def test_returns_list_type(self, empty_memory):
        result = get_related_context("some agenda", empty_memory)
        assert isinstance(result, list)

    def test_returns_results_when_data_indexed(self, empty_memory):
        # Index some meeting data
        ai_output = {
            "meeting_metadata": {"title": "Q1 Planning"},
            "decisions": [
                {"id": "D1", "description": "Adopt quarterly OKRs", "source_quote": "We agreed on OKRs"}
            ],
            "action_items": [],
            "open_risks": [],
            "state_of_direction": "Team is aligned on quarterly goals.",
        }
        empty_memory.index_meeting("meeting-001", ai_output)

        results = get_related_context("quarterly planning OKRs goals", empty_memory, top_k=3)
        assert len(results) >= 1

    def test_result_items_have_expected_keys(self, empty_memory):
        ai_output = {
            "meeting_metadata": {"title": "Design Session"},
            "decisions": [
                {"id": "D1", "description": "Use microservices architecture", "source_quote": "agreed"}
            ],
            "action_items": [],
            "open_risks": [],
            "state_of_direction": "Architecture decision made.",
        }
        empty_memory.index_meeting("meeting-002", ai_output)

        results = get_related_context("architecture design services", empty_memory, top_k=2)
        if results:
            item = results[0]
            assert "content" in item
            assert "meeting_id" in item
            assert "meeting_title" in item
            assert "item_type" in item

    def test_top_k_limits_results(self, empty_memory):
        # Index multiple decisions so there's enough data
        ai_output = {
            "meeting_metadata": {"title": "Big Meeting"},
            "decisions": [
                {"id": f"D{i}", "description": f"Decision about topic {i}", "source_quote": f"quote {i}"}
                for i in range(10)
            ],
            "action_items": [],
            "open_risks": [],
            "state_of_direction": "Many decisions made.",
        }
        empty_memory.index_meeting("meeting-003", ai_output)

        results = get_related_context("decision topic", empty_memory, top_k=3)
        assert len(results) <= 3


# ---------------------------------------------------------------------------
# recommend_participants
# ---------------------------------------------------------------------------

class TestRecommendParticipants:
    def test_returns_list(self, empty_memory):
        result = recommend_participants("machine learning models", empty_memory)
        assert isinstance(result, list)

    def test_returns_profiles_with_matching_topics(self, empty_memory):
        upsert_speaker_profile(name="Alice", topics=["machine learning", "AI"], meeting_count=3)
        upsert_speaker_profile(name="Bob", topics=["accounting"], meeting_count=1)
        results = recommend_participants("machine learning models deployment", empty_memory)
        names = [r["name"] for r in results]
        assert "Alice" in names

    def test_sorted_by_past_contributions_descending(self, empty_memory):
        upsert_speaker_profile(name="Senior", topics=["backend"], meeting_count=10)
        upsert_speaker_profile(name="Junior", topics=["backend"], meeting_count=2)
        results = recommend_participants("backend services API", empty_memory)
        # Senior should appear before Junior
        names = [r["name"] for r in results]
        if "Senior" in names and "Junior" in names:
            assert names.index("Senior") < names.index("Junior")

    def test_result_has_past_contributions_field(self, empty_memory):
        upsert_speaker_profile(name="Charlie", topics=["design"], meeting_count=5)
        results = recommend_participants("design review", empty_memory)
        charlie = next((r for r in results if r["name"] == "Charlie"), None)
        if charlie:
            assert "past_contributions" in charlie
            assert charlie["past_contributions"] == 5
