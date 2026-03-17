import logging

from fastapi import APIRouter, HTTPException

from database import get_meeting, list_meetings, delete_meeting

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["meetings"])


@router.get("/meetings")
def meetings_list():
    return list_meetings()


@router.get("/meetings/{meeting_id}")
def meeting_detail(meeting_id: str):
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.delete("/meetings/{meeting_id}")
def delete_meeting_endpoint(meeting_id: str):
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Remove from ChromaDB
    try:
        from routes.query import get_memory
        memory = get_memory()
        memory.remove_meeting(meeting_id)
    except Exception:
        logger.exception("Failed to remove meeting %s from ChromaDB", meeting_id)

    delete_meeting(meeting_id)
    return {"status": "deleted", "meeting_id": meeting_id}


@router.get("/meetings/{meeting_id}/transcript")
def meeting_transcript(meeting_id: str):
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {
        "meeting_id": meeting_id,
        "transcript": meeting.get("raw_transcript", ""),
    }
