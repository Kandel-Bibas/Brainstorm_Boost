from __future__ import annotations

import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_whisper_model = None
_diarization_pipeline = None


def _get_whisper_model(model_size: str = "medium"):
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel(
            model_size,
            device="auto",
            compute_type="auto",
        )
    return _whisper_model


def _get_diarization_pipeline():
    global _diarization_pipeline
    if _diarization_pipeline is None:
        import os
        from pyannote.audio import Pipeline
        hf_token = os.getenv("HF_TOKEN")
        if not hf_token:
            raise ValueError(
                "HF_TOKEN environment variable required for speaker diarization. "
                "Accept the pyannote model license at https://huggingface.co/pyannote/speaker-diarization-3.1 "
                "and set HF_TOKEN in your .env file."
            )
        _diarization_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        )
    return _diarization_pipeline


def align_segments(
    whisper_segments: list[dict],
    speaker_segments: list[dict],
) -> list[dict]:
    """Align whisper text segments with pyannote speaker labels.

    For each whisper segment, find the speaker segment that overlaps
    the most with it (by midpoint matching).
    """
    if not whisper_segments:
        return []

    aligned = []
    for ws in whisper_segments:
        midpoint = (ws["start"] + ws["end"]) / 2
        speaker = "Unknown"
        for ss in speaker_segments:
            if ss["start"] <= midpoint <= ss["end"]:
                speaker = ss["speaker"]
                break
        aligned.append({
            "start": ws["start"],
            "end": ws["end"],
            "text": ws["text"].strip(),
            "speaker": speaker,
        })
    return aligned


def format_as_utterances(aligned: list[dict]) -> list[dict]:
    """Convert aligned segments to utterance format, merging consecutive same-speaker segments."""
    if not aligned:
        return []

    merged = [aligned[0].copy()]
    for seg in aligned[1:]:
        if seg["speaker"] == merged[-1]["speaker"]:
            merged[-1]["text"] += " " + seg["text"]
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(seg.copy())

    utterances = []
    for seg in merged:
        seconds = int(seg["start"])
        ts = f"{seconds // 3600:02d}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"
        utterances.append({
            "speaker": seg["speaker"],
            "text": seg["text"],
            "timestamp": ts,
            "format_detected": "audio",
        })
    return utterances


def transcribe_file(file_path: Path, model_size: str = "medium") -> list[dict]:
    """Transcribe an audio file with speaker diarization."""
    model = _get_whisper_model(model_size)
    segments, info = model.transcribe(str(file_path), beam_size=5)

    whisper_segments = []
    for seg in segments:
        whisper_segments.append({
            "start": seg.start,
            "end": seg.end,
            "text": seg.text,
        })

    # Speaker diarization
    try:
        pipeline = _get_diarization_pipeline()
        diarization = pipeline(str(file_path))
        speaker_segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            speaker_segments.append({
                "start": turn.start,
                "end": turn.end,
                "speaker": speaker,
            })
    except (ValueError, Exception):
        logger.warning("Speaker diarization failed, assigning all to Unknown", exc_info=True)
        # If diarization fails (no HF_TOKEN, etc.), assign all to Unknown
        speaker_segments = [{
            "start": 0.0,
            "end": whisper_segments[-1]["end"] if whisper_segments else 0.0,
            "speaker": "Unknown",
        }]

    aligned = align_segments(whisper_segments, speaker_segments)
    return format_as_utterances(aligned)


async def transcribe_file_async(file_path: Path, model_size: str = "medium") -> list[dict]:
    """Async wrapper — runs transcription in a thread to avoid blocking the event loop."""
    return await asyncio.to_thread(transcribe_file, file_path, model_size)


# NOTE: transcribe_stream() is deferred to Phase 3 (live_session.py).


def unload_models():
    """Free STT models from memory."""
    global _whisper_model, _diarization_pipeline
    _whisper_model = None
    _diarization_pipeline = None
