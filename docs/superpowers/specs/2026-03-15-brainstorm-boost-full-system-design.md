# Brainstorm Boost — Full System Design

**Date:** 2026-03-15
**Status:** Draft
**Authors:** Bibas Kandel
**Target demo:** May 2026 at NIWC Pacific, Pearl City, HI

---

## 1. Overview

Brainstorm Boost is an AI-powered meeting intelligence system for NIWC Pacific. It turns meeting audio into structured, queryable knowledge — decisions with rationale, action items with owners, risks, and institutional memory that survives personnel rotation.

The system is designed to run **fully offline on a single laptop** (M5 MacBook Pro, 16GB RAM) using local models via Ollama, with optional cloud providers (Anthropic Claude, Google Gemini) for development and quality comparison.

The product ships in three phases, each independently deployable:

- **Phase 1:** Post-Meeting Intelligence (partially built)
- **Phase 2:** Pre-Meeting Preparation
- **Phase 3:** Real-Time Meeting Moderation

---

## 2. Design Principles

| Principle | Implementation |
|-----------|---------------|
| Augment humans, don't replace them | Human-in-the-loop verification before any output is distributed |
| Transparency earns trust | Every AI claim links to a verbatim source quote; confidence levels on all extractions |
| Security-first deployment | Fully local — no data leaves the machine. Ollama + faster-whisper, no cloud dependency |
| Zero admin burden | Audio in → structured output. No manual data entry required |
| Provider-agnostic | Same prompts, same pipeline — cloud (Claude/Gemini) or local (Ollama). Compare quality side-by-side |
| Start simple, prove value | Phase 1 first; each phase independently useful |

---

## 3. Hardware & Development Strategy

### Single machine: M5 MacBook Pro (16GB RAM)
- All development AND demo on this machine — no desktop available
- Apple Silicon unified memory + swap provides flexibility beyond the 16GB nominal limit
- Models must be selected to fit within ~10-12GB (leaving room for OS + app)

### Development workflow: Cloud LLM for development, everything else local
- **STT + diarization:** Always local (faster-whisper + pyannote) — runs well on Apple Silicon, same pipeline for dev and demo
- **Embeddings:** Always local (all-MiniLM-L6-v2) — lightweight, no reason for cloud
- **LLM (analysis, RAG, clustering):** Cloud providers (Claude Sonnet, Gemini Flash) during development for fast iteration and prompt engineering. Switch to Ollama for demo.
- **Demo readiness:** Before the May NIWC visit, validate full pipeline with Ollama. Provider abstraction makes switching a one-dropdown change.
- **Quality comparison:** Side-by-side view so NIWC can see local vs cloud LLM output quality

| Component | Development | Demo |
|-----------|-------------|------|
| STT | Local (faster-whisper) | Local (faster-whisper) |
| Speaker diarization | Local (pyannote) | Local (pyannote) |
| LLM (analysis) | Cloud (Claude/Gemini) | Local (Ollama) |
| Embeddings | Local (all-MiniLM-L6-v2) | Local (all-MiniLM-L6-v2) |

---

## 4. Architecture

### 4.1 Overall Stack

| Component | Tool | Rationale |
|-----------|------|-----------|
| Web framework | FastAPI (existing) | Already built, async-capable, WebSocket support |
| LLM inference | Ollama (local) / Anthropic / Gemini (cloud) | NIWC recommended Ollama; cloud for dev/comparison |
| Speech-to-text | faster-whisper | Optimized Whisper implementation, CoreML on Apple Silicon |
| Speaker diarization | pyannote.audio | Local, accurate for 3-8 speakers |
| Vector search | ChromaDB (embedded) | Local, no separate process, cross-meeting search |
| Database | SQLite (existing) | Already built, sufficient for single-machine deployment |
| Frontend | Vanilla HTML/JS (existing) | No build step, simple to demo |

### 4.2 Process Model

Two processes at runtime:

1. **Ollama** (`ollama serve`) — manages LLM model loading, inference, and memory
2. **Brainstorm Boost** (`python main.py`) — FastAPI app with everything else: STT, ChromaDB, web UI, WebSocket server

### 4.3 Provider Abstraction

```
llm_client.py
├── _analyze_with_anthropic()  # existing — Claude Sonnet (cloud)
├── _analyze_with_gemini()     # existing — Gemini Flash (cloud)
└── _analyze_with_ollama()     # NEW — local model via Ollama HTTP API
```

All providers receive the same system prompt and user prompt. The Ollama provider uses the OpenAI-compatible API that Ollama exposes (`POST http://localhost:11434/v1/chat/completions`).

### 4.4 Model Selection

| Task | Model | Size | Notes |
|------|-------|------|-------|
| Meeting analysis (local) | qwen2.5:7b-instruct-q4_K_M | ~4.5 GB | Best structured JSON output at 7B size |
| Meeting analysis (cloud) | Claude Sonnet / Gemini Flash | — | Quality baseline for comparison |
| Speech-to-text (preferred) | whisper-medium | ~1.5 GB | Better accuracy for technical/military vocab and accented speakers |
| Speech-to-text (fallback) | whisper-small | ~460 MB | Use if memory is tight during Phase 3 live sessions |
| Speaker diarization | pyannote/speaker-diarization-3.1 | ~300 MB | Runs on CPU, accurate for meeting-size groups. **Requires HuggingFace auth token** — must accept model license and set `HF_TOKEN` env var |
| Embeddings | all-MiniLM-L6-v2 | ~80 MB | Fast, good quality for semantic search |
| Idea clustering (Phase 3) | qwen2.5:3b-instruct-q4_K_M | ~2 GB | Lightweight, loaded on-demand only |

### 4.5 Memory Budget (Peak — Live Session on 16GB MacBook)

```
whisper-medium ............ ~1.5 GB  (loaded during STT; swap to whisper-small if needed)
pyannote diarization ...... ~300 MB  (loaded during STT)
PyTorch runtime ........... ~400 MB  (shared by pyannote + sentence-transformers)
embedding model ........... ~80 MB   (loaded for search/drift)
ChromaDB .................. ~50 MB   (in-process)
FastAPI + Python .......... ~400 MB  (includes all imported libraries)
macOS + system ............ ~4-5 GB
────────────────────────────────────
Subtotal (always loaded) .. ~7.2 GB

Ollama LLM (on-demand) .... ~2-4.5 GB
────────────────────────────────────
Total peak ................ ~10-12 GB (within 16GB; swap absorbs bursts)
```

**Memory management strategy for Phase 3 live sessions:**
- STT models (whisper + pyannote) stay loaded for the duration of the live session
- Ollama LLM is loaded on-demand for idea clustering and post-session analysis
- To reclaim memory: `ollama stop <model>` after each LLM task completes
- If memory pressure is observed, downgrade to whisper-small (~1 GB savings)
- Post-meeting analysis (Phase 1 pipeline) runs after STT models are unloaded at session end

---

## 5. Phase 1: Post-Meeting Intelligence

### 5.1 What Exists

- `main.py` — FastAPI app with 7 endpoints (upload, analyze, approve, providers, meetings list/detail, static index)
- `llm_client.py` — Anthropic + Gemini providers with detailed meeting analysis prompt
- `transcript_parser.py` — Multi-format parser (Teams WebVTT, Zoom VTT, Otter.ai, narrative)
- `database.py` — SQLite with meetings + exports tables
- `static/index.html` — Single-page frontend (upload, review, export)

### 5.2 What Phase 1 Adds

#### 5.2.1 Ollama Provider (`llm_client.py` — modify)

Add `_analyze_with_ollama()` using Ollama's OpenAI-compatible API:

- `POST http://localhost:11434/v1/chat/completions`
- Same system prompt and output schema as existing providers
- Auto-detect Ollama availability via health check (`GET http://localhost:11434/api/tags`)
- Add "ollama" to `get_available_providers()` when Ollama is running

#### 5.2.2 Speech-to-Text Engine (`stt_engine.py` — new)

```python
# Core functions:
transcribe_file(file_path: Path, model_size: str = "medium") -> list[dict]
    # Input: .mp3, .wav, .m4a, .webm audio file
    # Output: list of {"speaker": str, "text": str, "timestamp": str, "format_detected": "audio"}
    # Uses faster-whisper for transcription + pyannote for diarization
    # Runs in a thread pool to avoid blocking the FastAPI event loop

transcribe_stream(audio_chunks: AsyncIterator[bytes]) -> AsyncIterator[dict]
    # Input: streaming audio chunks (~5 second windows)
    # Output: yields utterances as they're recognized
    # Used by Phase 3 live transcription

get_transcription_progress() -> dict
    # Returns {"status": "processing"|"complete"|"error", "percent": float, "elapsed_seconds": float}
```

Pipeline:
1. faster-whisper transcribes audio → timestamped text segments
2. pyannote.audio processes same audio → speaker segments with time boundaries
3. Align whisper segments with pyannote speaker labels → speaker-attributed utterances
4. Output format matches existing `transcript_parser.py` utterance format (includes `format_detected: "audio"`)
5. Raw formatted transcript is stored in the `meetings.raw_transcript` column for verbatim source traceability

**Async strategy:** File transcription runs in `asyncio.to_thread()` to avoid blocking the event loop. Long files (>30 min audio) may take several minutes — the endpoint returns a `meeting_id` immediately and the client polls `/api/meetings/{id}` for status updates, or connects via WebSocket for progress.

**Error handling:**
- Audio quality too poor → return partial transcript with `trust_flags: ["low audio quality — X% of segments had low confidence"]`
- Unsupported format → return 415 with supported formats list
- File too large (>4 hours) → return 413 with size limit message

#### 5.2.3 Meeting Memory (`meeting_memory.py` — new)

```python
# Core functions:
index_meeting(meeting_id: str, ai_output: dict) -> None
    # Chunks and embeds decisions, action items, risks, state_of_direction
    # Stores in ChromaDB with metadata (meeting_id, item_type, date)

query(question: str, top_k: int = 5) -> list[dict]
    # Vector similarity search across all indexed meetings
    # Returns relevant excerpts with source meeting info

query_with_llm(question: str, provider: str = None) -> dict
    # Retrieves relevant context via query()
    # Feeds context + question to LLM for synthesized answer
    # Returns {"answer": str, "sources": list[dict]}
```

ChromaDB collection stored at `./chroma_db/` alongside the SQLite database. Embedding model: `all-MiniLM-L6-v2` via `sentence-transformers`.

#### 5.2.4 New API Endpoints (`main.py` — modify)

```
POST /api/upload-audio
    # Accepts audio file, starts async STT, creates meeting
    # Returns {"meeting_id": str, "status": "transcribing"} immediately
    # Client polls GET /api/meetings/{id} for completion or uses WebSocket for progress

POST /api/query
    # Body: {"question": str, "provider": str (optional)}
    # Returns synthesized answer with source citations

GET /api/providers
    # Modified to include "ollama" when available
```

#### 5.2.5 Auto-Index on Approval (`main.py` — modify)

When a meeting is approved via `POST /api/approve`, automatically index the verified output into ChromaDB via `meeting_memory.index_meeting()`. This ensures the knowledge base grows with every approved meeting.

#### 5.2.6 Verbatim vs. Interpretation Display (`static/index.html` — modify)

In the review UI, AI outputs are displayed with clear visual separation:
- **Source quotes** shown in blockquote styling with a "Verbatim" label
- **AI interpretations** (descriptions, confidence rationale, state_of_direction) shown with an "AI Interpretation" label and distinct background color
- Each decision/action/risk links to its source quote for traceability

#### 5.2.7 Frontend Updates (`static/index.html` — modify)

- Add audio file upload support (accept `.mp3`, `.wav`, `.m4a`, `.webm`)
- Add "Ask a question" section for meeting memory queries
- Add "ollama" option in provider dropdown
- Show transcription progress bar for audio files

---

### 5.3 Out of Scope for Phase 1 (Acknowledged Gaps)

| Requirement | Status | Rationale |
|-------------|--------|-----------|
| R-POST-5: Automated Distribution (Teams/Outlook) | **Deferred** | Requires network access and Teams/Outlook APIs. Not feasible on air-gapped laptop. For the demo, export to file is sufficient. Can be added when deployed on NIWC network infrastructure. |
| R-ORG-1: Cross-Team Overlap Detection | **Deferred to Phase 2+** | Requires multiple teams using the system concurrently. The ChromaDB infrastructure supports it — when a new meeting is analyzed, it could flag "Team B discussed this topic 2 weeks ago." Will add once there is enough multi-team data. |
| R-ORG-3: Knowledge Curation (dedup, superseded decisions) | **Deferred** | ChromaDB accumulates all indexed meetings. Deduplication and superseded-decision handling will be needed as the corpus grows, but is not critical for a 3-5 meeting demo. |
| Hybrid meeting support (remote/dial-in audio) | **Deferred** | Phase 1 handles uploaded audio files and typed transcripts. Capturing audio from Teams/Zoom calls requires platform-specific integrations. For demo, in-person audio and file upload cover the use case. |
| Custom vocabulary for Navy acronyms | **Deferred** | Would improve STT accuracy for military jargon. Can be added as a Whisper prompt prefix or fine-tuned vocabulary list. Not blocking for demo. |

---

## 6. Phase 2: Pre-Meeting Preparation

Phase 2 queries the knowledge base built by Phase 1 to generate pre-meeting intelligence.

### 6.1 Meeting Prep Engine (`meeting_prep.py` — new)

```python
generate_read_ahead(agenda: str, participants: list[str], role: str = "technical") -> dict
    # 1. Vector search past meetings for topics in the agenda
    # 2. Pull open action items assigned to participants
    # 3. LLM synthesizes into a role-appropriate brief
    # Returns {"summary": str, "related_decisions": list, "open_items": list}

surface_assumptions(agenda: str, past_context: list[dict]) -> list[dict]
    # EXPERIMENTAL — quality depends heavily on model capability
    # LLM identifies implicit assumptions in the agenda
    # Cross-references what's been decided vs still open
    # Returns [{"assumption": str, "status": "confirmed|gap|unknown", "source": str}]
    # For demo: pre-validate outputs. Do not show if results are confusing.

recommend_participants(agenda: str) -> list[dict]
    # NOTE: Effectiveness depends on corpus size. With 3-5 seeded meetings,
    # recommendations will be thin. Most useful after sustained real usage.
    # Search speaker_profiles for expertise matching agenda topics
    # Rank by contribution relevance, not just attendance
    # Returns [{"name": str, "reason": str, "past_contributions": int}]

get_open_items(topic: str = None, participants: list[str] = None) -> list[dict]
    # Query action items with status=open
    # Filter by topic relevance and/or participant assignment
    # Returns [{"task": str, "owner": str, "from_meeting": str, "deadline": str}]
```

### 6.2 Database Extensions (`database.py` — modify)

```sql
-- Denormalized action items for efficient querying
CREATE TABLE IF NOT EXISTS action_items (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    task TEXT NOT NULL,
    owner TEXT,
    deadline TEXT,
    status TEXT NOT NULL DEFAULT 'open',  -- open, completed, cancelled
    confidence TEXT,
    source_quote TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

-- Speaker expertise profiles (built from meeting participation)
CREATE TABLE IF NOT EXISTS speaker_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    topics_json TEXT,          -- list of topics they've discussed
    meeting_count INTEGER DEFAULT 0,
    last_seen TEXT,
    expertise_summary TEXT     -- LLM-generated summary of their expertise
);
```

When a meeting is approved, action items are extracted from the verified output and inserted into `action_items`. Speaker profiles are updated based on participation.

### 6.3 New API Endpoints (`main.py` — modify)

```
POST /api/prep/read-ahead
    # Body: {"agenda": str, "participants": list[str], "role": "technical"|"executive"}
    # Returns read-ahead brief

POST /api/prep/recommend-participants
    # Body: {"agenda": str}
    # Returns recommended participants with reasoning

GET  /api/prep/open-items
    # Query params: topic, participant
    # Returns filtered open action items

POST /api/action-items/{item_id}/status
    # Body: {"status": "completed"|"cancelled"}
    # Update action item status
```

### 6.4 Frontend (`static/index.html` — modify)

- Add "Prepare Meeting" section: input agenda + participant list → generate read-ahead
- Display read-ahead with sections: summary, related past decisions, open items, assumptions, recommended participants
- Action items management: view all open items, mark as completed/cancelled

---

## 7. Phase 3: Real-Time Meeting Moderation

### 7.1 Live Session Orchestrator (`live_session.py` — new)

Central coordinator for all real-time features during a live meeting.

```python
class LiveSession:
    def __init__(self, agenda: str, participants: list[str]):
        self.agenda = agenda
        self.agenda_embedding = embed(agenda)
        self.participants = participants
        self.transcript = []           # accumulated utterances
        self.speaking_stats = {}       # speaker -> {word_count, duration}
        self.alerts = []               # moderator alerts queue
        self.session_id = str(uuid4())

    async def process_audio_chunk(self, chunk: bytes) -> dict:
        # 1. STT: faster-whisper transcribes chunk
        # 2. Diarization: pyannote identifies speaker
        # 3. Append to transcript
        # 4. Update speaking_stats
        # 5. Return {"speaker": str, "text": str, "timestamp": str}

    def get_participation_stats(self) -> dict:
        # Returns per-speaker word count, % of total, time since last spoke
        # Flags: dominant speakers, silent experts

    def check_topic_drift(self) -> dict:
        # Embed last ~60 seconds of discussion
        # Cosine similarity against self.agenda_embedding
        # Returns {"similarity": float, "drifted": bool, "current_topic": str}

    async def surface_context(self) -> list[dict]:
        # Embed recent discussion chunk
        # Query ChromaDB for related past decisions/items
        # Returns [{"type": "decision|action|risk", "content": str, "from_meeting": str}]

    async def end_session(self) -> str:
        # 1. Compile full transcript into raw text
        # 2. Unload STT models to free memory for LLM analysis
        # 3. Call create_meeting() + analyze_transcript() directly (Python function calls, not HTTP)
        # 4. Index into ChromaDB via meeting_memory.index_meeting()
        # 5. Return meeting_id for human verification
```

### 7.2 Idea Board (`idea_board.py` — new)

```python
class IdeaBoard:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.ideas = []        # {"id": str, "text": str, "votes": int}
        self.clusters = []     # {"label": str, "ideas": list[str], "vote_total": int}

    def submit_idea(self, text: str) -> str:
        # Add idea anonymously, return idea_id

    def vote(self, idea_id: str) -> None:
        # Increment vote count (one vote per session token per idea)

    async def cluster_ideas(self, provider: str = None) -> list[dict]:
        # Batch LLM call to semantically group similar ideas
        # e.g., "bus" + "car" → "vehicles" cluster
        # Uses qwen2.5:3b for lightweight clustering

    def get_results(self) -> dict:
        # Returns clusters ranked by total votes
```

### 7.3 WebSocket Endpoint (`main.py` — modify)

Single unified WebSocket with message-type routing:

```
WebSocket /ws/session?code=XXXX
    # All clients (moderator + participants) connect to the same endpoint
    # Message routing by type:
    #
    # Server → All clients:
    #   {"type": "utterance", "speaker": str, "text": str, "timestamp": str}
    #   {"type": "ideas_update", "clusters": list, "ideas": list}
    #
    # Server → Moderator only (filtered by client role):
    #   {"type": "participation", "stats": dict}
    #   {"type": "drift", "similarity": float, "drifted": bool}
    #   {"type": "context", "items": list[dict]}
    #   {"type": "alert", "message": str, "severity": "info"|"warning"}
    #
    # Client → Server:
    #   {"type": "audio_chunk", "data": base64}  (moderator only — mic input)
    #   {"type": "submit_idea", "text": str}      (any participant)
    #   {"type": "vote", "idea_id": str}           (any participant)
    #
    # Connection params: ?code=XXXX&role=moderator|participant
```

### 7.4 New HTTP Endpoints (`main.py` — modify)

```
POST /api/live/start
    # Body: {"agenda": str, "participants": list[str]}
    # Generates a 6-character alphanumeric join code (e.g., "A3KF9X")
    # Only one active session at a time (MVP — single machine)
    # Returns {"session_id": str, "join_code": str}

POST /api/live/end
    # Body: {"session_id": str}
    # Ends session, unloads STT models, triggers Phase 1 pipeline
    # Returns {"meeting_id": str}  (for human verification)

GET  /api/live/status
    # Returns current session state (if any active)
```

### 7.5 Session Security (MVP-level)

- **Join codes:** 6-character alphanumeric, generated per session, displayed on room view screen
- **Session tokens:** Each WebSocket connection gets a random UUID token stored in-memory. Used to enforce one-vote-per-participant-per-idea.
- **No persistent auth:** This is a local WiFi tool in a physical room — the join code is the access control. Anyone on the same network with the code can participate.
- **Single session:** Only one live session at a time. Starting a new session ends any existing one.

### 7.6 Frontend — Live Meeting View (`static/live.html` — new)

Single-page app with two views toggled by Ctrl+M or button:

**Room View** (shareable — can be projected):
- Live scrolling transcript with speaker labels
- Idea clusters with vote counts (when idea board is active)
- Meeting timer

**Moderator View** (private):
- Participation bar chart (per-speaker word count %)
- Topic drift indicator (similarity gauge, 0-1 scale)
- Past context cards ("Related: In meeting X, you decided Y")
- Alert queue with suggested actions ("Alex hasn't spoken — expert on this topic")
- Controls: start/stop idea collection, end session

### 7.7 Frontend — Participant Join (`static/join.html` — new)

Mobile-friendly page for participants to join via `http://<macbook-ip>:8000/join?code=XXXX`:

- Enter session code (displayed on room view)
- Anonymous idea submission text box
- View idea clusters and vote
- No login, no account required
- Works over local WiFi only

---

## 8. File Structure (Final)

```
brainstorm-boost/
├── main.py                  # FastAPI app — app setup, startup, mounts routers
├── routes/                  # NEW — organized by phase to keep main.py manageable
│   ├── upload.py            # /api/upload-transcript, /api/upload-audio
│   ├── analyze.py           # /api/analyze, /api/approve, /api/providers
│   ├── meetings.py          # /api/meetings, /api/meetings/{id}, /api/query
│   ├── prep.py              # NEW — /api/prep/* (Phase 2 endpoints)
│   └── live.py              # NEW — /api/live/*, /ws/session (Phase 3 endpoints)
├── llm_client.py            # LLM provider abstraction (Anthropic, Gemini, Ollama)
├── transcript_parser.py     # Multi-format transcript parser (existing)
├── database.py              # SQLite — meetings, exports, action_items, speaker_profiles
├── stt_engine.py            # NEW — faster-whisper + pyannote STT pipeline
├── meeting_memory.py        # NEW — ChromaDB vector search + RAG queries
├── meeting_prep.py          # NEW — Phase 2 pre-meeting intelligence
├── live_session.py          # NEW — Phase 3 real-time session orchestrator
├── idea_board.py            # NEW — Phase 3 anonymous idea submission + voting
├── requirements.txt         # Updated with new dependencies
├── .env                     # API keys, HF_TOKEN for pyannote
├── static/
│   ├── index.html           # Main UI — upload, review, export, query (modified)
│   ├── live.html            # NEW — live meeting view (room + moderator toggle)
│   └── join.html            # NEW — mobile participant join page
├── brainstorm_boost.db      # SQLite database
├── chroma_db/               # NEW — ChromaDB vector store
├── exports/                 # Generated markdown + JSON exports
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-03-15-brainstorm-boost-full-system-design.md
```

Note: Existing endpoints in `main.py` will be refactored into `routes/` using FastAPI `APIRouter` to keep files focused. This is a non-breaking refactor — all URLs stay the same.

---

## 9. Dependencies (additions to requirements.txt)

```
# Local LLM (Ollama client)
openai>=1.0.0               # Ollama's OpenAI-compatible API

# Speech-to-text
faster-whisper>=1.0.0        # Optimized Whisper implementation
pyannote.audio>=3.1          # Speaker diarization

# Vector search
chromadb>=0.4.0              # Embedded vector database
sentence-transformers>=2.0   # Embedding model (all-MiniLM-L6-v2)

# Audio handling
sounddevice>=0.4.0           # Microphone capture for live sessions
numpy>=1.24.0                # Audio array processing
```

---

## 10. Demo Plan (May 2026 at NIWC)

### Setup
1. Install Ollama on MacBook, pull `qwen2.5:7b-instruct-q4_K_M` and `qwen2.5:3b-instruct-q4_K_M`
2. Accept pyannote model license on HuggingFace, set `HF_TOKEN` in `.env`
3. Pre-seed 3-5 sample meetings in the system (realistic NIWC-style brainstorming transcripts)
4. Pre-index all sample meetings into ChromaDB
5. Test full pipeline end-to-end on MacBook with WiFi off (verify no network dependency)

### Demo Flow
1. **Phase 1 — Post-Meeting:** Upload a pre-recorded meeting audio → show STT → show AI analysis → human verification → export. Then query: "What did we decide about drone frequencies?" — show RAG answer with sources.
2. **Phase 2 — Pre-Meeting:** Create a new meeting with an agenda → show auto-generated read-ahead with context from past meetings, open action items, recommended participants.
3. **Phase 3 — Live Session:** Start a live session with the MacBook mic in the room. Show real-time transcription, participation monitoring, topic drift detection. Have attendees join on phones for anonymous idea submission. End session → auto-feed into Phase 1 pipeline.
4. **Quality Comparison:** Show the same transcript analyzed by local model vs cloud model side-by-side. Demonstrate that even on a laptop, the output is actionable.

### Fallback
If live STT struggles with room acoustics, have a pre-recorded clean audio file ready to upload instead. The intelligence layer (Phases 1-2) works the same either way.
