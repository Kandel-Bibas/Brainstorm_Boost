import pytest

from stt_engine import align_segments, format_as_utterances


def test_align_segments_simple():
    """Test aligning whisper segments with speaker labels."""
    whisper_segments = [
        {"start": 0.0, "end": 2.0, "text": "Hello everyone"},
        {"start": 2.5, "end": 5.0, "text": "Welcome to the meeting"},
    ]
    speaker_segments = [
        {"start": 0.0, "end": 3.0, "speaker": "SPEAKER_00"},
        {"start": 3.0, "end": 6.0, "speaker": "SPEAKER_01"},
    ]
    result = align_segments(whisper_segments, speaker_segments)
    assert len(result) == 2
    assert result[0]["speaker"] == "SPEAKER_00"
    assert result[0]["text"] == "Hello everyone"
    assert result[1]["speaker"] == "SPEAKER_01"
    assert result[1]["text"] == "Welcome to the meeting"


def test_align_segments_empty():
    assert align_segments([], []) == []


def test_format_as_utterances():
    aligned = [
        {"start": 0.0, "end": 2.0, "text": "Hello", "speaker": "SPEAKER_00"},
        {"start": 2.5, "end": 5.0, "text": "Hi there", "speaker": "SPEAKER_01"},
    ]
    result = format_as_utterances(aligned)
    assert len(result) == 2
    assert result[0]["speaker"] == "SPEAKER_00"
    assert result[0]["text"] == "Hello"
    assert result[0]["timestamp"] == "00:00:00"
    assert result[0]["format_detected"] == "audio"


def test_format_as_utterances_merges_consecutive():
    aligned = [
        {"start": 0.0, "end": 2.0, "text": "Hello", "speaker": "SPEAKER_00"},
        {"start": 2.0, "end": 4.0, "text": "everyone", "speaker": "SPEAKER_00"},
        {"start": 4.5, "end": 6.0, "text": "Hi", "speaker": "SPEAKER_01"},
    ]
    result = format_as_utterances(aligned)
    assert len(result) == 2
    assert result[0]["text"] == "Hello everyone"
