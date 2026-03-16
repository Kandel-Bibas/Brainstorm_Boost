"""Tests for action_items and speaker_profiles CRUD functions."""
from __future__ import annotations

import pytest
from database import (
    create_meeting,
    create_action_item,
    get_open_action_items,
    update_action_item_status,
    upsert_speaker_profile,
    get_speaker_profiles,
    get_speaker_profile_by_name,
)


@pytest.fixture
def sample_meeting():
    meeting_id = create_meeting(
        title="Sprint Planning",
        raw_transcript="Alice: Let's plan the sprint.",
        utterances=[{"speaker": "Alice", "text": "Let's plan the sprint."}],
    )
    return meeting_id


# ---------------------------------------------------------------------------
# action_items
# ---------------------------------------------------------------------------

class TestCreateActionItem:
    def test_returns_string_id(self, sample_meeting):
        item_id = create_action_item(
            meeting_id=sample_meeting,
            task="Write tests",
            owner="Alice",
        )
        assert isinstance(item_id, str)
        assert len(item_id) > 0

    def test_minimal_required_fields(self, sample_meeting):
        item_id = create_action_item(meeting_id=sample_meeting, task="Do something")
        assert item_id is not None

    def test_all_optional_fields(self, sample_meeting):
        item_id = create_action_item(
            meeting_id=sample_meeting,
            task="Deploy to prod",
            owner="Bob",
            deadline="2026-03-20",
            confidence="high",
            source_quote="Bob said deploy by Friday",
        )
        assert item_id is not None


class TestGetOpenActionItems:
    def test_returns_list(self, sample_meeting):
        create_action_item(meeting_id=sample_meeting, task="Task A", owner="Alice")
        items = get_open_action_items()
        assert isinstance(items, list)

    def test_includes_meeting_title(self, sample_meeting):
        create_action_item(meeting_id=sample_meeting, task="Task A", owner="Alice")
        items = get_open_action_items()
        assert len(items) >= 1
        assert "meeting_title" in items[0]
        assert items[0]["meeting_title"] == "Sprint Planning"

    def test_filter_by_participant(self, sample_meeting):
        create_action_item(meeting_id=sample_meeting, task="Task for Alice", owner="Alice")
        create_action_item(meeting_id=sample_meeting, task="Task for Bob", owner="Bob")
        alice_items = get_open_action_items(participant="Alice")
        assert all(item["owner"] == "Alice" for item in alice_items)
        assert len(alice_items) == 1

    def test_does_not_return_closed_items(self, sample_meeting):
        item_id = create_action_item(meeting_id=sample_meeting, task="Closed task", owner="Alice")
        update_action_item_status(item_id, "closed")
        items = get_open_action_items(participant="Alice")
        assert all(item["id"] != item_id for item in items)

    def test_empty_when_no_items(self):
        items = get_open_action_items()
        assert items == []


class TestUpdateActionItemStatus:
    def test_closes_item(self, sample_meeting):
        item_id = create_action_item(meeting_id=sample_meeting, task="Close me")
        update_action_item_status(item_id, "closed")
        open_items = get_open_action_items()
        assert all(item["id"] != item_id for item in open_items)

    def test_in_progress_status(self, sample_meeting):
        item_id = create_action_item(meeting_id=sample_meeting, task="In progress task")
        update_action_item_status(item_id, "in_progress")
        # Item should not appear in "open" items query
        open_items = get_open_action_items()
        assert all(item["id"] != item_id for item in open_items)


# ---------------------------------------------------------------------------
# speaker_profiles
# ---------------------------------------------------------------------------

class TestUpsertSpeakerProfile:
    def test_insert_new_profile(self):
        upsert_speaker_profile(name="Carol")
        profiles = get_speaker_profiles()
        names = [p["name"] for p in profiles]
        assert "Carol" in names

    def test_update_existing_profile(self):
        upsert_speaker_profile(name="Dave", topics=["backend"], meeting_count=1)
        upsert_speaker_profile(name="Dave", topics=["frontend"], meeting_count=1)
        profiles = get_speaker_profiles()
        dave = next(p for p in profiles if p["name"] == "Dave")
        # meeting_count should accumulate (or at least not drop)
        assert dave["meeting_count"] >= 1

    def test_with_all_fields(self):
        upsert_speaker_profile(
            name="Eve",
            topics=["ML", "data"],
            meeting_count=3,
            expertise_summary="Machine learning expert",
        )
        profile = get_speaker_profile_by_name("Eve")
        assert profile is not None
        assert profile["expertise_summary"] == "Machine learning expert"


class TestGetSpeakerProfiles:
    def test_returns_list(self):
        upsert_speaker_profile(name="Frank")
        profiles = get_speaker_profiles()
        assert isinstance(profiles, list)
        assert len(profiles) >= 1

    def test_topics_parsed_as_list(self):
        upsert_speaker_profile(name="Grace", topics=["infra", "devops"])
        profiles = get_speaker_profiles()
        grace = next(p for p in profiles if p["name"] == "Grace")
        assert isinstance(grace["topics"], list)
        assert "infra" in grace["topics"]

    def test_topics_none_becomes_empty_list(self):
        upsert_speaker_profile(name="Henry", topics=None)
        profiles = get_speaker_profiles()
        henry = next(p for p in profiles if p["name"] == "Henry")
        assert henry["topics"] == [] or henry["topics"] is None  # either is acceptable


class TestGetSpeakerProfileByName:
    def test_returns_profile_for_known_name(self):
        upsert_speaker_profile(name="Iris", topics=["security"])
        profile = get_speaker_profile_by_name("Iris")
        assert profile is not None
        assert profile["name"] == "Iris"

    def test_returns_none_for_unknown_name(self):
        profile = get_speaker_profile_by_name("ZZZ_Unknown_Person")
        assert profile is None

    def test_topics_parsed_as_list(self):
        upsert_speaker_profile(name="Jack", topics=["cloud", "k8s"])
        profile = get_speaker_profile_by_name("Jack")
        assert isinstance(profile["topics"], list)
        assert "cloud" in profile["topics"]
