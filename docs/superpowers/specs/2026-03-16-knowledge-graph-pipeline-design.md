# Knowledge Graph Pipeline — Design Spec

**Date:** 2026-03-16
**Status:** Draft
**Goal:** Replace the single-shot LLM extraction with a multi-pass knowledge graph pipeline. Store entities, relationships, and transcript chunks so chat queries hit real data — not AI summaries. Enable graph-enhanced review cards showing connections between decisions, actions, and risks.

---

## 1. Problem

The current pipeline sends the entire transcript to an LLM in one prompt and gets back a JSON blob of decisions, action items, and risks. This is:
- **Lossy** — the original transcript is stored but never used for queries
- **Fragile** — one LLM call extracts everything; if it misses something, it's gone
- **Hallucination-prone** — chat queries search AI-generated summaries, then another LLM synthesizes from those summaries, compounding errors
- **Disconnected** — no relationships between extracted items (a decision has no link to the action item it spawned)

## 2. Solution

Build a knowledge graph from each meeting transcript using a 3-pass LLM extraction pipeline. Store entities and relationships in SQLite. Embed raw transcript chunks in ChromaDB. Chat queries use both graph traversal and vector search, giving the LLM structured context grounded in original words.

---

## 3. Knowledge Graph Schema

### 3.1 Node Types

| Type | Description | Example |
|------|-------------|---------|
| `meeting` | The meeting itself | "Drone Battery Review, 2026-03-15" |
| `person` | A participant (persists across meetings) | "Alice", "Bob" |
| `decision` | Something that was decided | "Use lithium-polymer batteries" |
| `action_item` | A task with an owner | "Contact three suppliers by Friday" |
| `risk` | A concern or blocker | "Cold weather battery performance" |
| `topic` | A subject discussed | "drone batteries", "frequency allocation" |
| `transcript_chunk` | A passage from the raw transcript | ~500 words of original text |

Note: `commitment` is NOT a separate node type. Commitments are stored as `action_item` nodes with commitment-specific metadata (confidence, linguistic signals, commitment_type) in `properties_json`.

### 3.2 Edge Types

| Edge | From → To | Description |
|------|-----------|-------------|
| `DECIDED` | person → decision | Who made/formulated the decision |
| `RATIFIED` | person → decision | Who confirmed/agreed |
| `OWNS` | person → action_item | Who is responsible |
| `RAISED` | person → risk | Who raised the concern |
| `DISCUSSED` | person → topic | Who spoke about this topic (meeting context via edge's meeting_id) |
| `DEPENDS_ON` | action_item → action_item | Task dependency |
| `RELATES_TO` | decision → action_item, decision → risk, etc. | General relationship between items |
| `ATTENDED` | person → meeting | Participation |
| `MENTIONED_IN` | any node → transcript_chunk | Links an entity to its source text |
| `FOLLOWS_UP_ON` | meeting → meeting | Cross-meeting link (follow-up sessions) |

Note: `SPOKE_ABOUT` was removed — `DISCUSSED` with the edge's `meeting_id` column provides the same information without redundancy.

### 3.3 SQLite Tables

```sql
CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    meeting_id TEXT,                    -- NULL for cross-meeting entities (persons, topics)
    node_type TEXT NOT NULL,            -- person|decision|action_item|risk|topic|meeting|transcript_chunk
    content TEXT NOT NULL,              -- the natural language content
    properties_json TEXT,              -- type-specific metadata (owner, deadline, confidence, severity, etc.)
    source_start INTEGER,              -- character offset in raw_transcript (nullable)
    source_end INTEGER,                -- character offset end (nullable)
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_meeting ON graph_nodes(meeting_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_meeting_type ON graph_nodes(meeting_id, node_type);

CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    edge_type TEXT NOT NULL,           -- DECIDED|OWNS|RAISED|DISCUSSED|DEPENDS_ON|ATTENDED|MENTIONED_IN|RELATES_TO|FOLLOWS_UP_ON|RATIFIED
    meeting_id TEXT,                    -- which meeting established this relationship
    weight REAL DEFAULT 1.0,           -- confidence/strength (0-1)
    properties_json TEXT,              -- edge-specific metadata
    created_at TEXT NOT NULL,
    FOREIGN KEY (source_node_id) REFERENCES graph_nodes(id),
    FOREIGN KEY (target_node_id) REFERENCES graph_nodes(id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_meeting ON graph_edges(meeting_id);
```

### 3.4 Node ID Scheme

IDs are deterministic, not random UUIDs:
- **Person nodes:** `person:{normalized_name}` (e.g., `person:alice`, `person:bob_smith`). Normalized = lowercase, whitespace collapsed, trimmed.
- **Topic nodes:** `topic:{normalized_content_hash}` (first 8 chars of SHA256 of lowercased content). Allows dedup of similar topics.
- **Meeting-scoped nodes:** `{meeting_id}:{type}:{sequence}` (e.g., `abc123:decision:1`, `abc123:action_item:2`). Sequence is the extraction order within the meeting.
- **Transcript chunks:** `{meeting_id}:chunk:{index}` (e.g., `abc123:chunk:0`, `abc123:chunk:1`).
- **Meeting nodes:** `meeting:{meeting_id}`.

This scheme enables:
- Cross-meeting person/topic dedup by ID collision (same person = same ID)
- Stable entity references for Pass 2 (the LLM gets short IDs like `E1`, `E2` which map to real graph IDs)
- No accidental overwrites between meetings

### 3.5 Cross-Meeting Entity Matching

Person nodes and topic nodes persist across meetings. When a new meeting mentions "Alice", the pipeline calls `find_or_create_person("Alice")` which checks for existing `person:alice` node. If found, reuses it. If not, creates it. New edges link the existing person to the new meeting's nodes.

Topic matching is similar but uses content similarity — `find_or_create_topic("drone batteries")` checks for existing topics with similar content (exact match first, then fuzzy).

---

## 4. Extraction Pipeline

### 4.1 Post-Meeting (Upload or Live Session End)

```
Raw transcript
    ↓
Chunk transcript into ~2000-token segments
    ↓
Pass 1: ENTITY EXTRACTION
    For each chunk, send focused prompt:
    "Extract all entities from this meeting transcript segment.
     Return: people (names), topics (subjects discussed),
     decisions (what was decided), commitments (what people agreed to do),
     risks (concerns raised). For each, note the approximate character position."

    Output: list of {type, content, source_start, source_end, properties}
    ↓
Deduplicate entities (merge "Alice" appearing in multiple chunks)
    ↓
Pass 2: RELATIONSHIP EXTRACTION (chunked to fit context window)
    Assign stable short IDs to all entities: E1, E2, E3, ...
    Process in batches of ~30 entities per LLM call (with relevant transcript context)
    "Given these numbered entities, identify relationships using ONLY the provided IDs."

    Output: list of {source_id: "E1", edge_type, target_id: "E5", weight: 1.0}
    Weight defaults to 1.0 (7B models unreliable at scoring)
    ↓
Validate: reject edges referencing non-existent entity IDs
    ↓
Pass 3: REVIEW SYNTHESIS (chunked if graph is large)
    Input: the knowledge graph (nodes + edges) as structured context
    If graph has >50 nodes, chunk by topic cluster and synthesize per-cluster
    then merge results

    Output: the review JSON (same schema as current ai_output_json)
    ↓
Store:
    - graph_nodes + graph_edges → SQLite
    - transcript chunks → ChromaDB embeddings (500-word chunks, same chunking as graph transcript_chunk nodes)
    - review JSON → meetings.ai_output_json (for backward compatibility)
```

### 4.2 Live Session (Incremental)

```
Every ~60 seconds of new transcript:
    ↓
Lightweight Pass 1 only:
    Extract entities from the new chunk
    Match against existing in-memory graph (reuse person/topic nodes)
    Add new nodes + edges
    ↓
Use growing graph for:
    - Participation tracking (person nodes + DISCUSSED edges)
    - Topic drift detection (compare recent topic nodes to agenda)
    - Context surfacing (query graph for related past decisions)

Session ends:
    ↓
Discard the ephemeral in-memory graph (it was for real-time features only)
Full 3-pass pipeline on complete transcript
    → builds authoritative graph from scratch
    → persist to SQLite + ChromaDB

Note: The incremental graph lives in-memory on the LiveSession instance.
It is ephemeral and will be lost on server restart — acceptable for MVP.
The full pipeline on session end produces the authoritative, persisted graph.
```

### 4.3 Extraction Prompts

**Pass 1 prompt (per chunk):**
```
You are extracting structured entities from a meeting transcript segment.

TRANSCRIPT SEGMENT:
{chunk}

Extract ALL of the following entity types. For each, provide the exact text
and approximate character position in this segment.

Return JSON:
{
  "entities": [
    {"type": "person", "content": "name", "start": 0, "end": 10},
    {"type": "topic", "content": "topic description", "start": 20, "end": 50},
    {"type": "decision", "content": "what was decided", "start": 100, "end": 200,
     "properties": {"confidence": "high", "decision_type": "emergent"}},
    {"type": "action_item", "content": "what was committed to", "start": 150, "end": 220,
     "properties": {"owner": "Alice", "deadline": "Friday", "confidence": "medium", "commitment_type": "volunteered"}},
    {"type": "risk", "content": "concern raised", "start": 300, "end": 350,
     "properties": {"severity": "medium", "raised_by": "Bob"}}
  ]
}
```

**Pass 2 prompt (per batch of ~30 entities):**
```
You are identifying relationships between entities extracted from a meeting.

ENTITIES (use ONLY these IDs in your response):
E1: [person] Alice
E2: [person] Bob
E3: [decision] Use lithium-polymer batteries for the prototype
E4: [action_item] Contact three battery suppliers by Friday
E5: [risk] Cold weather battery performance
E6: [topic] drone batteries
...

RELEVANT TRANSCRIPT CONTEXT:
{transcript chunk(s) where these entities appear}

Identify relationships. ONLY use the entity IDs listed above (E1, E2, etc.).

Relationship types:
- DECIDED: person → decision
- RATIFIED: person → decision
- OWNS: person → action_item
- RAISED: person → risk
- DISCUSSED: person → topic
- DEPENDS_ON: action_item → action_item
- RELATES_TO: any → any

Return JSON:
{
  "relationships": [
    {"source": "E1", "edge_type": "DECIDED", "target": "E3"},
    {"source": "E2", "edge_type": "OWNS", "target": "E4"},
    {"source": "E2", "edge_type": "RAISED", "target": "E5"},
    {"source": "E3", "edge_type": "RELATES_TO", "target": "E4"}
  ]
}

IMPORTANT: Use ONLY the entity IDs listed above. Do not invent new IDs.
```

**Pass 3 prompt:**
```
You are producing a structured meeting analysis from a knowledge graph.

KNOWLEDGE GRAPH:
Nodes:
{formatted nodes with types and properties}

Relationships:
{formatted edges}

Produce the meeting analysis following this schema:
{existing OUTPUT_SCHEMA from llm_client.py}

Use ONLY information present in the knowledge graph. Every item must trace
back to a graph node. Include source_quotes from the original transcript
where available.
```

---

## 4.4 Validation & Error Handling

Each pass is validated before proceeding to the next:

**After Pass 1:**
- Validate JSON structure matches expected entity format
- Filter out entities with empty `content` fields
- If zero entities extracted from a chunk, log warning and continue (chunk may be filler/silence)
- If ALL chunks produce zero entities, fall back to single-shot `analyze_transcript()` from existing `llm_client.py`

**After Pass 2:**
- Reject any edge referencing an entity ID that doesn't exist in the entity list
- Log rejected edges for debugging
- If zero valid edges, proceed with nodes only (unlinked graph is better than no graph)

**After Pass 3:**
- Validate output against `OUTPUT_SCHEMA` (same validation as current `_parse_json_response`)
- If validation fails, retry once with stricter prompt
- If retry fails, assemble a minimal review from the graph nodes directly (decisions from decision nodes, action items from action_item nodes, etc.) without LLM synthesis

**Fallback strategy:** If the pipeline fails entirely (LLM unavailable, all passes fail), fall back to the existing single-shot `analyze_transcript()` call. The user sees a result either way — the graph pipeline is an enhancement, not a hard requirement.

**Chunking consistency:** Both Pass 1 and ChromaDB embedding use the same 500-word overlapping chunks. The `transcript_chunk` graph nodes and ChromaDB documents reference the same text segments.

---

## 5. Chat/RAG Changes

### 5.1 Dual Retrieval

When the user asks a question, two retrieval paths run in parallel:

**Path 1: Graph Query**
- Text search `graph_nodes.content` for keyword matches
- If matches found, traverse edges to find connected nodes (1-2 hops)
- Returns a structured subgraph: "Decision D1 (by Alice) → RELATES_TO → Action A1 (owner: Bob) → DEPENDS_ON → Action A2"

**Path 2: Vector Search (ChromaDB)**
- Embed the question
- Search transcript chunk embeddings
- Returns original transcript passages

**Merge:** Deduplicate by meeting_id. Graph results provide structure, transcript chunks provide evidence. Both fed to LLM.

### 5.2 Updated Chat Prompt

```
Here is the relevant knowledge graph for this question:
{graph subgraph — nodes with types, edges with relationships}

Here are original transcript excerpts that may be relevant:
{transcript chunks from vector search}

Based on this information, answer the user's question.
Rules:
- Only use information from the provided graph and transcripts
- Cite specific meetings and people by name
- If you don't have enough information, say so
- Reference original quotes when available
```

### 5.3 Graph Query Implementation

```python
def query_graph(question: str, meeting_id: str = None) -> dict:
    """Search the knowledge graph for relevant nodes and their connections."""
    # 1. Keyword search in graph_nodes.content
    # 2. For each matching node, fetch edges (1-2 hops)
    # 3. Fetch connected nodes
    # 4. If meeting_id provided, boost nodes from that meeting
    # Return: {"nodes": [...], "edges": [...]}
```

This lives in `knowledge_graph.py` alongside the CRUD operations.

### 5.4 Merged Context Format

The `_build_rag_context()` method in `chat_session.py` returns a dict with two sections:

```python
{
    "graph_context": [
        {
            "type": "subgraph",
            "meeting_title": "Drone Battery Review",
            "meeting_id": "abc123",
            "description": "Decision: Use lithium-polymer batteries (by Alice) → RELATES_TO → Action: Contact suppliers (owner: Bob) → Risk: Cold weather performance (raised by Bob)",
        }
    ],
    "transcript_context": [
        {
            "meeting_title": "Drone Battery Review",
            "meeting_id": "abc123",
            "content": "Alice: I think the energy density trade-off is worth it...",
        }
    ]
}
```

The `_build_prompt()` method formats these as two separate sections in the LLM prompt:
1. "Knowledge Graph:" — structured relationships serialized as text
2. "Original Transcript Excerpts:" — raw transcript chunks

This two-section approach gives the LLM both structure (from the graph) and evidence (from the transcript).

---

## 6. Review Page Changes

### 6.1 Data Source

The review page adds a `GET /api/meetings/{id}/graph` call alongside the existing meeting data fetch. The graph provides relationship data that the flat JSON doesn't have.

### 6.2 Connection Chips

Each decision/action/risk card gets a "Connections" section at the bottom showing related graph edges as clickable chips:

```
Connections:
  [→ Action: A1 Contact suppliers (Bob)]  [→ Risk: R1 Cold weather]  [Topic: drone batteries]
```

Clicking a chip scrolls to that item's card on the same page (if it's in the same meeting) or opens the chat panel with that item as context (if it's from another meeting).

### 6.3 ConnectionChips Component

```typescript
interface ConnectionChipsProps {
    nodeId: string
    edges: Array<{
        edge_type: string
        target_node: { id: string; node_type: string; content: string }
    }>
    onChipClick: (nodeId: string) => void
}
```

Chips are color-coded by target node type:
- Decision → green
- Action item → blue
- Risk → red/amber
- Topic → purple
- Person → gray

### 6.4 Backward Compatibility

Old meetings (before the graph pipeline) still render from `ai_output_json`/`verified_output_json`. No connection chips shown. A "Reindex with Knowledge Graph" button on old meetings runs them through the new pipeline.

---

## 7. API Endpoints

### New Endpoints

```
GET /api/meetings/{meeting_id}/graph
    Returns: {"nodes": [...], "edges": [...]}
    Nodes include type, content, properties
    Edges include source_node_id, target_node_id, edge_type, weight

POST /api/meetings/{meeting_id}/reindex
    Re-runs the 3-pass extraction pipeline on an existing meeting
    Updates graph_nodes, graph_edges, ai_output_json
    Returns: {"status": "reindexed", "nodes_count": N, "edges_count": N}
```

### Modified Endpoints

```
POST /api/analyze
    Now runs 3-pass pipeline instead of single analyze_transcript() call
    Still returns the same response shape for backward compatibility

POST /api/approve
    Auto-indexes transcript chunks into ChromaDB (already does this)
    Graph was already built during analyze — no additional work needed
```

---

## 8. Files

### New Files
- `knowledge_graph.py` — graph CRUD on SQLite: create_node, create_edge, get_meeting_graph, query_graph, find_or_create_person, find_or_create_topic
- `extraction_pipeline.py` — 3-pass LLM extraction: extract_entities, extract_relationships, synthesize_review. Prompt templates. Chunk splitting. Entity deduplication.
- `routes/graph.py` — GET /api/meetings/{id}/graph, POST /api/meetings/{id}/reindex
- `frontend/src/components/review/ConnectionChips.tsx` — clickable relationship pills

### Modified Files
- `database.py` — add graph_nodes and graph_edges tables + indexes to init_db()
- `meeting_memory.py` — index_meeting() embeds transcript chunks into ChromaDB (keep existing behavior, graph is the primary structured store, ChromaDB handles vector search for transcript content)
- `routes/analyze.py` — analyze endpoint calls extraction_pipeline instead of single-shot analyze_transcript()
- `chat_session.py` — _build_rag_context() returns merged format with graph_context + transcript_context; _build_prompt() formats them as two sections
- `live_session.py` — incremental entity extraction during live sessions using lightweight Pass 1
- `frontend/src/components/review/ReviewView.tsx` — render ConnectionChips below each decision/action/risk card
- `frontend/src/components/meeting/MeetingDetail.tsx` — fetch graph data alongside meeting data, pass edges to ReviewView
- `frontend/src/lib/api.ts` — add getMeetingGraph() and reindexMeeting() methods

### Untouched
- `stt_engine.py` — no changes
- `idea_board.py` — no changes
- `transcript_parser.py` — no changes
- `embeddings.py` — no changes (still used for ChromaDB vector search)
- Chat panel UI, Dashboard, Header, PrepView — no changes
- `llm_client.py` — existing generate() function used by extraction_pipeline.py. No changes to the function itself, but extraction_pipeline.py has its own system prompts for each pass.

---

## 9. Migration / Backward Compatibility

- Old meetings keep their `ai_output_json` and render normally
- No graph data exists for old meetings — connection chips section simply doesn't appear
- "Reindex with Knowledge Graph" button on old meeting detail pages runs them through the new pipeline
- New meetings always go through the 3-pass pipeline
- The `ai_output_json` field is still written (Pass 3 output) for backward compatibility with any code that reads it directly
