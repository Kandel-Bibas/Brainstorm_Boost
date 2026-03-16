from __future__ import annotations

import re
from html import unescape

# Compiled regexes for format detection and parsing
RE_WEBVTT_HEADER = re.compile(r"^WEBVTT", re.MULTILINE)
RE_VTT_VOICE_TAG = re.compile(r"<v\s+([^>]+)>([^<]*)</v>")
RE_VTT_TIMESTAMP_ARROW = re.compile(
    r"(\d{1,2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}\.\d{3})"
)
RE_OTTER_SPEAKER = re.compile(r"^([A-Za-z][A-Za-z .'\-]+)\s+(\d{1,2}:\d{2})\s*$")
RE_HTML_TAGS = re.compile(r"<[^>]+>")
RE_MULTIPLE_SPACES = re.compile(r" {2,}")


def _clean_text(text: str) -> str:
    text = RE_HTML_TAGS.sub("", text)
    text = unescape(text)
    text = RE_MULTIPLE_SPACES.sub(" ", text)
    return text.strip()


def _normalize(raw: str) -> str:
    if raw.startswith("\ufeff"):
        raw = raw[1:]
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    return raw


def _detect_format(text: str) -> str:
    if RE_WEBVTT_HEADER.search(text) and RE_VTT_VOICE_TAG.search(text):
        return "webvtt_teams"
    if RE_VTT_TIMESTAMP_ARROW.search(text):
        return "zoom_vtt"
    if RE_OTTER_SPEAKER.search(text):
        return "otter_plain"
    return "narrative"


def _parse_webvtt_teams(text: str) -> list[dict]:
    utterances = []
    blocks = text.split("\n\n")
    for block in blocks:
        ts_match = RE_VTT_TIMESTAMP_ARROW.search(block)
        timestamp = ts_match.group(1) if ts_match else None
        for voice_match in RE_VTT_VOICE_TAG.finditer(block):
            speaker = voice_match.group(1).strip()
            content = _clean_text(voice_match.group(2))
            if content:
                utterances.append({"speaker": speaker, "text": content, "timestamp": timestamp})
    return utterances


def _parse_zoom_vtt(text: str) -> list[dict]:
    utterances = []
    blocks = text.split("\n\n")
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 2:
            continue
        ts_match = RE_VTT_TIMESTAMP_ARROW.search(block)
        timestamp = ts_match.group(1) if ts_match else None
        # Find the timestamp line index
        ts_line_idx = None
        for i, line in enumerate(lines):
            if RE_VTT_TIMESTAMP_ARROW.search(line):
                ts_line_idx = i
                break
        if ts_line_idx is None:
            continue
        # Text lines come after the timestamp line
        text_lines = lines[ts_line_idx + 1 :]
        if not text_lines:
            continue
        # Check if first text line is "Speaker: text" pattern
        first_line = text_lines[0]
        colon_idx = first_line.find(":")
        if colon_idx > 0 and colon_idx < 40:
            speaker = first_line[:colon_idx].strip()
            remainder = first_line[colon_idx + 1 :].strip()
            content_parts = [remainder] + [l.strip() for l in text_lines[1:]]
        else:
            speaker = "Unknown"
            content_parts = [l.strip() for l in text_lines]
        content = _clean_text(" ".join(content_parts))
        if content:
            utterances.append({"speaker": speaker, "text": content, "timestamp": timestamp})
    return utterances


def _parse_otter_plain(text: str) -> list[dict]:
    utterances = []
    lines = text.split("\n")
    current_speaker = None
    current_timestamp = None
    current_lines: list[str] = []

    for line in lines:
        m = RE_OTTER_SPEAKER.match(line.strip())
        if m:
            # Save previous utterance
            if current_speaker and current_lines:
                content = _clean_text(" ".join(current_lines))
                if content:
                    utterances.append({
                        "speaker": current_speaker,
                        "text": content,
                        "timestamp": current_timestamp,
                    })
            current_speaker = m.group(1).strip()
            current_timestamp = m.group(2).strip()
            current_lines = []
        else:
            stripped = line.strip()
            if stripped:
                current_lines.append(stripped)

    # Flush last utterance
    if current_speaker and current_lines:
        content = _clean_text(" ".join(current_lines))
        if content:
            utterances.append({
                "speaker": current_speaker,
                "text": content,
                "timestamp": current_timestamp,
            })
    return utterances


def _parse_narrative(text: str) -> list[dict]:
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    utterances = []
    for para in paragraphs:
        content = _clean_text(" ".join(para.split()))
        if content:
            utterances.append({"speaker": "Unknown", "text": content, "timestamp": None})
    return utterances


def _merge_consecutive(utterances: list[dict]) -> list[dict]:
    if not utterances:
        return utterances
    merged = [utterances[0].copy()]
    for utt in utterances[1:]:
        if utt["speaker"] == merged[-1]["speaker"]:
            merged[-1]["text"] += " " + utt["text"]
        else:
            merged.append(utt.copy())
    return merged


def parse_transcript(raw_text: str) -> list[dict]:
    text = _normalize(raw_text)
    fmt = _detect_format(text)

    if fmt == "webvtt_teams":
        utterances = _parse_webvtt_teams(text)
    elif fmt == "zoom_vtt":
        utterances = _parse_zoom_vtt(text)
    elif fmt == "otter_plain":
        utterances = _parse_otter_plain(text)
    else:
        utterances = _parse_narrative(text)

    utterances = _merge_consecutive(utterances)

    for utt in utterances:
        utt["format_detected"] = fmt

    return utterances
