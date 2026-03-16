# Phase 2: Pre-Meeting Preparation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pre-meeting intelligence — auto-generated read-aheads, open items carry-forward, participant recommendations, and assumption surfacing. All powered by Phase 1's ChromaDB knowledge base.

**Architecture:** New `meeting_prep.py` module queries ChromaDB + SQLite, uses LLM for synthesis. New `routes/prep.py` exposes endpoints. Database extended with `action_items` and `speaker_profiles` tables. Frontend gets a new "Prepare" view.

**Tech Stack:** Same as Phase 1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-15-brainstorm-boost-full-system-design.md` — Section 6

---

## Chunk 1: Database Extensions & Action Item Extraction

### Task 1: Extend Database Schema

**Files:**
- Modify: `database.py`
- Create: `tests/test_database.py`

- [ ] **Step 1: Write tests for new tables and functions**

`tests/test_database.py`:
```python
import pytest
from database import (
    init_db, create_meeting, get_meeting,
    create_action_item, get_open_action_items, update_action_item_status,
    upsert_speaker_profile, get_speaker_profiles, get_speaker_profile_by_name,
)


def test_create_and_get_action_item():
    meeting_id = create_meeting("Test", "raw text", [{"speaker": "A", "text": "hello", "timestamp": "0:00", "format_detected": "narrative"}])
    item_id = create_action_item(
        meeting_id=meeting_id,
        task="Research batteries",
        owner="Bob",
        deadline="Friday",
        confidence="high",
        source_quote="I'll look into it by Friday",
    )
    items = get_open_action_items()
    assert len(items) >= 1
    assert any(i["id"] == item_id for i in items)


def test_update_action_item_status():
    meeting_id = create_meeting("Test", "raw text", [{"speaker": "A", "text": "hello", "timestamp": "0:00", "format_detected": "narrative"}])
    item_id = create_action_item(meeting_id=meeting_id, task="Do thing", owner="Alice")
    update_action_item_status(item_id, "completed")
    items = get_open_action_items()
    assert not any(i["id"] == item_id for i in items)


def test_filter_action_items_by_owner():
    meeting_id = create_meeting("Test", "raw text", [{"speaker": "A", "text": "hello", "timestamp": "0:00", "format_detected": "narrative"}])
    create_action_item(meeting_id=meeting_id, task="Task A", owner="Alice")
    create_action_item(meeting_id=meeting_id, task="Task B", owner="Bob")
    items = get_open_action_items(participant="Alice")
    assert all(i["owner"] == "Alice" for i in items)


def test_upsert_speaker_profile():
    upsert_speaker_profile("Alice", topics=["drones", "batteries"], meeting_count=3)
    profile = get_speaker_profile_by_name("Alice")
    assert profile is not None
    assert profile["name"] == "Alice"
    assert "drones" in profile["topics"]
    assert profile["meeting_count"] == 3

    # Upsert again with more meetings
    upsert_speaker_profile("Alice", topics=["drones", "batteries", "sensors"], meeting_count=5)
    profile = get_speaker_profile_by_name("Alice")
    assert profile["meeting_count"] == 5
    assert "sensors" in profile["topics"]


def test_get_all_speaker_profiles():
    upsert_speaker_profile("Alice", topics=["drones"], meeting_count=2)
    upsert_speaker_profile("Bob", topics=["comms"], meeting_count=1)
    profiles = get_speaker_profiles()
    assert len(profiles) >= 2
```

- [ ] **Step 2: Run tests — should fail (functions don't exist)**

```bash
pytest tests/test_database.py -v
```

- [ ] **Step 3: Add new tables to init_db()**

Add to `database.py` `init_db()`:
```sql
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
```

- [ ] **Step 4: Add CRUD functions**

```python
def create_action_item(meeting_id: str, task: str, owner: str = None,
                       deadline: str = None, confidence: str = None,
                       source_quote: str = None) -> str:
    item_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO action_items (id, meeting_id, task, owner, deadline, status, confidence, source_quote, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)",
            (item_id, meeting_id, task, owner, deadline, confidence, source_quote, now),
        )
    return item_id


def get_open_action_items(participant: str = None, topic: str = None) -> list[dict]:
    with get_connection() as conn:
        query = "SELECT ai.*, m.title as meeting_title FROM action_items ai JOIN meetings m ON ai.meeting_id = m.id WHERE ai.status = 'open'"
        params = []
        if participant:
            query += " AND ai.owner = ?"
            params.append(participant)
        query += " ORDER BY ai.created_at DESC"
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def update_action_item_status(item_id: str, status: str):
    with get_connection() as conn:
        conn.execute("UPDATE action_items SET status = ? WHERE id = ?", (status, item_id))


def upsert_speaker_profile(name: str, topics: list[str] = None,
                           meeting_count: int = 0, expertise_summary: str = None):
    profile_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    topics_json = json.dumps(topics or [])
    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM speaker_profiles WHERE name = ?", (name,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE speaker_profiles SET topics_json = ?, meeting_count = ?, last_seen = ?, expertise_summary = COALESCE(?, expertise_summary) WHERE name = ?",
                (topics_json, meeting_count, now, expertise_summary, name),
            )
        else:
            conn.execute(
                "INSERT INTO speaker_profiles (id, name, topics_json, meeting_count, last_seen, expertise_summary) VALUES (?, ?, ?, ?, ?, ?)",
                (profile_id, name, topics_json, meeting_count, now, expertise_summary),
            )


def get_speaker_profiles() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM speaker_profiles ORDER BY meeting_count DESC").fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["topics"] = json.loads(d.pop("topics_json", "[]"))
        result.append(d)
    return result


def get_speaker_profile_by_name(name: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM speaker_profiles WHERE name = ?", (name,)).fetchone()
    if row is None:
        return None
    d = dict(row)
    d["topics"] = json.loads(d.pop("topics_json", "[]"))
    return d
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_database.py -v
```
All 5 tests should PASS.

- [ ] **Step 6: Run full test suite**

```bash
pytest tests/ -v
```

- [ ] **Step 7: Commit**

```bash
git add database.py tests/test_database.py
git commit -m "feat: extend database with action_items and speaker_profiles tables"
```

---

### Task 2: Auto-Extract Action Items on Approve

When a meeting is approved, extract action items from the verified output and insert them into the `action_items` table. Also update speaker profiles.

**Files:**
- Modify: `routes/analyze.py`
- Create: `tests/test_auto_extract.py`

- [ ] **Step 1: Write test**

`tests/test_auto_extract.py`:
```python
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch
from main import app
from database import get_open_action_items, get_speaker_profiles

transport = ASGITransport(app=app)

MOCK_OUTPUT = {
    "meeting_metadata": {
        "title": "Test Meeting",
        "date_mentioned": None,
        "participants": ["Alice", "Bob"],
        "duration_estimate": None,
    },
    "decisions": [],
    "action_items": [
        {"id": "A1", "task": "Research batteries", "owner": "Bob", "deadline": "Friday",
         "confidence": "high", "source_quote": "I'll look into it"},
        {"id": "A2", "task": "Write report", "owner": "Alice", "deadline": None,
         "confidence": "medium", "source_quote": "I can probably write that up"},
    ],
    "open_risks": [],
    "state_of_direction": "Testing.",
    "trust_flags": [],
}


@pytest.mark.asyncio
async def test_approve_extracts_action_items():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Upload
        res = await client.post("/api/upload-transcript", data={"text": " ".join(["word"] * 60)})
        meeting_id = res.json()["meeting_id"]

        # Store AI output
        from database import update_ai_output
        update_ai_output(meeting_id, MOCK_OUTPUT)

        # Approve
        res = await client.post("/api/approve", json={
            "meeting_id": meeting_id,
            "verified_output": MOCK_OUTPUT,
        })
        assert res.status_code == 200

        # Verify action items were extracted
        items = get_open_action_items()
        assert len(items) >= 2
        tasks = [i["task"] for i in items]
        assert "Research batteries" in tasks
        assert "Write report" in tasks


@pytest.mark.asyncio
async def test_approve_updates_speaker_profiles():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/api/upload-transcript", data={"text": " ".join(["word"] * 60)})
        meeting_id = res.json()["meeting_id"]

        from database import update_ai_output
        update_ai_output(meeting_id, MOCK_OUTPUT)

        res = await client.post("/api/approve", json={
            "meeting_id": meeting_id,
            "verified_output": MOCK_OUTPUT,
        })
        assert res.status_code == 200

        profiles = get_speaker_profiles()
        names = [p["name"] for p in profiles]
        assert "Alice" in names
        assert "Bob" in names
```

- [ ] **Step 2: Add extraction logic to approve endpoint**

In `routes/analyze.py`, after the existing auto-index code in the `approve()` function, add:

```python
    # Extract action items into dedicated table
    try:
        from database import create_action_item, upsert_speaker_profile
        for a in verified_output.get("action_items", []):
            create_action_item(
                meeting_id=meeting_id,
                task=a.get("task", ""),
                owner=a.get("owner"),
                deadline=a.get("deadline"),
                confidence=a.get("confidence"),
                source_quote=a.get("source_quote"),
            )
        # Update speaker profiles from participants
        participants = verified_output.get("meeting_metadata", {}).get("participants", [])
        for name in participants:
            # Simple topic extraction from the meeting title
            title = verified_output.get("meeting_metadata", {}).get("title", "")
            upsert_speaker_profile(
                name=name,
                topics=[title] if title else [],
                meeting_count=1,  # Will be incremented properly in future
            )
    except Exception:
        pass  # Don't fail approve if extraction fails
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_auto_extract.py -v
```

- [ ] **Step 4: Run full suite**

```bash
pytest tests/ -v
```

- [ ] **Step 5: Commit**

```bash
git add routes/analyze.py tests/test_auto_extract.py
git commit -m "feat: auto-extract action items and speaker profiles on meeting approval"
```

---

## Chunk 2: Meeting Prep Engine & API

### Task 3: Build Meeting Prep Engine

**Files:**
- Create: `meeting_prep.py`
- Create: `tests/test_meeting_prep.py`

- [ ] **Step 1: Write tests**

`tests/test_meeting_prep.py`:
```python
import pytest
from unittest.mock import patch
from meeting_prep import get_open_items_for_prep, get_related_context
from meeting_memory import MeetingMemory
from database import create_meeting, create_action_item, upsert_speaker_profile


@pytest.fixture
def memory(tmp_path):
    return MeetingMemory(persist_dir=str(tmp_path / "chroma_test"))


def test_get_open_items_for_prep():
    meeting_id = create_meeting("Test", "raw", [{"speaker": "A", "text": "hello", "timestamp": "0:00", "format_detected": "narrative"}])
    create_action_item(meeting_id=meeting_id, task="Research drones", owner="Bob", deadline="Friday")
    create_action_item(meeting_id=meeting_id, task="Write budget", owner="Alice")

    # Get all open items
    items = get_open_items_for_prep()
    assert len(items) >= 2

    # Filter by participant
    items = get_open_items_for_prep(participants=["Bob"])
    assert all(i["owner"] == "Bob" for i in items)


def test_get_related_context(memory):
    sample_output = {
        "meeting_metadata": {"title": "Drone Review"},
        "decisions": [{"id": "D1", "description": "Use 5.8 GHz frequency", "source_quote": "go with 5.8"}],
        "action_items": [],
        "open_risks": [],
        "state_of_direction": "Frequency decided.",
    }
    memory.index_meeting("m1", sample_output)

    results = get_related_context("drone frequency allocation", memory)
    assert len(results) > 0
    assert any("5.8" in r["content"] for r in results)
```

- [ ] **Step 2: Implement meeting_prep.py**

```python
from __future__ import annotations

from database import get_open_action_items, get_speaker_profiles
from meeting_memory import MeetingMemory


def get_open_items_for_prep(participants: list[str] = None) -> list[dict]:
    """Get open action items, optionally filtered by participant list."""
    if participants:
        items = []
        for p in participants:
            items.extend(get_open_action_items(participant=p))
        # Deduplicate by id
        seen = set()
        unique = []
        for item in items:
            if item["id"] not in seen:
                seen.add(item["id"])
                unique.append(item)
        return unique
    return get_open_action_items()


def get_related_context(agenda: str, memory: MeetingMemory, top_k: int = 5) -> list[dict]:
    """Search past meetings for context related to the agenda."""
    return memory.query(agenda, top_k=top_k)


def recommend_participants(agenda: str, memory: MeetingMemory) -> list[dict]:
    """Recommend participants based on expertise matching the agenda topic."""
    # Search for who has spoken about related topics
    related = memory.query(agenda, top_k=10)

    # Count mentions per meeting title (as proxy for who was involved)
    speaker_counts: dict[str, int] = {}
    for item in related:
        title = item.get("meeting_title", "")
        speaker_counts[title] = speaker_counts.get(title, 0) + 1

    # Cross-reference with speaker profiles
    profiles = get_speaker_profiles()
    recommendations = []
    for profile in profiles:
        # Check if any of their topics overlap with the agenda
        topic_match = any(
            topic.lower() in agenda.lower() or agenda.lower() in topic.lower()
            for topic in profile.get("topics", [])
        )
        if topic_match:
            recommendations.append({
                "name": profile["name"],
                "reason": f"Discussed related topics in {profile['meeting_count']} past meetings",
                "past_contributions": profile["meeting_count"],
                "topics": profile.get("topics", []),
            })

    return sorted(recommendations, key=lambda x: x["past_contributions"], reverse=True)


def generate_read_ahead(agenda: str, participants: list[str],
                        memory: MeetingMemory, provider: str = None) -> dict:
    """Generate a pre-meeting read-ahead brief.

    Combines related past context, open action items, and LLM synthesis.
    """
    from llm_client import generate

    # Gather context
    related_context = get_related_context(agenda, memory)
    open_items = get_open_items_for_prep(participants)
    recommended = recommend_participants(agenda, memory)

    if not related_context and not open_items:
        return {
            "summary": "No relevant past meeting data found. This appears to be a new topic.",
            "related_decisions": [],
            "open_items": [],
            "recommended_participants": recommended,
            "assumptions": [],
        }

    # Format context for LLM
    context_text = ""
    if related_context:
        context_text += "Related past meeting items:\n"
        for item in related_context:
            context_text += f"- [{item['meeting_title']}] {item['content']}\n"

    items_text = ""
    if open_items:
        items_text += "\nOpen action items for attendees:\n"
        for item in open_items:
            items_text += f"- {item['task']} (Owner: {item.get('owner', 'Unassigned')}, Deadline: {item.get('deadline', 'None')})\n"

    prompt = f"""Generate a pre-meeting read-ahead brief for the following meeting.

Meeting Agenda: {agenda}
Participants: {', '.join(participants)}

{context_text}
{items_text}

Return a JSON object with this format:
{{
    "summary": "2-3 paragraph briefing summarizing relevant context from past meetings",
    "related_decisions": ["list of past decisions relevant to this meeting's agenda"],
    "assumptions": ["list of assumptions the organizer may be making about what attendees know"]
}}

Be concise and actionable. Focus on what participants need to know before walking in."""

    try:
        result = generate(prompt, provider=provider)
    except Exception:
        result = {
            "summary": "Unable to generate AI summary. See related context and open items below.",
            "related_decisions": [item["content"] for item in related_context[:5]],
            "assumptions": [],
        }

    # Enrich with structured data
    result["open_items"] = [
        {"task": i["task"], "owner": i.get("owner"), "deadline": i.get("deadline"),
         "from_meeting": i.get("meeting_title", "")}
        for i in open_items
    ]
    result["recommended_participants"] = recommended

    return result
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_meeting_prep.py -v
```

- [ ] **Step 4: Commit**

```bash
git add meeting_prep.py tests/test_meeting_prep.py
git commit -m "feat: add meeting prep engine with read-ahead generation and participant recommendations"
```

---

### Task 4: Add Prep API Endpoints

**Files:**
- Create: `routes/prep.py`
- Modify: `main.py` (register prep router)

- [ ] **Step 1: Create routes/prep.py**

```python
from fastapi import APIRouter, HTTPException, Request

from database import get_open_action_items, update_action_item_status
from meeting_prep import generate_read_ahead, get_open_items_for_prep, recommend_participants
from routes.query import get_memory

router = APIRouter(prefix="/api/prep", tags=["prep"])


@router.post("/read-ahead")
async def read_ahead(request: Request):
    body = await request.json()
    agenda = body.get("agenda")
    participants = body.get("participants", [])
    provider = body.get("provider")

    if not agenda or not agenda.strip():
        raise HTTPException(status_code=400, detail="agenda is required")

    memory = get_memory()

    try:
        result = generate_read_ahead(agenda.strip(), participants, memory, provider=provider)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Read-ahead generation failed: {e}")

    return result


@router.post("/recommend-participants")
async def recommend(request: Request):
    body = await request.json()
    agenda = body.get("agenda")

    if not agenda or not agenda.strip():
        raise HTTPException(status_code=400, detail="agenda is required")

    memory = get_memory()
    recommendations = recommend_participants(agenda.strip(), memory)
    return {"recommendations": recommendations}


@router.get("/open-items")
async def open_items(participant: str = None):
    if participant:
        items = get_open_items_for_prep(participants=[participant])
    else:
        items = get_open_items_for_prep()
    return {"items": items}


@router.post("/action-items/{item_id}/status")
async def update_item_status(item_id: str, request: Request):
    body = await request.json()
    status = body.get("status")
    if status not in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="status must be 'completed' or 'cancelled'")

    update_action_item_status(item_id, status)
    return {"item_id": item_id, "status": status}
```

- [ ] **Step 2: Register router in main.py**

```python
from routes import upload, analyze, meetings, query, prep
# ...
app.include_router(prep.router)
```

- [ ] **Step 3: Run full test suite**

```bash
pytest tests/ -v
```

- [ ] **Step 4: Commit**

```bash
git add routes/prep.py main.py
git commit -m "feat: add pre-meeting prep API endpoints"
```

---

## Chunk 3: Frontend — Prepare View

### Task 5: Add Prepare View to Frontend

**Files:**
- Create: `frontend/src/components/prep/PrepView.tsx`
- Modify: `frontend/src/App.tsx` (add Prepare tab)
- Modify: `frontend/src/components/layout/Header.tsx` (add Prepare tab)
- Modify: `frontend/src/lib/api.ts` (add prep API methods)

- [ ] **Step 1: Add prep API methods to api.ts**

```typescript
// Add to the api object in frontend/src/lib/api.ts:

async getReadAhead(agenda: string, participants: string[], provider?: string) {
    const res = await fetch(`${BASE}/api/prep/read-ahead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agenda, participants, provider }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
},

async getRecommendedParticipants(agenda: string) {
    const res = await fetch(`${BASE}/api/prep/recommend-participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agenda }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
},

async getOpenItems(participant?: string) {
    const url = participant
        ? `${BASE}/api/prep/open-items?participant=${encodeURIComponent(participant)}`
        : `${BASE}/api/prep/open-items`;
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
},

async updateActionItemStatus(itemId: string, status: 'completed' | 'cancelled') {
    const res = await fetch(`${BASE}/api/prep/action-items/${itemId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
},
```

- [ ] **Step 2: Create PrepView component**

Build `frontend/src/components/prep/PrepView.tsx` with:
- **Agenda input** (Textarea): "What is this meeting about?"
- **Participants input** (comma-separated text input): "Who is attending?"
- **Generate Read-Ahead button** with loading state
- **Results display** (after generation):
  - Summary card
  - Related past decisions list
  - Open action items table (with checkboxes to mark complete)
  - Recommended participants list
  - Assumptions list (if any)
- Provider selection

- [ ] **Step 3: Add Prepare tab to Header and App**

Add a "Prepare" tab (BookOpen icon from lucide-react) between Upload and Review.

Update App.tsx view type to include `'prepare'` and render `<PrepView />`.

- [ ] **Step 4: Build and verify**

```bash
cd /Users/bibas/Work/DS4D/brainstorm-boost/frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: add Prepare view for pre-meeting read-ahead generation"
```

---

### Task 6: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
pytest tests/ -v
```
All tests should pass.

- [ ] **Step 2: Verify frontend builds**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: address Phase 2 verification issues"
```
