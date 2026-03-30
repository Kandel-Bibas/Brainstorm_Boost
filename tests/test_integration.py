import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch
from main import app

transport = ASGITransport(app=app)

SAMPLE_TRANSCRIPT = """
Alice  0:00
Okay everyone, let's talk about the drone battery situation.
We need to decide on the battery type by end of week.

Bob  0:45
I've been looking into lithium-polymer options. They have
better energy density but cost about 30% more than the
lithium-ion alternatives we've been using.

Alice  1:30
I think the energy density trade-off is worth it for this
application. The weight savings alone will improve flight
time significantly. Let's go with lithium-polymer.

Bob  2:00
Agreed. I'll reach out to three suppliers by Friday and
get quotes. I'm a bit worried about the temperature
performance in cold weather though - that could be a
problem for winter operations.

Alice  2:30
Good point. Bob, can you also ask suppliers about cold
weather performance specs? That's a risk we need to
track.
"""

MOCK_AI_OUTPUT = {
    "meeting_metadata": {
        "title": "Drone Battery Review",
        "date_mentioned": None,
        "participants": ["Alice", "Bob"],
        "duration_estimate": "~3 minutes",
    },
    "decisions": [{
        "id": "D1",
        "description": "Use lithium-polymer batteries",
        "decision_type": "emergent",
        "made_by": "Alice",
        "ratified_by": "Bob",
        "confidence": "high",
        "confidence_rationale": "Explicit agreement from both participants",
        "source_quote": "Let's go with lithium-polymer",
    }],
    "action_items": [{
        "id": "A1",
        "task": "Contact three battery suppliers for quotes",
        "owner": "Bob",
        "deadline": "Friday",
        "commitment_type": "volunteered",
        "depends_on": [],
        "confidence": "high",
        "confidence_rationale": "First-person commitment with specific deliverable and deadline",
        "source_quote": "I'll reach out to three suppliers by Friday",
    }],
    "open_risks": [{
        "id": "R1",
        "description": "Cold weather battery performance",
        "raised_by": "Bob",
        "severity": "medium",
        "source_quote": "worried about the temperature performance in cold weather",
    }],
    "state_of_direction": "Team chose lithium-polymer batteries. Bob sourcing suppliers by Friday.",
    "trust_flags": [],
}


@pytest.mark.asyncio
async def test_full_pipeline():
    """Full pipeline: upload transcript -> analyze -> approve -> query memory."""
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Upload
        res = await client.post("/api/upload-transcript", data={"text": SAMPLE_TRANSCRIPT})
        assert res.status_code == 200
        meeting_id = res.json()["meeting_id"]
        assert res.json()["utterance_count"] >= 1

        # 2. Analyze (mock the LLM call)
        with patch("routes.analyze.analyze_transcript", return_value=MOCK_AI_OUTPUT):
            res = await client.post(
                "/api/analyze",
                json={"meeting_id": meeting_id, "provider": "gemini"},
            )
            assert res.status_code == 200
            assert res.json()["ai_output"]["decisions"][0]["id"] == "D1"

        # 3. Approve
        res = await client.post(
            "/api/approve",
            json={"meeting_id": meeting_id, "verified_output": MOCK_AI_OUTPUT},
        )
        assert res.status_code == 200
        exports = res.json()["exports"]
        assert "markdown" in exports
        assert "json" in exports

        # 4. Verify meeting status
        res = await client.get(f"/api/meetings/{meeting_id}")
        assert res.status_code == 200
        assert res.json()["status"] == "approved"

        # 5. Verify meetings list
        res = await client.get("/api/meetings")
        assert res.status_code == 200
        meetings = res.json()
        assert len(meetings) >= 1
        assert any(m["id"] == meeting_id for m in meetings)
