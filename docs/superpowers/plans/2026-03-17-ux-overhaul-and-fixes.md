# UX Overhaul + Pipeline Fixes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 10 UX improvements from user feedback + backend pipeline fixes. Split-pane review with transcript highlighting, chat as full page, compact list view, delete/reject items, confidence filtering, timeline view, pipeline progress, auto-title, lower dedup threshold, fuzzy quote verification.

**Architecture:** MeetingDetail gets a complete rewrite as split-pane (transcript left, analysis right). ReviewView refactored into compact list + expandable cards. Chat becomes a full route at `/chat`. Backend adds meeting title auto-update, transcript endpoint, and relaxed dedup/verification thresholds.

**Tech Stack:** Same — React, Tailwind, shadcn/ui, FastAPI, SQLite. No new dependencies.

**Feedback reference:** `/Users/bibas/Work/DS4D/brainstorm-boost/feedback.md`

---

## Chunk 1: Backend Fixes (Pipeline + Data)

### Task 1: Lower Dedup Threshold + Auto-Update Title + Fuzzy Quote Verification

**Files:**
- Modify: `extraction_pipeline.py`
- Modify: `database.py`
- Modify: `routes/analyze.py`

- [ ] **Step 1: Lower dedup threshold**

In `extraction_pipeline.py`, find `_deduplicate_entities()` (the line `if sim > 0.85:`). Change the threshold to be type-specific:

```python
# Replace the single threshold with type-specific ones
DEDUP_THRESHOLDS = {
    "decision": 0.75,
    "action_item": 0.80,
    "risk": 0.80,
}
# ...
threshold = DEDUP_THRESHOLDS.get(etype, 0.80)
if sim > threshold:
    merged.add(j)
```

- [ ] **Step 2: Add fuzzy quote verification**

In `extraction_pipeline.py`, update `_verify_source_quotes()`. Replace exact substring match with fuzzy matching — check if any 5-word subsequence of the quote appears in the transcript:

```python
def _verify_source_quotes(entities: list[dict], raw_transcript: str) -> list[dict]:
    transcript_lower = raw_transcript.lower()
    for e in entities:
        quote = e.get("properties", {}).get("source_quote", "") or e.get("source_quote", "")
        if quote:
            e.setdefault("properties", {})["source_quote"] = quote
            quote_lower = quote.lower().strip().strip('"').strip("'")
            if len(quote_lower) > 10:
                # Fuzzy: check if any 5-word window from the quote exists in transcript
                words = quote_lower.split()
                verified = False
                if quote_lower in transcript_lower:
                    verified = True
                elif len(words) >= 5:
                    for i in range(len(words) - 4):
                        window = " ".join(words[i:i+5])
                        if window in transcript_lower:
                            verified = True
                            break
                e["properties"]["quote_verified"] = verified
            else:
                e["properties"]["quote_verified"] = False
        speaker = e.get("source_quote_speaker", "") or e.get("properties", {}).get("source_quote_speaker", "")
        if speaker:
            e.setdefault("properties", {})["source_quote_speaker"] = speaker
    return entities
```

- [ ] **Step 3: Add update_meeting_title to database.py**

```python
def update_meeting_title(meeting_id: str, title: str):
    with get_connection() as conn:
        conn.execute("UPDATE meetings SET title = ? WHERE id = ?", (title, meeting_id))
```

- [ ] **Step 4: Auto-update meeting title after analysis**

In `routes/analyze.py`, after `update_ai_output(meeting_id, ai_output)`, add:

```python
    # Auto-update meeting title from AI-inferred title
    try:
        inferred_title = ai_output.get("meeting_metadata", {}).get("title")
        if inferred_title and inferred_title.strip():
            from database import update_meeting_title
            update_meeting_title(meeting_id, inferred_title.strip())
    except Exception:
        logger.exception("Failed to update meeting title for %s", meeting_id)
```

- [ ] **Step 5: Add transcript endpoint for frontend split-pane**

In `routes/meetings.py`, add an endpoint that returns just the raw transcript:

```python
@router.get("/meetings/{meeting_id}/transcript")
def meeting_transcript(meeting_id: str):
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {
        "meeting_id": meeting_id,
        "transcript": meeting.get("raw_transcript", ""),
    }
```

- [ ] **Step 6: Add API method to frontend api.ts**

```typescript
async getMeetingTranscript(meetingId: string) {
    const res = await fetch(`${BASE}/api/meetings/${meetingId}/transcript`);
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json() as Promise<{ meeting_id: string; transcript: string }>;
},
```

- [ ] **Step 7: Run tests + commit**

```bash
pytest tests/ -v
git add extraction_pipeline.py database.py routes/analyze.py routes/meetings.py frontend/src/lib/api.ts
git commit -m "fix: lower dedup threshold, fuzzy quote verification, auto-update title, transcript endpoint"
```

---

### Task 2: Pipeline Progress via SSE (Server-Sent Events)

**Files:**
- Modify: `routes/analyze.py`
- Modify: `extraction_pipeline.py`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/upload/UploadView.tsx`

- [ ] **Step 1: Add progress callback to extraction pipeline**

In `extraction_pipeline.py`, add a `progress_callback` parameter to `run_extraction_pipeline`:

```python
def run_extraction_pipeline(
    meeting_id: str,
    raw_transcript: str,
    provider: str = None,
    output_schema: str = None,
    progress_callback: callable = None,
) -> dict:
```

Call the callback at each stage:
```python
    if progress_callback:
        progress_callback("extracting_entities", 0.1, "Extracting entities from transcript...")
    # ... Pass 1 ...
    if progress_callback:
        progress_callback("building_relationships", 0.4, "Building relationships between entities...")
    # ... Pass 2 ...
    if progress_callback:
        progress_callback("synthesizing", 0.7, "Synthesizing meeting analysis...")
    # ... Pass 3 ...
    if progress_callback:
        progress_callback("complete", 1.0, "Analysis complete")
```

- [ ] **Step 2: Add SSE endpoint for analysis progress**

In `routes/analyze.py`, add a streaming endpoint:

```python
from fastapi.responses import StreamingResponse
import asyncio

_analysis_progress: dict[str, dict] = {}  # meeting_id -> {stage, progress, message}

@router.get("/analyze/{meeting_id}/progress")
async def analysis_progress(meeting_id: str):
    async def event_stream():
        while True:
            progress = _analysis_progress.get(meeting_id)
            if progress:
                yield f"data: {json.dumps(progress)}\n\n"
                if progress.get("stage") == "complete" or progress.get("stage") == "error":
                    del _analysis_progress[meeting_id]
                    break
            await asyncio.sleep(0.5)
    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

Update the `analyze()` function to set progress:
```python
    def on_progress(stage, progress, message):
        _analysis_progress[meeting_id] = {"stage": stage, "progress": progress, "message": message}

    # Pass callback to pipeline
    ai_output = run_extraction_pipeline(meeting_id, raw_transcript, provider=provider, progress_callback=on_progress)
```

- [ ] **Step 3: Update frontend to show pipeline stages**

In `UploadView.tsx`, after starting analysis, connect to the SSE endpoint and show stage-specific progress:

```typescript
// After calling api.analyze(), connect to progress stream
const eventSource = new EventSource(`/api/analyze/${meetingId}/progress`)
eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data)
    setStatus(data.stage)
    setProgressMessage(data.message)
    setProgressPercent(data.progress)
}
```

Show a progress bar with stage labels:
- "Extracting entities from transcript..." (10%)
- "Building relationships between entities..." (40%)
- "Synthesizing meeting analysis..." (70%)
- "Analysis complete" (100%)

Use shadcn Progress component.

- [ ] **Step 4: Commit**

```bash
git add extraction_pipeline.py routes/analyze.py frontend/src/components/upload/UploadView.tsx frontend/src/lib/api.ts
git commit -m "feat: add pipeline progress stages to upload flow via SSE"
```

---

## Chunk 2: Review Page Overhaul

### Task 3: Split-Pane MeetingDetail with Transcript Panel

**Files:**
- Create: `frontend/src/components/meeting/TranscriptPanel.tsx`
- Create: `frontend/src/components/meeting/MeetingTimeline.tsx`
- Modify: `frontend/src/components/meeting/MeetingDetail.tsx`

- [ ] **Step 1: Create TranscriptPanel.tsx**

Left panel showing the raw transcript with highlighting capabilities:

```typescript
interface TranscriptPanelProps {
    transcript: string
    highlightedRange?: { start: number; end: number } | null
    onClearHighlight?: () => void
}
```

Features:
- ScrollArea with the full transcript text
- When `highlightedRange` is set, auto-scroll to that position and highlight the text with a primary/20 background
- Line numbers in the gutter (muted, mono font)
- Search input at the top for finding text in the transcript
- Clean dark theme matching the app

The transcript text should be rendered as pre-wrapped monospace with speaker names highlighted in a different color.

- [ ] **Step 2: Create MeetingTimeline.tsx**

A horizontal bar at the top showing when decisions, action items, and risks occurred in the meeting:

```typescript
interface TimelineItem {
    type: 'decision' | 'action_item' | 'risk'
    id: string
    position: number  // 0-1 representing position in transcript
    label: string
}

interface MeetingTimelineProps {
    items: TimelineItem[]
    onItemClick: (id: string) => void
    totalLength: number
}
```

Visual: horizontal bar with colored dots:
- Green dots for decisions
- Blue dots for action items
- Red/amber dots for risks
- Hover shows the item label
- Click scrolls to that item in both the transcript and analysis panels

Use the `source_start` from graph nodes to calculate position (source_start / total transcript length).

- [ ] **Step 3: Rewrite MeetingDetail as split-pane**

Read `MeetingDetail.tsx` fully. Rewrite the layout:

```
┌─────────────────────────────────────────────────────────────┐
│ Breadcrumb: Home > Meeting Title    [Knowledge Base] [Reindex]│
├─────────────────────────────────────────────────────────────┤
│ Timeline: ●──●────●──●──────●───●──●                        │
├──────────────────────┬──────────────────────────────────────┤
│                      │                                      │
│   TRANSCRIPT         │   ANALYSIS                           │
│   (40% width)        │   (60% width)                        │
│                      │                                      │
│   [search box]       │   [confidence filter] [view toggle]  │
│                      │                                      │
│   Speaker A: ...     │   Decisions (3)                      │
│   Speaker B: ...     │   ▸ D1: Use lithium batteries  [✕]  │
│   Speaker A: ...     │   ▸ D2: Focus on Phase 1      [✕]  │
│   >>>HIGHLIGHTED<<<  │   ▾ D3: Expanded card view...  [✕]  │
│   Speaker B: ...     │                                      │
│                      │   Action Items (5)                   │
│                      │   ▸ A1: Contact suppliers      [✕]  │
│                      │   ...                                │
│                      │                                      │
│                      │   [Approve & Export]                  │
└──────────────────────┴──────────────────────────────────────┘
```

Key behaviors:
- Fetch transcript via `api.getMeetingTranscript(meetingId)` alongside existing meeting + graph data
- Pass highlighted range to TranscriptPanel when user clicks an analysis item
- Pass scroll target when user clicks a timeline dot
- The analysis side uses the new compact ReviewView (Task 4)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/meeting/
git commit -m "feat: split-pane meeting detail with transcript panel and timeline"
```

---

### Task 4: Compact ReviewView with Expand/Collapse + Delete + Confidence Filter

**Files:**
- Rewrite: `frontend/src/components/review/ReviewView.tsx`

- [ ] **Step 1: Rewrite ReviewView with compact list + expandable cards**

Complete rewrite of ReviewView. New features:

**Confidence filter slider:**
```typescript
const [minConfidence, setMinConfidence] = useState<'low' | 'medium' | 'high'>('low')
// Filter items: if minConfidence is 'medium', hide 'low' items
// If minConfidence is 'high', hide 'low' and 'medium'
```

Three filter buttons at the top: [All] [Medium+] [High only]

**Compact list view (default):**
Each item is ONE LINE:
```
[D1] [High] Use lithium-polymer batteries  —  Alice          [expand] [✕]
[D2] [Med]  Focus on post-meeting analysis  —  empty          [expand] [✕]
```

Click the row or [expand] to show the full card with source quote, connections, editable fields.

**Delete/reject button:**
Each item gets a small [✕] button. Clicking it removes the item from the `output` state (doesn't persist until approve). Show a toast "Removed D1" with an undo option (use sonner's undo toast).

**Hide null fields:**
Replace the EditableCell empty state — instead of showing "empty" in italics, either:
- Hide the field entirely if null (for `made_by`, `deadline`, `raised_by`)
- Or show a subtle "+" button to add a value

**Section accent colors (from feedback #8):**
- Decisions section: subtle green-tinted border/header
- Action Items: blue-tinted
- Risks: amber/red-tinted

**View toggle:**
Button to switch between compact list and full card view.

**Source quote — "Source Quote" not "Verbatim":**
Rename the toggle label from "Verbatim" to "Source Quote" (feedback #15 — "Verbatim" is unclear).

**Click item → highlight transcript:**
Each item needs to emit its `source_start`/`source_end` (from graph node data) so MeetingDetail can highlight the corresponding transcript passage. Add callback:
```typescript
onHighlightTranscript?: (range: { start: number; end: number } | null) => void
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/review/ReviewView.tsx
git commit -m "feat: compact review with expand/collapse, delete, confidence filter, section accents"
```

---

## Chunk 3: Chat Redesign + History Improvements

### Task 5: Chat as Full Page Route

**Files:**
- Create: `frontend/src/components/chat/ChatPage.tsx`
- Modify: `frontend/src/components/chat/ChatPanel.tsx` (extract shared logic)
- Modify: `frontend/src/App.tsx` (add /chat route)
- Modify: `frontend/src/components/layout/Header.tsx` (add Chat tab)
- Modify: `frontend/src/components/chat/ChatButton.tsx` (navigate to /chat)

- [ ] **Step 1: Create ChatPage.tsx**

Full-page chat experience:

```
┌─────────────────────────────────────────────────────────────┐
│ Header: [Home] [Chat ★active] [Live] [History]              │
├──────────────────────────────┬──────────────────────────────┤
│                              │                              │
│   CONVERSATION               │   SOURCE CONTEXT             │
│   (60% width)                │   (40% width)                │
│                              │                              │
│   Suggested prompts:         │   (shows relevant meeting    │
│   • What action items open?  │    excerpts when AI answers) │
│   • Summarize last meeting   │                              │
│   • Who owns the most tasks? │   [Meeting Title]            │
│                              │   "relevant passage..."      │
│   User: What was decided?    │                              │
│                              │   [Another Meeting]          │
│   AI: Based on the Drone     │   "another passage..."       │
│   Battery Review meeting...  │                              │
│                              │                              │
│   ┌────────────────────────┐ │                              │
│   │ Ask about meetings...  │ │                              │
│   └────────────────────────┘ │                              │
└──────────────────────────────┴──────────────────────────────┘
```

Left side: conversation (messages + input). Right side: source context panel that shows the meeting excerpts cited in the AI's latest response.

**Suggested prompts** (shown when no messages):
- "What action items are still open?"
- "Summarize the last meeting"
- "Who has the most open tasks?"
- "What decisions were made about [topic]?"
- "Compare the last two meetings"

Clicking a suggested prompt sends it as a message.

**Source context panel:**
When the AI responds with sources, show the source items on the right with meeting title headers and the content. Clicking a source navigates to that meeting's detail page.

- [ ] **Step 2: Add /chat route to App.tsx**

Add the route:
```typescript
<Route path="/chat" element={<ChatPage provider={provider} />} />
```

- [ ] **Step 3: Update Header to include Chat tab**

Add `{ path: '/chat', label: 'Chat', icon: MessageCircle }` to the tabs array.

- [ ] **Step 4: Update ChatButton to navigate to /chat**

Instead of toggling a panel, the floating button navigates to `/chat`:
```typescript
onClick={() => navigate('/chat')}
```

Remove the ChatPanel overlay from App.tsx entirely — chat is now a full route.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: redesign chat as full page with source context panel and suggested prompts"
```

---

### Task 6: History Page Improvements

**Files:**
- Modify: `frontend/src/components/meetings/MeetingsView.tsx`

- [ ] **Step 1: Add search + filters to MeetingsView**

Enhance the meetings list:
- **Search input** at the top: filters meetings by title (client-side filter)
- **Status filter tabs**: [All] [Uploaded] [Analyzed] [Approved] — click to filter
- **Sort**: by date (newest first by default)
- **Better card info**: show decision/action/risk counts for analyzed meetings
- **Empty states per filter**: "No approved meetings yet" vs "No meetings match your search"

Use existing dark theme styling. Search uses a debounced text input.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/meetings/MeetingsView.tsx
git commit -m "feat: add search and status filters to history page"
```

---

### Task 7: Trust Flags → Clickable Filters

**Files:**
- Modify: `frontend/src/components/review/ReviewView.tsx`

- [ ] **Step 1: Make trust flags interactive**

When the trust flag says "N source quote(s) could not be verified," make it clickable. Clicking it:
- Highlights/filters items with unverified quotes
- Add a small warning icon on each item card that has an unverified quote
- The flag acts as a toggle: click to show only unverified items, click again to show all

When "N item(s) have low confidence" is clicked:
- Filter to show only low-confidence items (same as setting the confidence filter to show low only)

Implementation: parse the trust flag text to determine which filter to apply, then update the confidence filter or add an "unverified only" filter state.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/review/ReviewView.tsx
git commit -m "feat: make trust flags clickable to filter affected items"
```

---

## Chunk 4: Final Integration + Polish

### Task 8: Wire Everything Together + Build

- [ ] **Step 1: Remove ChatPanel overlay from App.tsx**

Since chat is now a full route, remove:
- `ChatPanel` import and component
- `ChatButton` overlay (replace with simple navigate)
- `chatOpen` state
- `chatContextMeetingId` state (pass via URL params or route state instead)

The "Ask About This Meeting" button on MeetingDetail should navigate to `/chat?meeting={meetingId}` instead of opening a panel.

- [ ] **Step 2: Update MeetingDetail "Ask About This" to navigate to /chat**

```typescript
onOpenChat={(id) => navigate(`/chat?meeting=${id}`)}
```

ChatPage reads the `meeting` query param to set initial context.

- [ ] **Step 3: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Run backend tests**

```bash
pytest tests/ -v
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ routes/ extraction_pipeline.py database.py
git commit -m "feat: complete UX overhaul with split-pane review, full chat page, and pipeline fixes"
```
