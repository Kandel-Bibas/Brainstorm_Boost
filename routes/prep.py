"""Prep API endpoints — pre-meeting intelligence."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from database import update_action_item_status
from meeting_prep import (
    generate_read_ahead,
    get_open_items_for_prep,
    recommend_participants,
)
from routes.query import get_memory

router = APIRouter(prefix="/api/prep", tags=["prep"])


@router.post("/read-ahead")
async def read_ahead(request: Request):
    """Generate a read-ahead brief for an upcoming meeting.

    Body: {"agenda": str, "participants": list[str], "provider": str (optional)}
    """
    body = await request.json()
    agenda = body.get("agenda", "").strip()
    if not agenda:
        raise HTTPException(status_code=400, detail="agenda is required")

    participants = body.get("participants", [])
    provider = body.get("provider")
    memory = get_memory()

    try:
        brief = generate_read_ahead(
            agenda=agenda,
            participants=participants,
            memory=memory,
            provider=provider,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Read-ahead generation failed: {e}")

    return brief


@router.post("/recommend-participants")
async def recommend_participants_endpoint(request: Request):
    """Return participant recommendations based on agenda.

    Body: {"agenda": str}
    """
    body = await request.json()
    agenda = body.get("agenda", "").strip()
    if not agenda:
        raise HTTPException(status_code=400, detail="agenda is required")

    memory = get_memory()
    recommendations = recommend_participants(agenda, memory)
    return {"recommendations": recommendations}


@router.get("/open-items")
async def open_items(participant: str | None = Query(default=None)):
    """Return open action items, optionally filtered by participant.

    Query: ?participant=name (optional)
    """
    participants = [participant] if participant else None
    items = get_open_items_for_prep(participants=participants)
    return {"items": items}


@router.post("/action-items/{item_id}/status")
async def update_item_status(item_id: str, request: Request):
    """Update the status of an action item.

    Body: {"status": "completed"|"cancelled"}
    """
    body = await request.json()
    status = body.get("status")

    allowed = {"completed", "cancelled"}
    if status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of {sorted(allowed)}, got: {status!r}",
        )

    try:
        update_action_item_status(item_id, status)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update status: {e}")

    return {"item_id": item_id, "status": status}
