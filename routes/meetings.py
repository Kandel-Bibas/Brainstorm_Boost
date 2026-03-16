from fastapi import APIRouter, HTTPException

from database import get_meeting, list_meetings

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
