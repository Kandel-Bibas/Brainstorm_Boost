import pytest

from meeting_memory import MeetingMemory


@pytest.fixture
def memory(tmp_path):
    return MeetingMemory(persist_dir=str(tmp_path / "chroma_test"))


@pytest.fixture
def sample_ai_output():
    return {
        "meeting_metadata": {"title": "Drone Battery Review", "participants": ["Alice", "Bob"]},
        "decisions": [
            {
                "id": "D1",
                "description": "Use lithium-polymer batteries for the new drone prototype",
                "made_by": "Alice",
                "confidence": "high",
                "source_quote": "Let's go with lithium-polymer, they have better energy density",
            }
        ],
        "action_items": [
            {
                "id": "A1",
                "task": "Research lithium-polymer battery suppliers",
                "owner": "Bob",
                "deadline": "Friday",
                "confidence": "high",
                "source_quote": "Bob, can you look into suppliers by Friday?",
            }
        ],
        "open_risks": [
            {
                "id": "R1",
                "description": "Battery weight may exceed airframe limits",
                "raised_by": "Bob",
                "severity": "medium",
                "source_quote": "I'm worried the weight might be too much for the current frame",
            }
        ],
        "state_of_direction": "Team decided on lithium-polymer batteries. Bob researching suppliers.",
    }


def test_index_and_query(memory, sample_ai_output):
    memory.index_meeting("meeting-1", sample_ai_output)
    results = memory.query("drone battery decision")
    assert len(results) > 0
    assert any("lithium-polymer" in r["content"].lower() for r in results)


def test_query_empty_db(memory):
    results = memory.query("anything")
    assert results == []


def test_index_multiple_meetings(memory, sample_ai_output):
    memory.index_meeting("meeting-1", sample_ai_output)

    second_output = {
        "meeting_metadata": {"title": "Frequency Allocation"},
        "decisions": [{"id": "D1", "description": "Use 5.8 GHz for drone comms", "source_quote": "5.8 GHz is best"}],
        "action_items": [],
        "open_risks": [],
        "state_of_direction": "Chose 5.8 GHz frequency band.",
    }
    memory.index_meeting("meeting-2", second_output)

    results = memory.query("frequency allocation")
    assert any("5.8" in r["content"] for r in results)

    results = memory.query("battery")
    assert any("lithium" in r["content"].lower() for r in results)
