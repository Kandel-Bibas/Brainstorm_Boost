import tempfile
from datetime import datetime, timezone
from pathlib import Path as FilePath
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from database import create_meeting
from stt_engine import transcribe_file_async
from transcript_parser import parse_transcript

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".webm", ".ogg", ".flac"}

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


@router.post("/upload-audio")
async def upload_audio(
    file: UploadFile = File(...),
    title: str = Form(default=None),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    suffix = FilePath(file.filename).suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported audio format '{suffix}'. Supported: {', '.join(sorted(AUDIO_EXTENSIONS))}",
        )

    # Save to temp file for processing
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        # Reject files > 500MB (~4 hours of audio)
        if len(content) > 500 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Audio file too large (max 500MB / ~4 hours)")
        tmp.write(content)
        tmp_path = FilePath(tmp.name)

    try:
        utterances = await transcribe_file_async(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")
    finally:
        tmp_path.unlink(missing_ok=True)

    if not utterances:
        raise HTTPException(status_code=422, detail="No speech detected in audio file")

    raw_text = "\n".join(f"[{u['timestamp']}] {u['speaker']}: {u['text']}" for u in utterances)
    meeting_title = title or file.filename or f"Meeting {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
    meeting_id = create_meeting(meeting_title, raw_text, utterances)

    return {
        "meeting_id": meeting_id,
        "title": meeting_title,
        "utterance_count": len(utterances),
        "format_detected": "audio",
        "utterances": utterances,
    }
