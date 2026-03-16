# Phase 3: Real-Time Meeting Moderation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time meeting moderation — live transcription via WebSocket, participation monitoring, topic drift detection, anonymous idea submission/voting, and a moderator dashboard with room/moderator toggle view.

**Architecture:** `live_session.py` orchestrates a live meeting session. Audio comes in via WebSocket from browser mic capture, gets transcribed by faster-whisper in streaming chunks. Participation stats tracked from diarization. Topic drift detected via embedding similarity to agenda. Anonymous ideas submitted via same WebSocket. All state is in-memory for the session, then flows into Phase 1 pipeline on session end.

**Tech Stack:** Same as Phase 1/2. No new Python dependencies. Frontend adds browser MediaRecorder API for mic capture.

**Spec:** `docs/superpowers/specs/2026-03-15-brainstorm-boost-full-system-design.md` — Section 7

---

## Chunk 1: Live Session Backend

### Task 1: Live Session Orchestrator

**Files:**
- Create: `live_session.py`
- Create: `tests/test_live_session.py`

- [ ] **Step 1: Write tests**

`tests/test_live_session.py`:
```python
import pytest
from live_session import LiveSession


@pytest.fixture
def session():
    return LiveSession(
        agenda="Discuss drone battery options and frequency allocation",
        participants=["Alice", "Bob", "Charlie"],
    )


def test_session_creation(session):
    assert session.session_id is not None
    assert len(session.join_code) == 6
    assert session.join_code.isalnum()
    assert session.agenda_embedding is not None
    assert len(session.transcript) == 0


def test_add_utterance(session):
    session.add_utterance("Alice", "Hello everyone, let's get started")
    assert len(session.transcript) == 1
    assert session.transcript[0]["speaker"] == "Alice"


def test_participation_stats(session):
    session.add_utterance("Alice", "Hello everyone let's get started with the meeting")
    session.add_utterance("Bob", "Sounds good")
    session.add_utterance("Alice", "First topic is drone batteries and their performance")

    stats = session.get_participation_stats()
    assert "Alice" in stats
    assert "Bob" in stats
    assert stats["Alice"]["word_count"] > stats["Bob"]["word_count"]
    assert stats["Alice"]["percentage"] > stats["Bob"]["percentage"]


def test_participation_alerts(session):
    # Alice dominates, Charlie silent
    for _ in range(10):
        session.add_utterance("Alice", "I think we should do this and that and more things")
    session.add_utterance("Bob", "OK")

    alerts = session.get_participation_alerts()
    # Should flag Alice as dominant and Charlie as silent
    alert_messages = [a["message"] for a in alerts]
    assert any("Alice" in m for m in alert_messages)
    assert any("Charlie" in m for m in alert_messages)


def test_topic_drift_on_topic(session):
    session.add_utterance("Alice", "Let's discuss the drone battery options we have")
    session.add_utterance("Bob", "I think lithium polymer is the best frequency for our drones")

    drift = session.check_topic_drift()
    assert "similarity" in drift
    assert "drifted" in drift
    assert drift["similarity"] > 0.2  # Should be somewhat related


def test_topic_drift_off_topic(session):
    # Talk about completely unrelated topic
    for _ in range(5):
        session.add_utterance("Alice", "What should we have for lunch today pizza or sandwiches")

    drift = session.check_topic_drift()
    # Lower similarity expected for off-topic
    assert drift["similarity"] < 0.5


def test_compile_transcript(session):
    session.add_utterance("Alice", "Hello")
    session.add_utterance("Bob", "Hi there")
    session.add_utterance("Alice", "Let's begin")

    raw, utterances = session.compile_transcript()
    assert "Alice" in raw
    assert "Bob" in raw
    assert len(utterances) == 3
    assert utterances[0]["format_detected"] == "live"
```

- [ ] **Step 2: Implement live_session.py**

```python
from __future__ import annotations

import secrets
import string
import time
from datetime import datetime, timezone
from uuid import uuid4

from sentence_transformers import SentenceTransformer
import numpy as np

_embedding_model = None


def _get_embedding_model() -> SentenceTransformer:
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedding_model


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
        model = _get_embedding_model()
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

        model = _get_embedding_model()
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
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_live_session.py -v
```

- [ ] **Step 4: Commit**

```bash
git add live_session.py tests/test_live_session.py
git commit -m "feat: add live session orchestrator with participation tracking and drift detection"
```

---

### Task 2: Idea Board

**Files:**
- Create: `idea_board.py`
- Create: `tests/test_idea_board.py`

- [ ] **Step 1: Write tests**

`tests/test_idea_board.py`:
```python
import pytest
from idea_board import IdeaBoard


@pytest.fixture
def board():
    return IdeaBoard(session_id="test-session")


def test_submit_idea(board):
    idea_id = board.submit_idea("Use solar panels on drones")
    assert idea_id is not None
    assert len(board.ideas) == 1
    assert board.ideas[0]["text"] == "Use solar panels on drones"


def test_submit_multiple(board):
    board.submit_idea("Solar panels")
    board.submit_idea("Wind power")
    board.submit_idea("Battery swap stations")
    assert len(board.ideas) == 3


def test_vote(board):
    idea_id = board.submit_idea("Solar panels")
    board.vote(idea_id, "token-1")
    assert board.ideas[0]["votes"] == 1

    board.vote(idea_id, "token-2")
    assert board.ideas[0]["votes"] == 2


def test_vote_once_per_token(board):
    idea_id = board.submit_idea("Solar panels")
    board.vote(idea_id, "token-1")
    board.vote(idea_id, "token-1")  # duplicate
    assert board.ideas[0]["votes"] == 1


def test_get_results(board):
    id1 = board.submit_idea("Solar panels")
    id2 = board.submit_idea("Wind power")
    board.vote(id2, "token-1")
    board.vote(id2, "token-2")
    board.vote(id1, "token-3")

    results = board.get_results()
    assert results[0]["text"] == "Wind power"  # More votes
    assert results[0]["votes"] == 2
    assert results[1]["text"] == "Solar panels"
    assert results[1]["votes"] == 1
```

- [ ] **Step 2: Implement idea_board.py**

```python
from __future__ import annotations

from uuid import uuid4


class IdeaBoard:
    """Anonymous idea submission and voting for live sessions."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.ideas: list[dict] = []
        self._votes: dict[str, set[str]] = {}  # idea_id -> set of voter tokens

    def submit_idea(self, text: str) -> str:
        idea_id = str(uuid4())
        self.ideas.append({
            "id": idea_id,
            "text": text.strip(),
            "votes": 0,
        })
        self._votes[idea_id] = set()
        return idea_id

    def vote(self, idea_id: str, voter_token: str) -> bool:
        if idea_id not in self._votes:
            return False
        if voter_token in self._votes[idea_id]:
            return False  # Already voted

        self._votes[idea_id].add(voter_token)
        for idea in self.ideas:
            if idea["id"] == idea_id:
                idea["votes"] += 1
                return True
        return False

    def get_results(self) -> list[dict]:
        return sorted(self.ideas, key=lambda x: x["votes"], reverse=True)
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_idea_board.py -v
```

- [ ] **Step 4: Commit**

```bash
git add idea_board.py tests/test_idea_board.py
git commit -m "feat: add anonymous idea board with voting"
```

---

### Task 3: Live Session WebSocket & HTTP Endpoints

**Files:**
- Create: `routes/live.py`
- Modify: `main.py` (register live router)

- [ ] **Step 1: Implement routes/live.py**

```python
from __future__ import annotations

import asyncio
import json
import secrets
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from live_session import LiveSession
from idea_board import IdeaBoard

router = APIRouter(tags=["live"])

# Single active session (MVP — one session at a time)
_active_session: LiveSession | None = None
_active_board: IdeaBoard | None = None
_connected_clients: dict[str, WebSocket] = {}  # token -> websocket
_moderator_token: str | None = None


def _get_session() -> LiveSession:
    if _active_session is None:
        raise HTTPException(status_code=404, detail="No active live session")
    return _active_session


@router.post("/api/live/start")
async def start_session(request: Request):
    global _active_session, _active_board, _moderator_token, _connected_clients

    body = await request.json()
    agenda = body.get("agenda")
    participants = body.get("participants", [])

    if not agenda:
        raise HTTPException(status_code=400, detail="agenda is required")

    # End any existing session
    _connected_clients = {}
    _moderator_token = str(uuid4())

    _active_session = LiveSession(agenda=agenda, participants=participants)
    _active_board = IdeaBoard(session_id=_active_session.session_id)

    return {
        "session_id": _active_session.session_id,
        "join_code": _active_session.join_code,
        "moderator_token": _moderator_token,
    }


@router.post("/api/live/end")
async def end_session(request: Request):
    global _active_session, _active_board, _moderator_token

    session = _get_session()

    # Compile transcript and feed into Phase 1 pipeline
    raw_text, utterances = session.compile_transcript()

    meeting_id = None
    if utterances:
        from database import create_meeting
        meeting_id = create_meeting(
            title=f"Live: {session.agenda[:50]}",
            raw_transcript=raw_text,
            utterances=utterances,
        )

    # Notify all clients
    for token, ws in _connected_clients.items():
        try:
            await ws.send_json({"type": "session_ended", "meeting_id": meeting_id})
        except Exception:
            pass

    _active_session = None
    _active_board = None
    _moderator_token = None

    return {"meeting_id": meeting_id, "status": "ended"}


@router.get("/api/live/status")
async def session_status():
    if _active_session is None:
        return {"active": False}
    return {
        "active": True,
        "session_id": _active_session.session_id,
        "join_code": _active_session.join_code,
        "participant_count": len(_connected_clients),
        "utterance_count": len(_active_session.transcript),
    }


@router.websocket("/ws/session")
async def websocket_session(websocket: WebSocket, code: str = "", role: str = "participant"):
    global _active_session, _active_board

    await websocket.accept()

    if _active_session is None:
        await websocket.send_json({"type": "error", "message": "No active session"})
        await websocket.close()
        return

    if code != _active_session.join_code and role != "moderator":
        await websocket.send_json({"type": "error", "message": "Invalid join code"})
        await websocket.close()
        return

    # Assign a session token
    client_token = str(uuid4())
    _connected_clients[client_token] = websocket
    is_moderator = role == "moderator"

    try:
        await websocket.send_json({
            "type": "connected",
            "token": client_token,
            "role": role,
            "session_id": _active_session.session_id,
        })

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "utterance" and is_moderator:
                # Moderator sends transcribed utterances
                speaker = data.get("speaker", "Unknown")
                text = data.get("text", "")
                if text.strip():
                    _active_session.add_utterance(speaker, text)
                    # Broadcast to all clients
                    await _broadcast({
                        "type": "utterance",
                        "speaker": speaker,
                        "text": text,
                        "timestamp": _active_session.transcript[-1]["timestamp"],
                    })

                    # Send moderator-only updates periodically
                    if len(_active_session.transcript) % 3 == 0:
                        await _send_moderator_updates(websocket)

            elif msg_type == "submit_idea":
                text = data.get("text", "").strip()
                if text and _active_board:
                    idea_id = _active_board.submit_idea(text)
                    await _broadcast({
                        "type": "ideas_update",
                        "ideas": _active_board.get_results(),
                    })

            elif msg_type == "vote":
                idea_id = data.get("idea_id")
                if idea_id and _active_board:
                    _active_board.vote(idea_id, client_token)
                    await _broadcast({
                        "type": "ideas_update",
                        "ideas": _active_board.get_results(),
                    })

            elif msg_type == "request_stats" and is_moderator:
                await _send_moderator_updates(websocket)

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _connected_clients.pop(client_token, None)


async def _broadcast(message: dict):
    dead = []
    for token, ws in _connected_clients.items():
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(token)
    for t in dead:
        _connected_clients.pop(t, None)


async def _send_moderator_updates(ws: WebSocket):
    if _active_session is None:
        return

    stats = _active_session.get_participation_stats()
    alerts = _active_session.get_participation_alerts()
    drift = _active_session.check_topic_drift()

    try:
        await ws.send_json({"type": "participation", "stats": stats})
        await ws.send_json({"type": "drift", **drift})
        if alerts:
            for alert in alerts:
                await ws.send_json({"type": "alert", **alert})
    except Exception:
        pass


    # Context surfacing from past meetings
    try:
        if len(_active_session.transcript) >= 5:
            recent_text = " ".join(u["text"] for u in _active_session.transcript[-5:])
            from routes.query import get_memory
            memory = get_memory()
            context = memory.query(recent_text, top_k=3)
            if context:
                await ws.send_json({"type": "context", "items": context})
    except Exception:
        pass
```

- [ ] **Step 2: Register in main.py**

Add:
```python
from routes import upload, analyze, meetings, query, prep, live
app.include_router(live.router)
```

- [ ] **Step 3: Run all tests**

```bash
pytest tests/ -v
```

- [ ] **Step 4: Commit**

```bash
git add routes/live.py main.py
git commit -m "feat: add live session WebSocket and HTTP endpoints"
```

---

## Chunk 2: Live Meeting Frontend

### Task 4: Live Meeting View (Room + Moderator Toggle)

**Files:**
- Create: `frontend/src/components/live/LiveView.tsx`
- Create: `frontend/src/components/live/RoomView.tsx`
- Create: `frontend/src/components/live/ModeratorView.tsx`
- Create: `frontend/src/components/live/IdeaPanel.tsx`
- Create: `frontend/src/components/live/JoinView.tsx`
- Modify: `frontend/src/lib/api.ts` (add live API methods)
- Modify: `frontend/src/App.tsx` (add Live tab)
- Modify: `frontend/src/components/layout/Header.tsx` (add Live tab)

- [ ] **Step 1: Add live API methods to api.ts**

Add to the api object:
```typescript
async startLiveSession(agenda: string, participants: string[]) {
    const res = await fetch(`${BASE}/api/live/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agenda, participants }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
},

async endLiveSession() {
    const res = await fetch(`${BASE}/api/live/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
},

async getLiveStatus() {
    const res = await fetch(`${BASE}/api/live/status`);
    return res.json();
},
```

- [ ] **Step 2: Create LiveView.tsx — main container**

State machine: Setup → Active (Room/Moderator toggle) → Ended

**Setup state:** Agenda textarea, participants input, "Start Live Session" button. On start → calls api.startLiveSession(), connects WebSocket, transitions to Active.

**Active state:** Toggle between RoomView and ModeratorView with Ctrl+M or button. Shows meeting timer. "End Session" button.

**WebSocket connection:** Connect to `ws://localhost:8000/ws/session?code={joinCode}&role=moderator`. Handle incoming messages by type (utterance, participation, drift, context, alert, ideas_update).

**Audio capture:** Use browser MediaRecorder API to capture mic audio. For the MVP, instead of streaming raw audio, capture speech in the browser using the Web Speech API (SpeechRecognition) and send text utterances to the server. This avoids the complexity of streaming audio processing and works well for demo purposes.

```typescript
// Simplified approach: use Web Speech API for browser-side STT
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = true;
recognition.interimResults = false;
recognition.onresult = (event) => {
    const text = event.results[event.results.length - 1][0].transcript;
    ws.send(JSON.stringify({ type: "utterance", speaker: "Moderator", text }));
};
```

- [ ] **Step 3: Create RoomView.tsx — shareable view**

Shows:
- Live scrolling transcript (auto-scroll to bottom)
- Meeting timer (elapsed time)
- Idea board results (if ideas have been submitted)
- Join code displayed prominently for participants

- [ ] **Step 4: Create ModeratorView.tsx — private view**

Shows:
- Live transcript (same as room view)
- **Participation panel:** Horizontal bar chart per speaker showing % of words. Color-coded (dominant = red, balanced = green, silent = gray).
- **Topic drift indicator:** Similarity gauge (0-1). Green when on-topic, yellow when drifting, red when off-topic.
- **Context cards:** Related past meeting items surfaced from ChromaDB.
- **Alert queue:** Participation alerts (dominant/silent speakers).
- **Controls:** Toggle idea collection, end session.

- [ ] **Step 5: Create IdeaPanel.tsx**

Shows:
- Text input for anonymous idea submission
- List of submitted ideas sorted by votes
- Vote button per idea (one vote per user enforced by token)

- [ ] **Step 6: Create JoinView.tsx — participant join page**

Mobile-friendly page. Accessible at the /join path.
- Enter join code input
- Once joined: see live transcript + idea submission + voting
- No moderator features visible

- [ ] **Step 7: Update Header and App**

Add "Live" tab (Radio icon from lucide-react). Add `'live'` and `'join'` to View type.

Handle the `/join` URL path — if window.location.pathname is `/join`, show JoinView directly.

- [ ] **Step 8: Build and verify**

```bash
cd /Users/bibas/Work/DS4D/brainstorm-boost/frontend && npm run build
```

- [ ] **Step 9: Commit**

```bash
cd /Users/bibas/Work/DS4D/brainstorm-boost
git add frontend/src/ main.py
git commit -m "feat: add live meeting view with room/moderator toggle, ideas, and join page"
```

---

## Chunk 3: Integration & Final

### Task 5: End-to-End Verification

- [ ] **Step 1: Run full test suite**

```bash
pytest tests/ -v
```

- [ ] **Step 2: Build frontend**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Manual verification**

```bash
uvicorn main:app --reload --port 8000
```

Verify:
1. Start a live session from the Live tab
2. Join code displays
3. Open http://localhost:8000/join in another browser tab, enter code
4. Speak into mic → text appears in transcript (via Web Speech API)
5. Submit ideas from join page → ideas appear in room view
6. Toggle moderator view (Ctrl+M) → see participation stats
7. End session → meeting created, navigate to Review to verify

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: address Phase 3 verification issues"
```
