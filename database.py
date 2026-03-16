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
            CREATE TABLE IF NOT EXISTS action_items (
                id TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL,
                task TEXT NOT NULL,
                owner TEXT,
                deadline TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                confidence TEXT,
                source_quote TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id)
            );
            CREATE TABLE IF NOT EXISTS speaker_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                topics_json TEXT,
                meeting_count INTEGER DEFAULT 0,
                last_seen TEXT,
                expertise_summary TEXT
            );
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sources_json TEXT,
                context_meeting_id TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
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


# ---------------------------------------------------------------------------
# action_items
# ---------------------------------------------------------------------------

def create_action_item(
    meeting_id: str,
    task: str,
    owner: str | None = None,
    deadline: str | None = None,
    confidence: str | None = None,
    source_quote: str | None = None,
) -> str:
    item_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO action_items "
            "(id, meeting_id, task, owner, deadline, status, confidence, source_quote, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)",
            (item_id, meeting_id, task, owner, deadline, confidence, source_quote, now),
        )
    return item_id


def get_open_action_items(participant: str | None = None) -> list[dict]:
    query = (
        "SELECT a.*, m.title AS meeting_title "
        "FROM action_items a "
        "JOIN meetings m ON a.meeting_id = m.id "
        "WHERE a.status = 'open'"
    )
    params: list = []
    if participant is not None:
        query += " AND a.owner = ?"
        params.append(participant)
    query += " ORDER BY a.created_at DESC"
    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def update_action_item_status(item_id: str, status: str):
    with get_connection() as conn:
        conn.execute(
            "UPDATE action_items SET status = ? WHERE id = ?",
            (status, item_id),
        )


# ---------------------------------------------------------------------------
# speaker_profiles
# ---------------------------------------------------------------------------

def upsert_speaker_profile(
    name: str,
    topics: list[str] | None = None,
    meeting_count: int = 0,
    expertise_summary: str | None = None,
):
    now = datetime.now(timezone.utc).isoformat()
    topics_json = json.dumps(topics) if topics is not None else json.dumps([])
    with get_connection() as conn:
        existing = conn.execute(
            "SELECT id, meeting_count, topics_json FROM speaker_profiles WHERE name = ?", (name,)
        ).fetchone()
        if existing is None:
            profile_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO speaker_profiles "
                "(id, name, topics_json, meeting_count, last_seen, expertise_summary) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (profile_id, name, topics_json, meeting_count, now, expertise_summary),
            )
        else:
            # Merge topics (union), accumulate meeting_count
            existing_topics: list[str] = json.loads(existing["topics_json"]) if existing["topics_json"] else []
            new_topics_raw: list[str] = topics if topics is not None else []
            merged_topics = list(dict.fromkeys(existing_topics + new_topics_raw))
            new_count = existing["meeting_count"] + meeting_count
            conn.execute(
                "UPDATE speaker_profiles "
                "SET topics_json = ?, meeting_count = ?, last_seen = ?, expertise_summary = COALESCE(?, expertise_summary) "
                "WHERE name = ?",
                (json.dumps(merged_topics), new_count, now, expertise_summary, name),
            )


def get_speaker_profiles() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM speaker_profiles ORDER BY name"
        ).fetchall()
    result = []
    for row in rows:
        profile = dict(row)
        raw = profile.pop("topics_json", None)
        profile["topics"] = json.loads(raw) if raw else []
        result.append(profile)
    return result


def get_speaker_profile_by_name(name: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM speaker_profiles WHERE name = ?", (name,)
        ).fetchone()
    if row is None:
        return None
    profile = dict(row)
    raw = profile.pop("topics_json", None)
    profile["topics"] = json.loads(raw) if raw else []
    return profile


# ---------------------------------------------------------------------------
# chat_sessions / chat_messages
# ---------------------------------------------------------------------------

def create_chat_session() -> str:
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO chat_sessions (id, created_at) VALUES (?, ?)",
            (session_id, now),
        )
    return session_id


def get_chat_session(session_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM chat_sessions WHERE id = ?", (session_id,)
        ).fetchone()
    if row is None:
        return None
    return dict(row)


def add_chat_message(
    session_id: str,
    role: str,
    content: str,
    sources: list | None = None,
    context_meeting_id: str | None = None,
) -> str:
    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    sources_json = json.dumps(sources) if sources is not None else None
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO chat_messages "
            "(id, session_id, role, content, sources_json, context_meeting_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (msg_id, session_id, role, content, sources_json, context_meeting_id, now),
        )
    return msg_id


def get_chat_messages(session_id: str, limit: int | None = None) -> list[dict]:
    with get_connection() as conn:
        if limit is not None:
            # Get the most recent N messages, then return in chronological order
            rows = conn.execute(
                "SELECT * FROM ("
                "  SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?"
                ") ORDER BY created_at ASC",
                (session_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()

    result = []
    for row in rows:
        msg = dict(row)
        raw_sources = msg.pop("sources_json", None)
        msg["sources"] = json.loads(raw_sources) if raw_sources is not None else None
        result.append(msg)
    return result
