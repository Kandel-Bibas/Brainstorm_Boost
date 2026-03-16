from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from database import create_meeting
from transcript_parser import parse_transcript

router = APIRouter(prefix="/api", tags=["upload"])


@router.post("/upload-transcript")
async def upload_transcript(
    text: str = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    title: str = Form(default=None),
):
    raw = None
    filename = None

    if file and file.filename:
        raw_bytes = await file.read()
        raw = raw_bytes.decode("utf-8-sig")
        filename = file.filename
    elif text:
        raw = text
    else:
        raise HTTPException(status_code=400, detail="Provide either text or a file")

    word_count = len(raw.split())
    if word_count < 50:
        raise HTTPException(
            status_code=400,
            detail=f"Transcript too short ({word_count} words). Need at least 50 words for meaningful analysis.",
        )

    utterances = parse_transcript(raw)
    meeting_title = title or filename or f"Meeting {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
    meeting_id = create_meeting(meeting_title, raw, utterances)

    format_detected = utterances[0]["format_detected"] if utterances else "narrative"

    return {
        "meeting_id": meeting_id,
        "title": meeting_title,
        "utterance_count": len(utterances),
        "format_detected": format_detected,
        "utterances": utterances,
    }
