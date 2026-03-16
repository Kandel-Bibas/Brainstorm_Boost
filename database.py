from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "brainstorm_boost.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                raw_transcript TEXT NOT NULL,
                utterances_json TEXT,
                ai_output_json TEXT,
                verified_output_json TEXT,
                status TEXT NOT NULL DEFAULT 'uploaded'
            );
            CREATE TABLE IF NOT EXISTS exports (
                id TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                format TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id)
            );
        """)


def create_meeting(title: str, raw_transcript: str, utterances: list[dict]) -> str:
    meeting_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO meetings (id, title, created_at, raw_transcript, utterances_json, status) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (meeting_id, title, now, raw_transcript, json.dumps(utterances), "uploaded"),
        )
    return meeting_id


def get_meeting(meeting_id: str):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
    if row is None:
        return None
    result = dict(row)
    for field in ("utterances_json", "ai_output_json", "verified_output_json"):
        if result[field] is not None:
            result[field] = json.loads(result[field])
    return result


def list_meetings() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, status FROM meetings ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def update_ai_output(meeting_id: str, ai_output: dict):
    with get_connection() as conn:
        conn.execute(
            "UPDATE meetings SET ai_output_json = ?, status = ? WHERE id = ?",
            (json.dumps(ai_output), "analyzed", meeting_id),
        )


def update_verified_output(meeting_id: str, verified_output: dict):
    with get_connection() as conn:
        conn.execute(
            "UPDATE meetings SET verified_output_json = ?, status = ? WHERE id = ?",
            (json.dumps(verified_output), "approved", meeting_id),
        )


def record_export(meeting_id: str, filename: str, fmt: str) -> str:
    export_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO exports (id, meeting_id, filename, format, created_at) VALUES (?, ?, ?, ?, ?)",
            (export_id, meeting_id, filename, fmt, now),
        )
    return export_id
