# Connected Dashboard + Context-Aware Chat — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragmented 6-tab UI with a meeting-centric dashboard, persistent context-aware chat panel, and connected transition flows. Every feature flows into the next.

**Architecture:** Backend adds `chat_session.py` (conversation manager with RAG) + `routes/chat.py`. Frontend restructures from 6 tabs to 3 (Dashboard, Live, History) + floating chat panel. `MeetingDetail` wraps `ReviewView` with data fetching and contextual actions. Upload becomes a modal. Prepare embeds in Dashboard.

**Tech Stack:** Same stack — FastAPI, SQLite, ChromaDB, React, Tailwind, shadcn/ui. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-15-connected-dashboard-chat-design.md`

---

## Chunk 1: Chat Backend

### Task 1: Add Chat Tables to Database

**Files:**
- Modify: `database.py`
- Create: `tests/test_chat_db.py`

- [ ] **Step 1: Write tests**

`tests/test_chat_db.py`:
```python
import pytest
from database import (
    create_chat_session, get_chat_session,
    add_chat_message, get_chat_messages,
)


def test_create_and_get_session():
    session_id = create_chat_session()
    session = get_chat_session(session_id)
    assert session is not None
    assert session["id"] == session_id


def test_add_and_get_messages():
    session_id = create_chat_session()
    add_chat_message(session_id, "user", "What was decided?", context_meeting_id=None)
    add_chat_message(
        session_id, "assistant", "Battery type was decided.",
        sources=[{"meeting_id": "m1", "meeting_title": "Review", "content": "decision", "item_type": "decision"}],
        context_meeting_id="m1",
    )
    messages = get_chat_messages(session_id)
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["sources"][0]["meeting_title"] == "Review"


def test_get_messages_empty_session():
    session_id = create_chat_session()
    messages = get_chat_messages(session_id)
    assert messages == []


def test_get_recent_messages_limit():
    session_id = create_chat_session()
    for i in range(15):
        add_chat_message(session_id, "user", f"Message {i}")
    messages = get_chat_messages(session_id, limit=10)
    assert len(messages) == 10
    # Should return the most recent 10
    assert messages[0]["content"] == "Message 5"
```

- [ ] **Step 2: Run tests — should fail**

```bash
pytest tests/test_chat_db.py -v
```

- [ ] **Step 3: Add tables and CRUD to database.py**

Add to `init_db()` executescript:
```sql
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
```

Add functions:
```python
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
        row = conn.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
    return dict(row) if row else None


def add_chat_message(session_id: str, role: str, content: str,
                     sources: list[dict] = None, context_meeting_id: str = None) -> str:
    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, sources_json, context_meeting_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (msg_id, session_id, role, content, json.dumps(sources) if sources else None, context_meeting_id, now),
        )
    return msg_id


def get_chat_messages(session_id: str, limit: int = None) -> list[dict]:
    with get_connection() as conn:
        if limit:
            rows = conn.execute(
                "SELECT * FROM (SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC",
                (session_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        if d.get("sources_json"):
            d["sources"] = json.loads(d.pop("sources_json"))
        else:
            d.pop("sources_json", None)
            d["sources"] = None
        result.append(d)
    return result
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_chat_db.py -v
```

- [ ] **Step 5: Run full suite**

```bash
pytest tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add database.py tests/test_chat_db.py
git commit -m "feat: add chat_sessions and chat_messages tables"
```

---

### Task 2: Chat Session Module

**Files:**
- Create: `chat_session.py`
- Create: `tests/test_chat_session.py`

- [ ] **Step 1: Write tests**

`tests/test_chat_session.py`:
```python
import pytest
from unittest.mock import patch, MagicMock
from chat_session import ChatSession


def test_create_new_session():
    session = ChatSession()
    assert session.session_id is not None


def test_load_existing_session():
    s1 = ChatSession()
    s2 = ChatSession(session_id=s1.session_id)
    assert s2.session_id == s1.session_id


def test_build_conversation_history():
    session = ChatSession()
    # Manually add messages to DB
    from database import add_chat_message
    add_chat_message(session.session_id, "user", "Hello")
    add_chat_message(session.session_id, "assistant", "Hi there")

    history = session._build_conversation_history()
    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[1]["role"] == "assistant"


def test_build_rag_context_no_meeting(tmp_path):
    """Without context_meeting_id, searches all meetings."""
    from meeting_memory import MeetingMemory
    memory = MeetingMemory(persist_dir=str(tmp_path / "chroma"))
    memory.index_meeting("m1", {
        "meeting_metadata": {"title": "Battery Review"},
        "decisions": [{"id": "D1", "description": "Use lithium", "source_quote": "go lithium"}],
        "action_items": [], "open_risks": [],
    })

    session = ChatSession()
    context = session._build_rag_context("battery decision", memory, context_meeting_id=None)
    assert len(context) > 0
    assert any("lithium" in c["content"].lower() for c in context)


def test_build_rag_context_with_meeting(tmp_path):
    """With context_meeting_id, boosts that meeting's results."""
    from meeting_memory import MeetingMemory
    memory = MeetingMemory(persist_dir=str(tmp_path / "chroma"))
    memory.index_meeting("m1", {
        "meeting_metadata": {"title": "Battery Review"},
        "decisions": [{"id": "D1", "description": "Use lithium", "source_quote": "go lithium"}],
        "action_items": [], "open_risks": [],
    })
    memory.index_meeting("m2", {
        "meeting_metadata": {"title": "Frequency Review"},
        "decisions": [{"id": "D1", "description": "Use 5.8 GHz", "source_quote": "5.8 is best"}],
        "action_items": [], "open_risks": [],
    })

    session = ChatSession()
    context = session._build_rag_context("what was decided", memory, context_meeting_id="m1")
    # Should include results from both but prioritize m1
    assert len(context) > 0
```

- [ ] **Step 2: Implement chat_session.py**

```python
from __future__ import annotations

import json
import logging

from database import (
    create_chat_session, get_chat_session,
    add_chat_message, get_chat_messages,
)
from meeting_memory import MeetingMemory

logger = logging.getLogger(__name__)

CHAT_SYSTEM_PROMPT = """You are Brainstorm Boost, an AI assistant that helps teams understand their meeting history.
You answer questions by synthesizing information from past meeting records.
Always cite which meetings your answer is based on.
Be concise and actionable. If the information isn't in the meeting records, say so."""

MAX_HISTORY_MESSAGES = 10


class ChatSession:
    """Manages a chat conversation with RAG-powered meeting context."""

    def __init__(self, session_id: str = None):
        if session_id and get_chat_session(session_id):
            self.session_id = session_id
        else:
            self.session_id = create_chat_session()

    def send_message(self, message: str, memory: MeetingMemory,
                     context_meeting_id: str = None, provider: str = None) -> dict:
        """Send a user message and get an AI response with RAG context."""
        from llm_client import generate

        # 1. Save user message
        add_chat_message(self.session_id, "user", message, context_meeting_id=context_meeting_id)

        # 2. Build conversation history
        history = self._build_conversation_history()

        # 3. RAG context
        rag_context = self._build_rag_context(message, memory, context_meeting_id)

        # 4. Build prompt
        rag_text = ""
        if rag_context:
            rag_text = "\n\nRelevant meeting records:\n" + "\n".join(
                f"- [{item['meeting_title']}] {item['content']}" for item in rag_context
            )

        conversation_text = "\n".join(
            f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
            for m in history[:-1]  # Exclude the current message (already in history)
        )

        prompt = f"""Previous conversation:
{conversation_text}

{rag_text}

Current question: {message}

Return a JSON object:
{{"answer": "your response citing specific meetings where relevant", "sources": ["meeting title 1", "meeting title 2"]}}"""

        # 5. Call LLM
        try:
            result = generate(prompt, provider=provider)
            response_text = result.get("answer", str(result))
            source_titles = result.get("sources", [])
        except Exception as e:
            logger.exception("Chat LLM call failed")
            response_text = f"Sorry, I couldn't process that question. Error: {e}"
            source_titles = []

        # 6. Build source objects with meeting_id
        sources = []
        for item in rag_context:
            if item["meeting_title"] in source_titles:
                sources.append({
                    "meeting_id": item["meeting_id"],
                    "meeting_title": item["meeting_title"],
                    "content": item["content"],
                    "item_type": item["item_type"],
                })
        # Deduplicate by meeting_id
        seen = set()
        unique_sources = []
        for s in sources:
            if s["meeting_id"] not in seen:
                seen.add(s["meeting_id"])
                unique_sources.append(s)

        # 7. Save assistant message
        add_chat_message(
            self.session_id, "assistant", response_text,
            sources=unique_sources, context_meeting_id=context_meeting_id,
        )

        return {
            "session_id": self.session_id,
            "response": response_text,
            "sources": unique_sources,
        }

    def _build_conversation_history(self) -> list[dict]:
        return get_chat_messages(self.session_id, limit=MAX_HISTORY_MESSAGES)

    def _build_rag_context(self, query: str, memory: MeetingMemory,
                           context_meeting_id: str = None) -> list[dict]:
        """Retrieve relevant meeting context via ChromaDB.

        If context_meeting_id is set, fetch 3 results from that meeting + 3 global, then merge.
        Otherwise, fetch 5 global results.
        """
        if context_meeting_id:
            # Scoped results from context meeting
            try:
                scoped = memory.query(query, top_k=3)
                scoped = [r for r in scoped if r.get("meeting_id") == context_meeting_id]
            except Exception:
                scoped = []

            # Global results
            try:
                global_results = memory.query(query, top_k=3)
            except Exception:
                global_results = []

            # Merge and deduplicate
            seen_ids = set()
            merged = []
            for item in scoped + global_results:
                key = f"{item.get('meeting_id')}_{item.get('item_type')}_{item.get('content', '')[:50]}"
                if key not in seen_ids:
                    seen_ids.add(key)
                    merged.append(item)
            return merged[:6]
        else:
            try:
                return memory.query(query, top_k=5)
            except Exception:
                return []
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_chat_session.py -v
```

- [ ] **Step 4: Commit**

```bash
git add chat_session.py tests/test_chat_session.py
git commit -m "feat: add ChatSession with conversation history and RAG context"
```

---

### Task 3: Chat API Endpoint

**Files:**
- Create: `routes/chat.py`
- Modify: `main.py`

- [ ] **Step 1: Create routes/chat.py**

```python
from fastapi import APIRouter, HTTPException, Request

from chat_session import ChatSession
from routes.query import get_memory

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat")
async def chat(request: Request):
    body = await request.json()
    message = body.get("message")
    session_id = body.get("session_id")
    context_meeting_id = body.get("context_meeting_id")
    provider = body.get("provider")

    if not message or not message.strip():
        raise HTTPException(status_code=400, detail="message is required")

    session = ChatSession(session_id=session_id)
    memory = get_memory()

    try:
        result = session.send_message(
            message.strip(), memory,
            context_meeting_id=context_meeting_id,
            provider=provider,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Chat failed: {e}")

    return result


@router.get("/chat/{session_id}/messages")
async def get_messages(session_id: str):
    from database import get_chat_session, get_chat_messages

    session = get_chat_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    messages = get_chat_messages(session_id)
    return {"session_id": session_id, "messages": messages}
```

- [ ] **Step 2: Register in main.py**

Add to imports and router registration:
```python
from routes import upload, analyze, meetings, query, prep, live, chat
app.include_router(chat.router)
```

- [ ] **Step 3: Run full test suite**

```bash
pytest tests/ -v
```

- [ ] **Step 4: Commit**

```bash
git add routes/chat.py main.py
git commit -m "feat: add chat API endpoint with session management"
```

---

## Chunk 2: Frontend Restructure

### Task 4: Add Chat API Methods + Update Header

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/layout/Header.tsx`

- [ ] **Step 1: Add chat methods to api.ts**

Add to the `api` object:
```typescript
async sendChatMessage(message: string, sessionId?: string, contextMeetingId?: string, provider?: string) {
    const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            session_id: sessionId ?? null,
            context_meeting_id: contextMeetingId ?? null,
            provider: provider ?? null,
        }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json() as Promise<{
        session_id: string;
        response: string;
        sources: Array<{ meeting_id: string; meeting_title: string; content: string; item_type: string }>;
    }>;
},

async getChatMessages(sessionId: string) {
    const res = await fetch(`${BASE}/api/chat/${sessionId}/messages`);
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
},
```

- [ ] **Step 2: Update Header to 3 tabs + logo click**

Update `Header.tsx`:
- Change `View` type to `'dashboard' | 'meeting-detail' | 'live' | 'history'`
- Reduce tabs to: `[{view: 'dashboard', label: 'Home', icon: Home}, {view: 'live', label: 'Live', icon: Radio}, {view: 'history', label: 'History', icon: History}]`
- `meeting-detail` is NOT a tab — it's reached by navigation, not by clicking a tab
- Add `onChatToggle` prop and a chat button in the header (MessageCircle icon)
- Logo click calls `onViewChange('dashboard')`
- Remove `hasReview` prop (no longer needed)

```typescript
import { Home, History, Radio, MessageCircle, Sparkles } from 'lucide-react'

export type View = 'dashboard' | 'meeting-detail' | 'live' | 'history'

interface HeaderProps {
    currentView: View
    onViewChange: (view: View) => void
    onChatToggle: () => void
    chatOpen: boolean
}

const tabs: { view: View; label: string; icon: typeof Home }[] = [
    { view: 'dashboard', label: 'Home', icon: Home },
    { view: 'live', label: 'Live', icon: Radio },
    { view: 'history', label: 'History', icon: History },
]
```

- [ ] **Step 3: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/layout/Header.tsx
git commit -m "feat: update header to 3 tabs + chat button, add chat API methods"
```

---

### Task 5: Chat Panel Components

**Files:**
- Create: `frontend/src/components/chat/ChatPanel.tsx`
- Create: `frontend/src/components/chat/ChatButton.tsx`
- Create: `frontend/src/components/chat/ChatMessage.tsx`

- [ ] **Step 1: Create ChatMessage.tsx**

A single message bubble. User messages right-aligned, assistant left-aligned. Assistant messages show source citation chips that are clickable.

```typescript
interface ChatMessageProps {
    role: 'user' | 'assistant'
    content: string
    sources?: Array<{ meeting_id: string; meeting_title: string; item_type: string }>
    onSourceClick?: (meetingId: string) => void
}
```

Use the existing v0 dark theme: glass cards, muted-foreground text, primary accents.

- [ ] **Step 2: Create ChatButton.tsx**

Floating button (bottom-right, fixed position). MessageCircle icon. Shows a subtle glow when chat has unread messages (optional — can skip for MVP).

```typescript
interface ChatButtonProps {
    onClick: () => void
    isOpen: boolean
}
```

- [ ] **Step 3: Create ChatPanel.tsx**

Slide-out panel (~400px) from the right edge. Contains:
- Header with title "Ask Brainstorm Boost" + "New Chat" button + close button
- ScrollArea with ChatMessage components
- Input bar at the bottom (text input + send button)
- Loading state (typing indicator) while waiting for response

State management:
- `sessionId: string | null` — created on first message
- `messages: Array<{role, content, sources}>` — local state, synced with backend
- `loading: boolean`

Props:
```typescript
interface ChatPanelProps {
    isOpen: boolean
    onClose: () => void
    contextMeetingId: string | null
    onNavigateToMeeting: (meetingId: string) => void
}
```

The `contextMeetingId` is passed from App.tsx and changes as the user navigates. The panel sends it with each message but doesn't restart the conversation.

- [ ] **Step 4: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chat/
git commit -m "feat: add chat panel with message bubbles and source citations"
```

---

### Task 6: Dashboard + MeetingDetail + UploadModal

**Files:**
- Create: `frontend/src/components/dashboard/Dashboard.tsx`
- Create: `frontend/src/components/dashboard/MeetingCard.tsx`
- Create: `frontend/src/components/meeting/MeetingDetail.tsx`
- Create: `frontend/src/components/upload/UploadModal.tsx`

- [ ] **Step 1: Create MeetingCard.tsx**

A card for displaying a meeting in the dashboard grid. Shows title, date, status badge, quick stats (decision count, action item count if available). Click handler.

```typescript
interface MeetingCardProps {
    meeting: Meeting
    onClick: () => void
}
```

Use the glass card styling from the v0 redesign.

- [ ] **Step 2: Create UploadModal.tsx**

Wraps the existing `UploadView` in a shadcn `Dialog`. Controls open/close state.

```typescript
interface UploadModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onAnalysisComplete: (meetingId: string) => void
}
```

When analysis completes: close the dialog, call `onAnalysisComplete(meetingId)` which navigates to MeetingDetail.

Note: `UploadView.onAnalysisComplete` currently passes `(meetingId, aiOutput)`. Since `MeetingDetail` fetches its own data, we only need to pass `meetingId` up. Modify `UploadView`'s callback or have `UploadModal` discard the aiOutput.

- [ ] **Step 3: Create MeetingDetail.tsx**

Wraps `ReviewView` with data fetching and contextual actions.

```typescript
interface MeetingDetailProps {
    meetingId: string
    onBack: () => void
    onOpenChat: (meetingId: string) => void
    onPrepareFollowUp: (agenda: string, participants: string) => void
}
```

On mount: fetches `api.getMeeting(meetingId)`, extracts `verified_output_json ?? ai_output_json`.

Passes `onApprove` callback to `ReviewView` (requires adding this prop to ReviewView — see step below).

After approval, shows contextual footer with:
- "Prepare Follow-up Meeting" → calls `onPrepareFollowUp("Follow-up: {title}", participants.join(", "))`
- "Ask About This Meeting" → calls `onOpenChat(meetingId)`
- Export download links

**Important:** `ReviewView` needs a new optional prop: `onApprove?: (exports: {md?: string, json?: string}) => void`. Modify `ReviewView` to call this when approval succeeds, in addition to its existing internal state update.

- [ ] **Step 4: Create Dashboard.tsx**

```typescript
interface DashboardProps {
    onUploadClick: () => void
    onGoLive: () => void
    onMeetingClick: (meetingId: string) => void
    prepAgendaPreFill?: string
    prepParticipantsPreFill?: string
    onClearPreFill: () => void
}
```

Three sections:
1. **Action cards** — "Upload Meeting" + "Go Live" side by side
2. **Recent Meetings** — grid of MeetingCards (fetches from api.getMeetings, shows last 6)
3. **Prepare section** — embeds PrepView with pre-fill props. Add a "Start This Meeting Live" button that appears after read-ahead generation, calling `onGoLive`.

- [ ] **Step 5: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/dashboard/ frontend/src/components/meeting/ frontend/src/components/upload/UploadModal.tsx frontend/src/components/review/ReviewView.tsx
git commit -m "feat: add Dashboard, MeetingDetail, UploadModal, and MeetingCard components"
```

---

### Task 7: Rewire App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/live/LiveView.tsx` (add onReviewMeeting prop)

- [ ] **Step 1: Rewrite App.tsx**

Replace the current view switching with the new navigation model:

```typescript
import { useState, useCallback, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { Header, type View } from '@/components/layout/Header'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { MeetingDetail } from '@/components/meeting/MeetingDetail'
import { MeetingsView } from '@/components/meetings/MeetingsView'
import { LiveView } from '@/components/live/LiveView'
import { JoinView } from '@/components/live/JoinView'
import { UploadModal } from '@/components/upload/UploadModal'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { ChatButton } from '@/components/chat/ChatButton'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

export default function App() {
    const [view, setView] = useState<View>('dashboard')
    const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null)
    const [chatOpen, setChatOpen] = useState(false)
    const [chatContextMeetingId, setChatContextMeetingId] = useState<string | null>(null)
    const [uploadModalOpen, setUploadModalOpen] = useState(false)
    const [prepAgendaPreFill, setPrepAgendaPreFill] = useState('')
    const [prepParticipantsPreFill, setPrepParticipantsPreFill] = useState('')
    const [isJoinPage, setIsJoinPage] = useState(false)

    useEffect(() => {
        if (window.location.pathname.startsWith('/join')) setIsJoinPage(true)
    }, [])

    const navigateToMeeting = useCallback((meetingId: string) => {
        setCurrentMeetingId(meetingId)
        setChatContextMeetingId(meetingId)
        setView('meeting-detail')
    }, [])

    const navigateToDashboard = useCallback((prepAgenda?: string, prepParticipants?: string) => {
        setView('dashboard')
        setChatContextMeetingId(null)
        setCurrentMeetingId(null)
        if (prepAgenda) setPrepAgendaPreFill(prepAgenda)
        if (prepParticipants) setPrepParticipantsPreFill(prepParticipants)
    }, [])

    if (isJoinPage) {
        return (
            <QueryClientProvider client={queryClient}>
                <JoinView />
                <Toaster position="bottom-right" richColors toastOptions={{ className: 'bg-card border-border text-foreground' }} />
            </QueryClientProvider>
        )
    }

    return (
        <QueryClientProvider client={queryClient}>
            <div className="relative min-h-screen bg-background">
                {/* Ambient background glow */}
                <div className="pointer-events-none fixed inset-0 overflow-hidden">
                    <div className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
                    <div className="absolute -bottom-40 left-1/4 h-[400px] w-[600px] rounded-full bg-chart-2/10 blur-[100px]" />
                </div>

                <div className="relative z-10">
                    <Header
                        currentView={view}
                        onViewChange={setView}
                        onChatToggle={() => setChatOpen(!chatOpen)}
                        chatOpen={chatOpen}
                    />
                    <main className="mx-auto max-w-7xl px-6 py-10">
                        <div className="fade-in">
                            {view === 'dashboard' && (
                                <Dashboard
                                    onUploadClick={() => setUploadModalOpen(true)}
                                    onGoLive={() => setView('live')}
                                    onMeetingClick={navigateToMeeting}
                                    prepAgendaPreFill={prepAgendaPreFill}
                                    prepParticipantsPreFill={prepParticipantsPreFill}
                                    onClearPreFill={() => { setPrepAgendaPreFill(''); setPrepParticipantsPreFill('') }}
                                />
                            )}
                            {view === 'meeting-detail' && currentMeetingId && (
                                <MeetingDetail
                                    meetingId={currentMeetingId}
                                    onBack={() => navigateToDashboard()}
                                    onOpenChat={(id) => { setChatContextMeetingId(id); setChatOpen(true) }}
                                    onPrepareFollowUp={(agenda, participants) => navigateToDashboard(agenda, participants)}
                                />
                            )}
                            {view === 'live' && (
                                <LiveView onReviewMeeting={navigateToMeeting} />
                            )}
                            {view === 'history' && (
                                <MeetingsView onSelectMeeting={(id) => navigateToMeeting(id)} />
                            )}
                        </div>
                    </main>
                </div>

                {/* Chat */}
                <ChatButton onClick={() => setChatOpen(!chatOpen)} isOpen={chatOpen} />
                <ChatPanel
                    isOpen={chatOpen}
                    onClose={() => setChatOpen(false)}
                    contextMeetingId={chatContextMeetingId}
                    onNavigateToMeeting={(id) => { setChatOpen(false); navigateToMeeting(id) }}
                />

                <UploadModal
                    open={uploadModalOpen}
                    onOpenChange={setUploadModalOpen}
                    onAnalysisComplete={(meetingId) => { setUploadModalOpen(false); navigateToMeeting(meetingId) }}
                />
            </div>
            <Toaster position="bottom-right" richColors toastOptions={{ className: 'bg-card border-border text-foreground' }} />
        </QueryClientProvider>
    )
}
```

- [ ] **Step 2: Add onReviewMeeting prop to LiveView**

Modify `LiveView` to accept `onReviewMeeting: (meetingId: string) => void`. In the "ended" state, after `api.endLiveSession()` returns `{meeting_id}`, show a "Review This Meeting" button that calls `onReviewMeeting(meetingId)`.

- [ ] **Step 3: Update MeetingsView onSelectMeeting signature**

The current `MeetingsView` passes `(meetingId, aiOutput)` to `onSelectMeeting`. Since `MeetingDetail` fetches its own data, simplify to just `(meetingId: string)`. Update `MeetingsView.handleRowClick` to call `onSelectMeeting(id)` directly without fetching the meeting detail first.

- [ ] **Step 4: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Run backend tests**

```bash
pytest tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat: rewire App.tsx with dashboard navigation, chat panel, and connected flows"
```

---

## Chunk 3: Cleanup & Verification

### Task 8: Remove Dead Code + Final Verification

**Files:**
- Delete: `frontend/src/components/query/QueryView.tsx` (replaced by ChatPanel)
- Verify: all imports updated, no broken references

- [ ] **Step 1: Remove QueryView.tsx**

```bash
rm frontend/src/components/query/QueryView.tsx
```

Verify no remaining imports of `QueryView` in any file.

- [ ] **Step 2: Build frontend**

```bash
cd frontend && npm run build
```
Must compile with zero errors.

- [ ] **Step 3: Run full backend test suite**

```bash
pytest tests/ -v
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove QueryView (replaced by ChatPanel), cleanup dead imports"
```
