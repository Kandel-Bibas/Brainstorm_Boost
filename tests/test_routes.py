import pytest
from httpx import AsyncClient, ASGITransport
from main import app

transport = ASGITransport(app=app)

@pytest.mark.asyncio
async def test_providers_endpoint():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/providers")
        assert res.status_code == 200
        data = res.json()
        assert "providers" in data
        assert "default" in data

@pytest.mark.asyncio
async def test_meetings_list_empty():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/meetings")
        assert res.status_code == 200
        assert res.json() == []

@pytest.mark.asyncio
async def test_upload_transcript_text():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/upload-transcript",
            data={"text": " ".join(["word"] * 60)},
        )
        assert res.status_code == 200
        data = res.json()
        assert "meeting_id" in data
        assert data["utterance_count"] >= 1

@pytest.mark.asyncio
async def test_upload_transcript_too_short():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/upload-transcript",
            data={"text": "too short"},
        )
        assert res.status_code == 400

@pytest.mark.asyncio
async def test_meeting_not_found():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/meetings/nonexistent-id")
        assert res.status_code == 404
