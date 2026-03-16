# Connected Dashboard + Context-Aware Chat — Design Spec

**Date:** 2026-03-15
**Status:** Draft
**Goal:** Replace the fragmented tab-based UI with a meeting-centric dashboard and persistent context-aware chat panel. Every feature flows into the next.

---

## 1. Problem

The current frontend has 6 disconnected tabs (Upload, Prepare, Review, Ask, Live, History). Each is a dead end — completing an action drops you with no guidance on what to do next. Features that should complement each other feel isolated.

## 2. Design Principles

- **Meetings are the organizing principle** — not features
- **Every action leads somewhere** — no dead ends
- **Chat follows you** — one persistent assistant, context-aware based on current page
- **Fewer top-level choices** — reduce nav from 6 tabs to 3 + chat

---

## 3. Navigation Restructure

### Current
```
[Upload] [Prepare] [Review] [Ask] [Live] [History]
```

### New
```
Header: [Logo]                     [Dashboard] [Live] [History]   [Chat 💬]
```

| Old Tab | New Location |
|---------|-------------|
| Upload | Modal triggered from Dashboard "Upload Meeting" button |
| Prepare | Section on Dashboard + accessible from Meeting Detail footer |
| Review | Meeting Detail page (reached by clicking a meeting) |
| Ask | Replaced by persistent Chat panel (bottom-right) |
| Live | Kept as top-level tab (distinct mode) |
| History | Kept as top-level tab |

---

## 4. Dashboard (Home Page)

The default landing page. Three sections:

### 4.1 Action Cards
Two primary action cards side by side:
- **"Upload Meeting"** — click opens upload modal (existing UploadView content in a Dialog)
- **"Go Live"** — click navigates to Live view

### 4.2 Recent Meetings
Cards (not a table) showing the last 5-6 meetings. Each card shows:
- Title, date, status badge (uploaded/analyzed/approved)
- Quick stats if analyzed (e.g., "3 decisions, 2 action items")
- Click → Meeting Detail page

### 4.3 Prepare Section
Compact section at the bottom:
- Agenda textarea + participants input
- "Generate Read-Ahead" button
- Results render inline below
- "Start This Meeting Live" button appears after generating read-ahead → navigates to Live with agenda pre-filled

---

## 5. Meeting Detail Page

Replaces the standalone Review tab. Reached by:
- Clicking a meeting card on Dashboard or History
- Auto-navigation after upload+analysis completes
- Auto-navigation after live session ends
- Clicking a citation in the chat panel

### 5.1 Data Fetching
`MeetingDetail` is a **state-driven component** receiving `meetingId` from the parent. It fetches its own data:
- On mount: calls `api.getMeeting(meetingId)` to get the full meeting record
- Extracts `verified_output_json ?? ai_output_json` as the AI output
- If the meeting has no AI output (status = "uploaded"), shows "This meeting hasn't been analyzed" with an "Analyze Now" button
- Passes the AI output down to `ReviewView` as a prop

This means `App.tsx` only needs to track `currentMeetingId: string | null`, not the full `aiOutput` object. Simpler state management.

### 5.2 Layout
- **Breadcrumb:** Dashboard > Meeting Title (clicking "Dashboard" navigates back)
- **Content:** `ReviewView` embedded (metadata card, state of direction, decisions table, action items table, risks table). No changes to ReviewView internals.
- **Approve button:** Same position and behavior as current ReviewView

### 5.3 Approval State Communication
`ReviewView` gets a new optional callback prop: `onApprove?: (exports: {md?: string, json?: string}) => void`. When the user clicks Approve & Export and it succeeds, `ReviewView` calls `onApprove` with the export links. `MeetingDetail` uses this to:
1. Switch from "pre-approval" to "post-approval" footer
2. Store the export links for the "View Exports" action

### 5.4 Contextual Actions Footer (after approval)
Appears below the review content once `onApprove` fires:
- **"Prepare Follow-up Meeting"** — navigates to Dashboard and pre-fills the PrepView agenda textarea with: `"Follow-up: {meeting title}"`. The participants field is pre-filled with the meeting's participant list.
- **"Ask About This Meeting"** — opens chat panel with this meeting's ID as context
- **"View Exports"** — download links for markdown and JSON

### 5.5 Pre-approval State
Before approval, the footer shows only the Approve & Export button (existing behavior via ReviewView).

---

## 6. Context-Aware Chat Panel

### 6.1 UI
- **Trigger:** Floating button in bottom-right corner, always visible on every page
- **Panel:** ~400px wide, slides in from the right edge. Overlays content, does not push it.
- **Header:** "Ask Brainstorm Boost" + minimize button + "New Chat" button
- **Messages:** Scrollable conversation area. User messages right-aligned, AI messages left-aligned.
- **AI messages include:**
  - Answer text
  - Source citations as clickable chips: `[Drone Battery Review — Decision]`. Clicking navigates to that meeting's detail page and closes the panel.
- **Input:** Text input + send button. Enter to send. Disabled while waiting for response.
- **Loading state:** Typing indicator while AI responds.

### 6.2 Context Awareness
Each message sent to the backend includes a `context_meeting_id` field:
- `null` when user is on Dashboard, History, or Live → RAG searches all meetings equally
- `meeting_id` when user is on a Meeting Detail page → that meeting's items get a relevance boost in RAG retrieval, but all meetings remain searchable

When the user navigates to a different meeting, the context updates silently — no new chat session needed. The conversation continues but new queries reflect the new context.

### 6.3 Conversation History
- Last 10 messages sent to the LLM as conversation context (for follow-up capability)
- Older messages visible in the UI but not sent to the LLM (context window management)
- "New Chat" button clears the conversation and starts fresh

### 6.4 Backend

#### Database Tables
```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,          -- 'user' or 'assistant'
    content TEXT NOT NULL,
    sources_json TEXT,           -- JSON array of source citations (null for user messages)
    context_meeting_id TEXT,     -- meeting context at time of this message (per-message, not per-session)
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
);
```

Note: `context_meeting_id` lives on `chat_messages`, not `chat_sessions`. Context changes per-message as the user navigates between meetings.

#### New Module: `chat_session.py` (project root, alongside meeting_memory.py)
```python
class ChatSession:
    def __init__(self, session_id: str = None):
        # Load or create session from DB

    def send_message(self, message: str, context_meeting_id: str = None, provider: str = None) -> dict:
        # 1. Save user message to DB
        # 2. Build conversation history (last 10 messages)
        # 3. RAG: query ChromaDB for relevant context
        #    If context_meeting_id is set: fetch 3 results filtered to that meeting + 3 from all meetings, merge and deduplicate
        #    If no context: fetch 5 results from all meetings
        # 4. Send conversation + RAG context to LLM via generate()
        # 5. Save assistant message + sources to DB
        # 6. Return {"response": str, "sources": list}
```

#### API Endpoint
```
POST /api/chat
Body: {
    "session_id": str | null,         // null = create new session
    "message": str,
    "context_meeting_id": str | null,
    "provider": str | null
}
Returns: {
    "session_id": str,
    "response": str,
    "sources": [
        {"meeting_id": str, "meeting_title": str, "content": str, "item_type": str}
    ]
}

GET /api/chat/{session_id}/messages
Returns: [
    {"id": str, "role": str, "content": str, "sources": list, "created_at": str}
]
```

### 6.5 System Prompt for Chat
```
You are Brainstorm Boost, an AI assistant that helps teams understand their meeting history.
You answer questions by synthesizing information from past meeting records.
Always cite which meetings your answer is based on.
Be concise and actionable. If the information isn't in the meeting records, say so.
```

This is distinct from both SYSTEM_PROMPT (meeting extraction) and GENERAL_SYSTEM_PROMPT (one-off RAG). The chat prompt emphasizes conversational synthesis.

---

## 7. Routing & State Management

### 7.1 Approach: Keep useState, No Router
The app continues using the `useState<View>` pattern in `App.tsx`. Adding react-router would be a larger refactor than needed for the MVP. Deep linking is not required for a demo.

### 7.2 View Type
```typescript
type View = 'dashboard' | 'meeting-detail' | 'live' | 'history'
```

App.tsx state:
```typescript
const [view, setView] = useState<View>('dashboard')
const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null)
const [chatOpen, setChatOpen] = useState(false)
const [chatContextMeetingId, setChatContextMeetingId] = useState<string | null>(null)
const [uploadModalOpen, setUploadModalOpen] = useState(false)
const [prepAgendaPreFill, setPrepAgendaPreFill] = useState<string>('')
const [prepParticipantsPreFill, setPrepParticipantsPreFill] = useState<string>('')
```

### 7.3 Navigation Functions
```typescript
function navigateToMeeting(meetingId: string) {
    setCurrentMeetingId(meetingId)
    setChatContextMeetingId(meetingId) // update chat context
    setView('meeting-detail')
}

function navigateToDashboard(prepAgenda?: string, prepParticipants?: string) {
    setView('dashboard')
    setChatContextMeetingId(null)
    if (prepAgenda) setPrepAgendaPreFill(prepAgenda)
    if (prepParticipants) setPrepParticipantsPreFill(prepParticipants)
}
```

### 7.4 Upload Modal Flow
- `UploadModal` wraps `UploadView` in a shadcn Dialog
- `UploadModal` owns the modal open/close state, passed down from App via `uploadModalOpen` + `setUploadModalOpen`
- On analysis complete: `UploadView.onAnalysisComplete` fires → `UploadModal` closes the dialog → calls `navigateToMeeting(meetingId)`
- The `UploadView` component itself does not change — it just gets wrapped

### 7.5 Live Session End → Meeting Detail
The existing `LiveView` "ended" state gets an enhancement:
- When `api.endLiveSession()` returns `{meeting_id}`, `LiveView` stores it
- The ended screen shows "Session ended. [Review This Meeting]" button
- Clicking it calls `onReviewMeeting(meetingId)` → App calls `navigateToMeeting(meetingId)`
- `LiveView` gets a new prop: `onReviewMeeting: (meetingId: string) => void`

### 7.6 Logo Click
Clicking the logo/brand text in the Header navigates to Dashboard via `onViewChange('dashboard')`.

---

## 8. Transition Flows

### Flow 1: Upload → Review → Follow-up
```
Dashboard → "Upload Meeting" (modal) → upload + analysis →
modal closes → Meeting Detail opens → user reviews → approves →
footer: "Prepare Follow-up" | "Ask About This" | "View Exports"
```

### Flow 2: Live → Review → Follow-up
```
Dashboard → "Go Live" (or Live tab) → live session → End session →
"Review this session?" prompt → Meeting Detail → approve → follow-up actions
```

### Flow 3: History → Meeting → Chat
```
History tab → click meeting → Meeting Detail →
"Ask About This" → chat opens with meeting context →
answer cites another meeting → click citation → navigates to that meeting
```

### Flow 4: Prepare → Live
```
Dashboard → Prepare section → enter agenda → generate read-ahead →
"Start This Meeting Live" → Live view pre-filled with agenda
```

### Flow 5: Chat → Meeting (from anywhere)
```
Any page → open chat → ask question → answer cites a meeting →
click citation → Meeting Detail page
```

---

## 9. Files Changed

### New Files
- `chat_session.py` — ChatSession class, DB operations, LLM integration (project root alongside meeting_memory.py)
- `routes/chat.py` — POST /api/chat, GET /api/chat/{session_id}/messages
- `frontend/src/components/chat/ChatPanel.tsx` — slide-out chat panel
- `frontend/src/components/chat/ChatButton.tsx` — floating trigger button
- `frontend/src/components/chat/ChatMessage.tsx` — message bubble with citations
- `frontend/src/components/dashboard/Dashboard.tsx` — home page
- `frontend/src/components/dashboard/MeetingCard.tsx` — meeting card for dashboard
- `frontend/src/components/meeting/MeetingDetail.tsx` — meeting detail page (wraps ReviewView)
- `frontend/src/components/upload/UploadModal.tsx` — upload as a dialog

### Modified Files
- `database.py` — add chat_sessions and chat_messages tables
- `main.py` — register chat router
- `frontend/src/App.tsx` — restructured routing, chat panel integration, context passing
- `frontend/src/components/layout/Header.tsx` — reduced to 3 tabs + chat button
- `frontend/src/lib/api.ts` — add chat API methods

### Removed/Repurposed
- `frontend/src/components/query/QueryView.tsx` — removed (replaced by ChatPanel)
- Upload tab removed from header (moved to modal)
- Prepare tab removed from header (moved to Dashboard section)
- Review tab removed from header (now Meeting Detail page)

---

## 10. What Stays the Same

- All backend API endpoints (upload, analyze, approve, prep, live, query, meetings)
- ReviewView component internals (just wrapped by MeetingDetail)
- PrepView component internals (embedded in Dashboard)
- LiveView component internals
- All existing tests
- The v0 dark theme, glass effects, design tokens
