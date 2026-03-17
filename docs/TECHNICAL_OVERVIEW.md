# Brainstorm Boost — Technical Overview

**Purpose:** This document explains how Brainstorm Boost processes meeting data from input to output. Intended for technical stakeholders evaluating the system's architecture and deployment requirements.

---

## System Overview

Brainstorm Boost is an AI-powered meeting intelligence system that transforms meeting transcripts (text or audio) into structured, queryable knowledge. It extracts decisions, action items, risks, and relationships — then stores them in a knowledge graph that supports cross-meeting queries.

```
Audio/Transcript → STT → 3-Pass LLM Pipeline → Knowledge Graph → Queryable Memory
                                                      ↓
                                               Human Verification
                                                      ↓
                                               Approved Output → Exports + Chat RAG
```

---

## 1. Input Processing

### Text Transcripts

Supported formats (auto-detected):
- **Microsoft Teams WebVTT** — WEBVTT files with `<v Speaker>` voice tags
- **Zoom VTT** — Arrow timestamps with `Speaker: text` lines
- **Otter.ai plain text** — `Speaker Name  HH:MM` followed by text blocks
- **Narrative / plain text** — Unstructured text (no speaker labels)

The parser (`transcript_parser.py`) normalizes all formats into a common structure:
```json
[
  {"speaker": "Alice", "text": "Let's discuss the battery options.", "timestamp": "00:01:30", "format_detected": "otter_plain"},
  {"speaker": "Bob", "text": "I've been researching lithium-polymer.", "timestamp": "00:02:15", "format_detected": "otter_plain"}
]
```

Consecutive utterances from the same speaker are automatically merged.

### Audio Files

Supported: MP3, WAV, M4A, WEBM, OGG, FLAC (max 500MB)

**Speech-to-Text pipeline:**
1. **Transcription** — `faster-whisper` (optimized OpenAI Whisper implementation)
   - Model: `whisper-medium` (~1.5GB, ~140M parameters)
   - Runs locally on Apple Silicon (MPS), NVIDIA GPU (CUDA), or CPU
   - Produces timestamped text segments

2. **Speaker Diarization** — `pyannote/speaker-diarization-3.1`
   - Identifies which speaker is talking at each moment
   - Runs locally, requires HuggingFace auth token (one-time license acceptance)
   - Accurate for 3-8 speakers

3. **Alignment** — Each whisper text segment is matched to a pyannote speaker label using midpoint timestamp overlap

Output format is identical to text transcript parsing — the rest of the pipeline doesn't know or care whether input was audio or text.

---

## 2. Analysis Pipeline (3-Pass LLM Extraction)

When the user clicks "Analyze," the transcript goes through three focused LLM passes. Each pass has a narrow task, producing better results than a single giant prompt.

### Pass 1: Entity Extraction

**Input:** Transcript chunked into segments (~12 speaker turns per chunk, or 500 words with overlap for narrative text)

**Task:** For each chunk, the LLM identifies:
- **People** — participant names
- **Topics** — subjects discussed
- **Decisions** — things decided (explicit or emergent)
- **Action Items** — tasks committed to (with owner, deadline, confidence)
- **Risks** — concerns or blockers raised

Each entity includes a verbatim `source_quote` copied directly from the transcript, and the `speaker` who said it.

**Post-processing after extraction:**
- **Source quote verification** — each quote is checked against the raw transcript. Exact substring match first, then fuzzy 5-word sliding window. Unverified quotes are flagged.
- **Semantic deduplication** — entities of the same type are compared using embedding similarity (cosine distance via `all-MiniLM-L6-v2`). Near-duplicates are merged. Thresholds: decisions 0.70, action items 0.70, risks 0.75.
- **Speaker detection** — speaker names are pre-extracted from the transcript format (regex, not LLM) and cross-referenced with extracted person entities to distinguish "was present" from "was mentioned."

### Pass 2: Structured Resolution

**Input:** All extracted entities (numbered E1, E2, ... En) plus relevant transcript context

**Task:** The LLM performs four operations:
1. **Flag duplicates** — identifies entity pairs that are the same thing rephrased
2. **Classify commitments** — determines if each action item was volunteered, assigned, or conditional
3. **Correct entity types** — flags entities that seem miscategorized (e.g., a "decision" that's actually an observation)
4. **Identify relationships** — maps connections between entities:
   - `DECIDED` — person made a decision
   - `OWNS` — person is responsible for a task
   - `RAISED` — person raised a risk
   - `DISCUSSED` — person spoke about a topic
   - `DEPENDS_ON` — one task depends on another
   - `RELATES_TO` — general connection

**Why numbered IDs:** The LLM receives entities as `E1: [person] Alice`, `E2: [decision] Use lithium batteries`, etc. It responds using ONLY these IDs (`E1 → DECIDED → E2`). This eliminates fragile string matching.

### Pass 3: Review Synthesis

**Input:** The complete knowledge graph (nodes + edges) serialized as structured text

**Task:** The LLM reads the graph and produces the final structured analysis:
- Meeting metadata (inferred title, date, participants, duration)
- Decisions with confidence ratings and rationale
- Action items with owners, deadlines, commitment types
- Open risks with severity
- State of direction (2-3 sentence summary)
- Trust flags (caveats about analysis quality)

**Confidence calibration:** The prompts explicitly instruct:
- **High** — first-person singular + specific deliverable + specific timeframe, no hedging
- **Medium** — any hedging, vague scope, or no specific deadline
- **Low** — vague, passive, deflecting, or assigned without confirmation
- Default: medium (not high)

### Fallback Mechanisms

If any pass fails (LLM unavailable, JSON parse error, zero results):
- Pass 1 failure → falls back to single-shot analysis (one LLM call, original approach)
- Pass 2 failure → proceeds with unlinked entities (graph has nodes but no edges)
- Pass 3 failure → assembles minimal review directly from graph nodes without LLM synthesis

The user always sees a result.

---

## 3. Knowledge Graph

Every analyzed meeting produces a knowledge graph stored in SQLite.

### Node Types

| Type | Scope | ID Format | Example |
|------|-------|-----------|---------|
| person | Cross-meeting | `person:alice` | Alice (same node across all meetings) |
| topic | Cross-meeting | `topic:a1b2c3d4` | "drone batteries" |
| decision | Per-meeting | `{meeting_id}:decision:1` | "Use lithium-polymer" |
| action_item | Per-meeting | `{meeting_id}:action_item:1` | "Contact suppliers by Friday" |
| risk | Per-meeting | `{meeting_id}:risk:1` | "Cold weather performance" |
| transcript_chunk | Per-meeting | `{meeting_id}:chunk:0` | Raw transcript passage |

**Cross-meeting linking:** Person and topic nodes are shared across meetings. When "Alice" appears in Meeting A and Meeting B, both meetings link to the same `person:alice` node. This enables queries like "What has Alice committed to across all meetings?"

### Edge Types

| Edge | From → To | Example |
|------|-----------|---------|
| DECIDED | person → decision | Alice decided to use lithium batteries |
| OWNS | person → action_item | Bob owns the supplier research task |
| RAISED | person → risk | Bob raised the cold weather concern |
| DISCUSSED | person → topic | Alice discussed drone batteries |
| DEPENDS_ON | action_item → action_item | Thermal simulation depends on supplier specs |
| RELATES_TO | any → any | Decision D1 relates to Action A1 |

---

## 4. Vector Search (ChromaDB)

Alongside the structured graph, meeting content is embedded into a vector database for semantic search.

**Embedding model:** `all-MiniLM-L6-v2` (22M parameters, 384 dimensions)
- Runs on Apple Silicon GPU (MPS), NVIDIA GPU (CUDA), or CPU
- ~80MB memory footprint

**What gets embedded (per meeting):**
1. Meeting overview (title + participants + summary)
2. Each decision as natural language
3. Each action item as natural language
4. Each risk as natural language
5. Raw transcript in 500-word overlapping chunks

**When indexed:** After human verification and approval. Only approved, human-verified data enters the search index. Optionally, users can manually add/remove meetings from the index via the UI.

**Search:** Cosine similarity with configurable top-k results. Used by the chat system and pre-meeting prep.

---

## 5. Human Verification (Review Page)

The AI output is presented for human review before anything is distributed or indexed:

- **Split-pane view** — original transcript on the left, structured analysis on the right
- **Inline editing** — every field (description, owner, deadline, made_by) is click-to-edit
- **Delete/reject** — individual items can be removed with confirmation + undo
- **Confidence filter** — slider to show All / Medium+ / High only items
- **Source verification** — click any source quote to highlight the matching passage in the transcript
- **Connection visualization** — relationship chips show how items are connected (click to navigate)
- **Timeline** — horizontal bar showing when decisions/actions/risks occurred in the meeting

After approval, the verified output is:
1. Saved to the database as the authoritative record
2. Indexed into ChromaDB for search
3. Exported as Markdown and JSON files
4. Action items extracted into a dedicated tracking table
5. Speaker profiles updated for participant recommendations

---

## 6. Chat System (RAG)

Users can ask natural language questions about their meeting history. The chat uses **dual retrieval** — combining knowledge graph traversal with vector similarity search.

### How a question is answered:

```
User: "What did we decide about drone batteries?"
                    ↓
    ┌───────────────┴───────────────┐
    │                               │
Graph Query                    Vector Search
(keyword + traversal)          (semantic similarity)
    │                               │
    ├── Node: "Use lithium-polymer" ├── Chunk: "Alice: I think the energy
    ├── Edge: Alice → DECIDED       │   density trade-off is worth it..."
    ├── Edge: D1 → RELATES_TO → A1  ├── Chunk: "Bob: I'll reach out to
    └── Node: "Bob" → OWNS → A1    │   three suppliers by Friday"
                                    └── Overview: "Team decided on lithium-
    ┌───────────────┴───────────────┐   polymer batteries..."
    │                               │
    └──────── MERGED CONTEXT ───────┘
                    ↓
              LLM Synthesis
    (graph provides structure, transcripts provide evidence)
                    ↓
    Answer: "In the Drone Battery Review meeting, Alice decided to use
    lithium-polymer batteries due to better energy density. Bob committed
    to contacting three suppliers by Friday."

    Sources: [Drone Battery Review — Decision] [Drone Battery Review — Action Item]
```

**Conversation memory:** Chat sessions persist in SQLite. The last 10 messages are sent as context on each turn, enabling follow-up questions like "Who else was involved?" or "What risks did they identify?"

**Context awareness:** When viewing a specific meeting, the chat automatically scopes queries to that meeting's data (while still searching across all meetings for cross-references).

---

## 7. Pre-Meeting Preparation

Given a meeting agenda, the system generates a read-ahead brief by querying the knowledge base:

1. **Related context** — vector search for past meetings touching the same topics
2. **Open action items** — outstanding tasks assigned to attendees from previous meetings
3. **Participant recommendations** — who has relevant expertise based on past contributions
4. **LLM synthesis** — combines all context into a readable briefing document

---

## 8. Live Session Features

Real-time meeting support via WebSocket:

- **Live transcription** — browser Web Speech API captures speech, sends text utterances to server
- **Participation monitoring** — tracks word count per speaker, flags dominant speakers (>45%) and silent participants (>60 seconds)
- **Topic drift detection** — embeds recent discussion and compares cosine similarity to the meeting agenda. Alert when similarity drops below 0.35
- **Context surfacing** — periodically queries past meeting data for related decisions/context
- **Anonymous ideas** — participants join via join code on their phones, submit and vote on ideas
- **Session end → Review** — live transcript feeds directly into the analysis pipeline for post-meeting review

---

## 9. Models & Infrastructure

### Models Used

| Component | Model | Parameters | Size on Disk | Runs On |
|-----------|-------|-----------|-------------|---------|
| LLM (cloud) | Gemini 2.0 Flash | ~9B | Cloud | Google API |
| LLM (local) | Qwen 2.5 7B Instruct (Q4) | 7B | ~4.5 GB | Ollama (local) |
| Speech-to-Text | Whisper Medium | ~140M | ~1.5 GB | Local (MPS/CUDA/CPU) |
| Speaker Diarization | pyannote 3.1 | ~80M | ~300 MB | Local (CPU) |
| Embeddings | all-MiniLM-L6-v2 | 22M | ~80 MB | Local (MPS/CUDA/CPU) |

### Storage

| Store | Technology | Data | Location |
|-------|-----------|------|----------|
| Primary DB | SQLite | Meetings, graph, action items, chat, exports | `brainstorm_boost.db` |
| Vector Store | ChromaDB | Embedded meeting content | `chroma_db/` directory |
| Exports | File system | Markdown + JSON reports | `exports/` directory |

### Deployment Requirements

- **Minimum:** Python 3.11+, Node.js 18+, 16GB RAM
- **For local LLM:** Ollama installed with a 7B model pulled
- **For audio:** HuggingFace account with pyannote license accepted, `HF_TOKEN` set
- **For cloud LLM:** Google API key (`GOOGLE_API_KEY`)
- **Network:** Works fully offline with Ollama. Cloud LLM requires internet.
- **Start command:** `make dev` (starts both backend on :8000 and frontend on :5173)

### Memory Budget (all local, live session)

```
Whisper medium ............ ~1.5 GB
pyannote diarization ...... ~300 MB
PyTorch runtime ........... ~400 MB
Embedding model ........... ~80 MB
ChromaDB .................. ~50 MB
FastAPI + Python ........... ~400 MB
Ollama LLM (on-demand) .... ~4.5 GB
────────────────────────────────
Total peak ................ ~7.2 GB (without LLM) / ~11.7 GB (with LLM)
```

Fits within 16GB with swap headroom.

---

## 10. Tech Stack

### Backend
- **Framework:** FastAPI (Python)
- **Database:** SQLite (zero-config, single file)
- **Vector DB:** ChromaDB (embedded, persistent)
- **LLM Providers:** Google Gemini API, Ollama (local)
- **STT:** faster-whisper + pyannote.audio
- **Embeddings:** sentence-transformers

### Frontend
- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **Styling:** Tailwind CSS + shadcn/ui components
- **State:** React Query (server state), React Router (navigation)
- **Real-time:** WebSocket (live sessions), Server-Sent Events (progress)

### Key Design Decisions

1. **3-pass pipeline over single-shot** — each LLM pass has a narrow, focused task. Better results from smaller models.
2. **Knowledge graph in SQL** — no graph database dependency. SQLite tables with indexes handle the query patterns we need.
3. **Dual retrieval for chat** — graph gives structure ("who decided what"), vectors give evidence ("here are the exact words").
4. **Human-in-the-loop** — AI output is always reviewed before indexing. Trust is earned incrementally.
5. **Provider-agnostic** — same prompts work with cloud (Gemini) or local (Ollama). Switch with one dropdown.
6. **Everything local-capable** — entire system runs on a single laptop with no internet. Critical for DoD deployment.
