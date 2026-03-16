from __future__ import annotations

import secrets
import string
import time
from uuid import uuid4

import numpy as np

from embeddings import get_embedding_model


def _generate_join_code(length: int = 6) -> str:
    chars = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(chars) for _ in range(length))


class LiveSession:
    """Orchestrates a live meeting session with real-time features."""

    DRIFT_THRESHOLD = 0.35
    DOMINANT_THRESHOLD = 0.45  # > 45% of words = dominant
    SILENT_THRESHOLD = 60  # seconds without speaking

    def __init__(self, agenda: str, participants: list[str]):
        self.session_id = str(uuid4())
        self.join_code = _generate_join_code()
        self.agenda = agenda
        self.participants = participants
        self.transcript: list[dict] = []
        self.start_time = time.time()
        self._last_spoke: dict[str, float] = {}

        # Pre-compute agenda embedding for drift detection
        model = get_embedding_model()
        self.agenda_embedding = model.encode(agenda)

    def add_utterance(self, speaker: str, text: str):
        now = time.time()
        elapsed = now - self.start_time
        seconds = int(elapsed)
        ts = f"{seconds // 3600:02d}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"

        self.transcript.append({
            "speaker": speaker,
            "text": text,
            "timestamp": ts,
            "time_seconds": elapsed,
        })
        self._last_spoke[speaker] = now

    def get_participation_stats(self) -> dict:
        word_counts: dict[str, int] = {}
        for utt in self.transcript:
            speaker = utt["speaker"]
            words = len(utt["text"].split())
            word_counts[speaker] = word_counts.get(speaker, 0) + words

        total_words = sum(word_counts.values()) or 1

        stats = {}
        now = time.time()
        for speaker in set(list(word_counts.keys()) + self.participants):
            wc = word_counts.get(speaker, 0)
            last = self._last_spoke.get(speaker)
            stats[speaker] = {
                "word_count": wc,
                "percentage": round(wc / total_words * 100, 1),
                "seconds_since_last_spoke": round(now - last, 1) if last else None,
            }
        return stats

    def get_participation_alerts(self) -> list[dict]:
        stats = self.get_participation_stats()
        alerts = []
        now = time.time()

        for speaker, s in stats.items():
            if s["percentage"] > self.DOMINANT_THRESHOLD * 100:
                alerts.append({
                    "severity": "warning",
                    "message": f"{speaker} has {s['percentage']}% of speaking time",
                })

            last = self._last_spoke.get(speaker)
            if speaker in self.participants and (last is None or now - last > self.SILENT_THRESHOLD):
                if len(self.transcript) > 3:  # Only alert after conversation has started
                    alerts.append({
                        "severity": "info",
                        "message": f"{speaker} hasn't spoken" + (f" in {int(now - last)}s" if last else ""),
                    })

        return alerts

    def check_topic_drift(self, window_seconds: int = 60) -> dict:
        if not self.transcript:
            return {"similarity": 1.0, "drifted": False}

        # Get recent text
        now = time.time()
        cutoff = now - self.start_time - window_seconds
        recent_text = " ".join(
            u["text"] for u in self.transcript
            if u["time_seconds"] >= max(cutoff, 0)
        )

        if not recent_text.strip():
            return {"similarity": 1.0, "drifted": False}

        model = get_embedding_model()
        recent_embedding = model.encode(recent_text)

        similarity = float(np.dot(self.agenda_embedding, recent_embedding) / (
            np.linalg.norm(self.agenda_embedding) * np.linalg.norm(recent_embedding) + 1e-8
        ))

        return {
            "similarity": round(similarity, 3),
            "drifted": similarity < self.DRIFT_THRESHOLD,
        }

    def compile_transcript(self) -> tuple[str, list[dict]]:
        raw_lines = []
        utterances = []
        for u in self.transcript:
            raw_lines.append(f"[{u['timestamp']}] {u['speaker']}: {u['text']}")
            utterances.append({
                "speaker": u["speaker"],
                "text": u["text"],
                "timestamp": u["timestamp"],
                "format_detected": "live",
            })
        return "\n".join(raw_lines), utterances
