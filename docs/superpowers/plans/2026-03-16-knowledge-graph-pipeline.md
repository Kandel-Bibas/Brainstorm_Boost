# Knowledge Graph Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-shot LLM extraction with a 3-pass knowledge graph pipeline. Entities and relationships stored in SQLite graph tables. Transcript chunks embedded in ChromaDB. Chat uses dual retrieval (graph + vector). Review cards show relationship connections.

**Architecture:** New `knowledge_graph.py` handles graph CRUD on SQLite. New `extraction_pipeline.py` runs 3 focused LLM passes (entities → relationships → synthesis). `chat_session.py` merges graph traversal with vector search for dual retrieval. `ReviewView` renders connection chips from graph edges. Falls back to existing single-shot if pipeline fails.

**Tech Stack:** Same — Python, FastAPI, SQLite, ChromaDB, React/Tailwind/shadcn. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-16-knowledge-graph-pipeline-design.md`

---

## Chunk 1: Graph Storage Layer

### Task 1: Add Graph Tables to Database

**Files:**
- Modify: `database.py`
- Create: `tests/test_graph_db.py`

- [ ] **Step 1: Write tests**

`tests/test_graph_db.py`:
```python
import pytest
from database import (
    init_db, create_graph_node, create_graph_edge,
    get_meeting_graph, get_node, find_nodes_by_content,
    delete_meeting_graph,
)


def test_create_and_get_node():
    node_id = create_graph_node(
        node_id="meeting1:decision:1",
        meeting_id="meeting1",
        node_type="decision",
        content="Use lithium-polymer batteries",
        properties={"confidence": "high", "decision_type": "emergent"},
    )
    node = get_node(node_id)
    assert node is not None
    assert node["content"] == "Use lithium-polymer batteries"
    assert node["node_type"] == "decision"
    assert node["properties"]["confidence"] == "high"


def test_create_and_get_edge():
    create_graph_node("person:alice", None, "person", "Alice")
    create_graph_node("m1:decision:1", "m1", "decision", "Use lithium batteries")
    create_graph_edge(
        source_node_id="person:alice",
        target_node_id="m1:decision:1",
        edge_type="DECIDED",
        meeting_id="m1",
    )
    graph = get_meeting_graph("m1")
    assert len(graph["nodes"]) >= 1
    assert len(graph["edges"]) >= 1
    assert graph["edges"][0]["edge_type"] == "DECIDED"


def test_get_meeting_graph_includes_person_nodes():
    """Person nodes (meeting_id=NULL) should be included when they have edges in this meeting."""
    create_graph_node("person:bob", None, "person", "Bob")
    create_graph_node("m2:action:1", "m2", "action_item", "Research suppliers")
    create_graph_edge("person:bob", "m2:action:1", "OWNS", "m2")

    graph = get_meeting_graph("m2")
    node_ids = [n["id"] for n in graph["nodes"]]
    assert "person:bob" in node_ids
    assert "m2:action:1" in node_ids


def test_find_nodes_by_content():
    create_graph_node("m3:decision:1", "m3", "decision", "Use 5.8 GHz frequency band")
    create_graph_node("m3:risk:1", "m3", "risk", "Battery weight may exceed limits")

    results = find_nodes_by_content("frequency")
    assert len(results) >= 1
    assert any("5.8 GHz" in r["content"] for r in results)


def test_delete_meeting_graph():
    create_graph_node("m4:decision:1", "m4", "decision", "Some decision")
    create_graph_edge("m4:decision:1", "m4:decision:1", "RELATES_TO", "m4")

    delete_meeting_graph("m4")
    graph = get_meeting_graph("m4")
    assert len(graph["nodes"]) == 0
    assert len(graph["edges"]) == 0
```

- [ ] **Step 2: Run tests — should fail**

```bash
pytest tests/test_graph_db.py -v
```

- [ ] **Step 3: Add tables to init_db() and implement CRUD functions**

Add to `database.py` `init_db()`:
```sql
CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    meeting_id TEXT,
    node_type TEXT NOT NULL,
    content TEXT NOT NULL,
    properties_json TEXT,
    source_start INTEGER,
    source_end INTEGER,
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
    edge_type TEXT NOT NULL,
    meeting_id TEXT,
    weight REAL DEFAULT 1.0,
    properties_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (source_node_id) REFERENCES graph_nodes(id),
    FOREIGN KEY (target_node_id) REFERENCES graph_nodes(id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_meeting ON graph_edges(meeting_id);
```

Add functions:
```python
def create_graph_node(node_id: str, meeting_id: str | None, node_type: str,
                      content: str, properties: dict = None,
                      source_start: int = None, source_end: int = None) -> str:
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO graph_nodes (id, meeting_id, node_type, content, properties_json, source_start, source_end, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (node_id, meeting_id, node_type, content, json.dumps(properties) if properties else None,
             source_start, source_end, now),
        )
    return node_id


def get_node(node_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM graph_nodes WHERE id = ?", (node_id,)).fetchone()
    if row is None:
        return None
    d = dict(row)
    d["properties"] = json.loads(d.pop("properties_json")) if d.get("properties_json") else {}
    return d


def create_graph_edge(source_node_id: str, target_node_id: str, edge_type: str,
                      meeting_id: str = None, weight: float = 1.0, properties: dict = None) -> str:
    edge_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO graph_edges (id, source_node_id, target_node_id, edge_type, meeting_id, weight, properties_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (edge_id, source_node_id, target_node_id, edge_type, meeting_id, weight,
             json.dumps(properties) if properties else None, now),
        )
    return edge_id


def get_meeting_graph(meeting_id: str) -> dict:
    """Get all nodes and edges for a meeting, including cross-meeting person/topic nodes linked via edges."""
    with get_connection() as conn:
        # Get meeting-scoped nodes
        node_rows = conn.execute(
            "SELECT * FROM graph_nodes WHERE meeting_id = ?", (meeting_id,)
        ).fetchall()

        # Get edges for this meeting
        edge_rows = conn.execute(
            "SELECT * FROM graph_edges WHERE meeting_id = ?", (meeting_id,)
        ).fetchall()

        # Get cross-meeting nodes (persons, topics) referenced by these edges
        edge_node_ids = set()
        for e in edge_rows:
            edge_node_ids.add(e["source_node_id"])
            edge_node_ids.add(e["target_node_id"])

        meeting_node_ids = {r["id"] for r in node_rows}
        missing_ids = edge_node_ids - meeting_node_ids
        extra_nodes = []
        for nid in missing_ids:
            row = conn.execute("SELECT * FROM graph_nodes WHERE id = ?", (nid,)).fetchone()
            if row:
                extra_nodes.append(row)

    def parse_node(row):
        d = dict(row)
        d["properties"] = json.loads(d.pop("properties_json")) if d.get("properties_json") else {}
        return d

    def parse_edge(row):
        d = dict(row)
        d["properties"] = json.loads(d.pop("properties_json")) if d.get("properties_json") else {}
        return d

    return {
        "nodes": [parse_node(r) for r in node_rows] + [parse_node(r) for r in extra_nodes],
        "edges": [parse_edge(r) for r in edge_rows],
    }


def find_nodes_by_content(query: str, node_type: str = None, limit: int = 20) -> list[dict]:
    """Search graph nodes by content (LIKE match). For MVP — FTS is a future optimization."""
    with get_connection() as conn:
        sql = "SELECT * FROM graph_nodes WHERE content LIKE ?"
        params: list = [f"%{query}%"]
        if node_type:
            sql += " AND node_type = ?"
            params.append(node_type)
        sql += " LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()

    result = []
    for r in rows:
        d = dict(r)
        d["properties"] = json.loads(d.pop("properties_json")) if d.get("properties_json") else {}
        result.append(d)
    return result


def delete_meeting_graph(meeting_id: str):
    """Delete all graph nodes and edges for a meeting."""
    with get_connection() as conn:
        conn.execute("DELETE FROM graph_edges WHERE meeting_id = ?", (meeting_id,))
        conn.execute("DELETE FROM graph_nodes WHERE meeting_id = ?", (meeting_id,))
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_graph_db.py -v
```

- [ ] **Step 5: Run full suite**

```bash
pytest tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add database.py tests/test_graph_db.py
git commit -m "feat: add graph_nodes and graph_edges tables with CRUD"
```

---

### Task 2: Knowledge Graph Module

**Files:**
- Create: `knowledge_graph.py`
- Create: `tests/test_knowledge_graph.py`

- [ ] **Step 1: Write tests**

`tests/test_knowledge_graph.py`:
```python
import pytest
from knowledge_graph import KnowledgeGraph


@pytest.fixture
def kg():
    return KnowledgeGraph()


def test_find_or_create_person(kg):
    node_id = kg.find_or_create_person("Alice")
    assert node_id == "person:alice"

    # Same name returns same ID
    node_id2 = kg.find_or_create_person("alice")
    assert node_id2 == "person:alice"

    # Different name
    node_id3 = kg.find_or_create_person("Bob")
    assert node_id3 == "person:bob"


def test_find_or_create_topic(kg):
    node_id = kg.find_or_create_topic("drone batteries")
    assert node_id.startswith("topic:")

    # Same topic returns same ID
    node_id2 = kg.find_or_create_topic("drone batteries")
    assert node_id2 == node_id


def test_add_meeting_entity(kg):
    node_id = kg.add_meeting_entity(
        meeting_id="m1",
        node_type="decision",
        content="Use lithium batteries",
        sequence=1,
        properties={"confidence": "high"},
    )
    assert node_id == "m1:decision:1"


def test_add_edge(kg):
    kg.find_or_create_person("Alice")
    kg.add_meeting_entity("m1", "decision", "Use lithium", 1)
    edge_id = kg.add_edge("person:alice", "m1:decision:1", "DECIDED", "m1")
    assert edge_id is not None


def test_query_graph_keyword(kg):
    kg.add_meeting_entity("m1", "decision", "Use lithium-polymer batteries", 1)
    kg.add_meeting_entity("m1", "risk", "Cold weather performance", 1)

    results = kg.query("battery")
    assert len(results["nodes"]) >= 1
    assert any("lithium" in n["content"].lower() for n in results["nodes"])


def test_query_graph_with_traversal(kg):
    kg.find_or_create_person("Alice")
    kg.add_meeting_entity("m1", "decision", "Use lithium batteries", 1)
    kg.add_edge("person:alice", "m1:decision:1", "DECIDED", "m1")

    results = kg.query("lithium")
    # Should include the decision node AND Alice (1-hop traversal)
    node_contents = [n["content"] for n in results["nodes"]]
    assert any("lithium" in c.lower() for c in node_contents)


def test_get_meeting_subgraph(kg):
    kg.find_or_create_person("Alice")
    kg.add_meeting_entity("m1", "decision", "Use lithium batteries", 1)
    kg.add_meeting_entity("m1", "action_item", "Research suppliers", 1)
    kg.add_edge("person:alice", "m1:decision:1", "DECIDED", "m1")
    kg.add_edge("m1:decision:1", "m1:action_item:1", "RELATES_TO", "m1")

    graph = kg.get_meeting_subgraph("m1")
    assert len(graph["nodes"]) >= 3
    assert len(graph["edges"]) >= 2


def test_clear_meeting(kg):
    kg.add_meeting_entity("m1", "decision", "Something", 1)
    kg.clear_meeting("m1")
    graph = kg.get_meeting_subgraph("m1")
    assert len(graph["nodes"]) == 0
```

- [ ] **Step 2: Implement knowledge_graph.py**

```python
"""Knowledge graph operations on top of SQLite graph tables."""
from __future__ import annotations

import hashlib
import logging
import re

from database import (
    create_graph_node, create_graph_edge, get_node,
    get_meeting_graph, find_nodes_by_content, delete_meeting_graph,
    get_connection,
)

logger = logging.getLogger(__name__)


class KnowledgeGraph:
    """High-level graph operations: entity management, querying, traversal."""

    @staticmethod
    def _normalize_name(name: str) -> str:
        return re.sub(r"\s+", "_", name.strip().lower())

    def find_or_create_person(self, name: str) -> str:
        node_id = f"person:{self._normalize_name(name)}"
        existing = get_node(node_id)
        if existing:
            return node_id
        create_graph_node(node_id, None, "person", name.strip())
        return node_id

    def find_or_create_topic(self, topic: str) -> str:
        topic_hash = hashlib.sha256(topic.strip().lower().encode()).hexdigest()[:8]
        node_id = f"topic:{topic_hash}"
        existing = get_node(node_id)
        if existing:
            return node_id
        create_graph_node(node_id, None, "topic", topic.strip())
        return node_id

    def add_meeting_entity(self, meeting_id: str, node_type: str, content: str,
                           sequence: int, properties: dict = None,
                           source_start: int = None, source_end: int = None) -> str:
        node_id = f"{meeting_id}:{node_type}:{sequence}"
        create_graph_node(node_id, meeting_id, node_type, content, properties,
                          source_start, source_end)
        return node_id

    def add_meeting_node(self, meeting_id: str, title: str) -> str:
        node_id = f"meeting:{meeting_id}"
        create_graph_node(node_id, meeting_id, "meeting", title)
        return node_id

    def add_transcript_chunk(self, meeting_id: str, index: int, content: str,
                             source_start: int = None, source_end: int = None) -> str:
        node_id = f"{meeting_id}:chunk:{index}"
        create_graph_node(node_id, meeting_id, "transcript_chunk", content,
                          source_start=source_start, source_end=source_end)
        return node_id

    def add_edge(self, source_id: str, target_id: str, edge_type: str,
                 meeting_id: str = None, weight: float = 1.0) -> str:
        return create_graph_edge(source_id, target_id, edge_type, meeting_id, weight)

    def get_meeting_subgraph(self, meeting_id: str) -> dict:
        return get_meeting_graph(meeting_id)

    def clear_meeting(self, meeting_id: str):
        delete_meeting_graph(meeting_id)

    def query(self, question: str, meeting_id: str = None, max_hops: int = 1) -> dict:
        """Search graph by keyword, then traverse edges for connected nodes."""
        # Keyword search for matching nodes
        matching_nodes = find_nodes_by_content(question, limit=10)

        if meeting_id:
            # Boost nodes from the context meeting
            matching_nodes.sort(key=lambda n: (n.get("meeting_id") != meeting_id, n["id"]))

        # Traverse edges (1-hop) to find connected nodes
        all_node_ids = {n["id"] for n in matching_nodes}
        connected_edges = []

        with get_connection() as conn:
            for node in matching_nodes:
                rows = conn.execute(
                    "SELECT * FROM graph_edges WHERE source_node_id = ? OR target_node_id = ?",
                    (node["id"], node["id"]),
                ).fetchall()
                for r in rows:
                    edge = dict(r)
                    edge["properties"] = {}
                    connected_edges.append(edge)
                    all_node_ids.add(r["source_node_id"])
                    all_node_ids.add(r["target_node_id"])

            # Fetch any nodes we don't have yet
            extra_nodes = []
            existing_ids = {n["id"] for n in matching_nodes}
            for nid in all_node_ids - existing_ids:
                row = conn.execute("SELECT * FROM graph_nodes WHERE id = ?", (nid,)).fetchone()
                if row:
                    d = dict(row)
                    import json
                    d["properties"] = json.loads(d.pop("properties_json")) if d.get("properties_json") else {}
                    extra_nodes.append(d)

        return {
            "nodes": matching_nodes + extra_nodes,
            "edges": connected_edges,
        }

    def serialize_subgraph_for_prompt(self, subgraph: dict) -> str:
        """Convert a subgraph to human-readable text for LLM prompts."""
        lines = []
        node_map = {n["id"]: n for n in subgraph["nodes"]}

        for node in subgraph["nodes"]:
            if node["node_type"] == "transcript_chunk":
                continue  # Don't clutter the prompt with raw chunks
            props = node.get("properties", {})
            prop_str = ", ".join(f"{k}: {v}" for k, v in props.items() if v) if props else ""
            lines.append(f"[{node['node_type'].upper()}] {node['content']}" + (f" ({prop_str})" if prop_str else ""))

        if subgraph["edges"]:
            lines.append("\nRelationships:")
            for edge in subgraph["edges"]:
                src = node_map.get(edge["source_node_id"], {})
                tgt = node_map.get(edge["target_node_id"], {})
                src_label = src.get("content", edge["source_node_id"])[:50]
                tgt_label = tgt.get("content", edge["target_node_id"])[:50]
                lines.append(f"  {src_label} --[{edge['edge_type']}]--> {tgt_label}")

        return "\n".join(lines)
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_knowledge_graph.py -v
```

- [ ] **Step 4: Commit**

```bash
git add knowledge_graph.py tests/test_knowledge_graph.py
git commit -m "feat: add KnowledgeGraph module with entity management and graph queries"
```

---

## Chunk 2: Extraction Pipeline

### Task 3: Extraction Pipeline

**Files:**
- Create: `extraction_pipeline.py`
- Create: `tests/test_extraction_pipeline.py`

- [ ] **Step 1: Write tests for chunking and entity parsing (no LLM needed)**

`tests/test_extraction_pipeline.py`:
```python
import pytest
from extraction_pipeline import (
    chunk_transcript, parse_entity_response, parse_relationship_response,
    assign_entity_ids, validate_edges,
)


def test_chunk_transcript_short():
    text = "Hello world this is a short transcript"
    chunks = chunk_transcript(text, chunk_size=100, overlap=20)
    assert len(chunks) == 1
    assert chunks[0]["text"] == text


def test_chunk_transcript_long():
    words = ["word"] * 200
    text = " ".join(words)
    chunks = chunk_transcript(text, chunk_size=50, overlap=10)
    assert len(chunks) > 1
    # Chunks should overlap
    assert chunks[0]["end"] > chunks[1]["start"] or len(chunks) == 1


def test_parse_entity_response_valid():
    response = {
        "entities": [
            {"type": "person", "content": "Alice", "start": 0, "end": 5},
            {"type": "decision", "content": "Use lithium", "start": 20, "end": 40,
             "properties": {"confidence": "high"}},
        ]
    }
    entities = parse_entity_response(response)
    assert len(entities) == 2
    assert entities[0]["type"] == "person"
    assert entities[1]["properties"]["confidence"] == "high"


def test_parse_entity_response_filters_empty():
    response = {
        "entities": [
            {"type": "person", "content": "", "start": 0, "end": 0},
            {"type": "decision", "content": "Valid decision", "start": 10, "end": 30},
        ]
    }
    entities = parse_entity_response(response)
    assert len(entities) == 1


def test_assign_entity_ids():
    entities = [
        {"type": "person", "content": "Alice"},
        {"type": "decision", "content": "Use lithium"},
        {"type": "person", "content": "Bob"},
    ]
    labeled = assign_entity_ids(entities)
    assert labeled[0]["short_id"] == "E1"
    assert labeled[1]["short_id"] == "E2"
    assert labeled[2]["short_id"] == "E3"


def test_parse_relationship_response():
    response = {
        "relationships": [
            {"source": "E1", "edge_type": "DECIDED", "target": "E2"},
            {"source": "E3", "edge_type": "OWNS", "target": "E4"},
        ]
    }
    edges = parse_relationship_response(response)
    assert len(edges) == 2
    assert edges[0]["source"] == "E1"
    assert edges[0]["edge_type"] == "DECIDED"


def test_validate_edges_filters_invalid():
    valid_ids = {"E1", "E2", "E3"}
    edges = [
        {"source": "E1", "edge_type": "DECIDED", "target": "E2"},
        {"source": "E1", "edge_type": "OWNS", "target": "E99"},  # E99 doesn't exist
        {"source": "E5", "edge_type": "RAISED", "target": "E2"},  # E5 doesn't exist
    ]
    valid = validate_edges(edges, valid_ids)
    assert len(valid) == 1
    assert valid[0]["target"] == "E2"
```

- [ ] **Step 2: Implement extraction_pipeline.py**

```python
"""3-pass LLM extraction pipeline for building knowledge graphs from meeting transcripts."""
from __future__ import annotations

import json
import logging
from typing import Any

from knowledge_graph import KnowledgeGraph
from llm_client import generate, analyze_transcript

logger = logging.getLogger(__name__)

# --- Prompts ---

ENTITY_SYSTEM_PROMPT = """You are an entity extraction system. You identify people, topics, decisions, action items, and risks from meeting transcripts. Return structured JSON only."""

RELATIONSHIP_SYSTEM_PROMPT = """You are a relationship extraction system. Given a list of numbered entities from a meeting, you identify how they are connected. Return structured JSON only."""

SYNTHESIS_SYSTEM_PROMPT = """You are a meeting analyst. Given a structured knowledge graph of a meeting, you produce a comprehensive meeting analysis. Return structured JSON only."""

ENTITY_PROMPT_TEMPLATE = """Extract ALL entities from this meeting transcript segment.

TRANSCRIPT SEGMENT:
{chunk}

Entity types to extract:
- person: participant names
- topic: subjects being discussed
- decision: things that were decided (explicit or emergent)
- action_item: tasks someone committed to do (include owner, deadline if mentioned)
- risk: concerns, blockers, potential problems raised

Return JSON (no markdown fencing):
{{"entities": [
  {{"type": "person", "content": "name"}},
  {{"type": "topic", "content": "topic description"}},
  {{"type": "decision", "content": "what was decided", "properties": {{"confidence": "high|medium|low"}}}},
  {{"type": "action_item", "content": "task description", "properties": {{"owner": "name", "deadline": "when", "confidence": "high|medium|low"}}}},
  {{"type": "risk", "content": "concern description", "properties": {{"severity": "high|medium|low", "raised_by": "name"}}}}
]}}"""

RELATIONSHIP_PROMPT_TEMPLATE = """Identify relationships between these numbered entities from a meeting.

ENTITIES (use ONLY these IDs):
{entity_list}

TRANSCRIPT CONTEXT:
{context}

Relationship types:
- DECIDED: person → decision
- RATIFIED: person → decision (confirmed/agreed)
- OWNS: person → action_item
- RAISED: person → risk
- DISCUSSED: person → topic
- DEPENDS_ON: action_item → action_item
- RELATES_TO: any → any (general connection)

Return JSON (no markdown fencing):
{{"relationships": [
  {{"source": "E1", "edge_type": "DECIDED", "target": "E3"}}
]}}

IMPORTANT: Use ONLY the entity IDs listed above. Do not invent new IDs."""

SYNTHESIS_PROMPT_TEMPLATE = """Produce a structured meeting analysis from this knowledge graph.

KNOWLEDGE GRAPH:
{graph_text}

Return JSON matching this schema (no markdown fencing):
{schema}

Use ONLY information present in the knowledge graph. Every item must trace back to a graph node."""


# --- Chunking ---

def chunk_transcript(text: str, chunk_size: int = 500, overlap: int = 100) -> list[dict]:
    """Split transcript into overlapping chunks by word count. Returns list of {{text, start, end}}."""
    words = text.split()
    if len(words) <= chunk_size:
        return [{"text": text, "start": 0, "end": len(text)}]

    chunks = []
    word_start = 0
    char_pos = 0

    while word_start < len(words):
        word_end = min(word_start + chunk_size, len(words))
        chunk_text = " ".join(words[word_start:word_end])

        # Approximate character positions
        start_char = text.find(words[word_start], char_pos) if word_start < len(words) else len(text)
        end_char = start_char + len(chunk_text)

        chunks.append({"text": chunk_text, "start": start_char, "end": end_char})

        char_pos = start_char
        word_start += chunk_size - overlap

    return chunks


# --- Response Parsing ---

def parse_entity_response(response: dict) -> list[dict]:
    """Parse and validate entity extraction response."""
    entities = response.get("entities", [])
    return [e for e in entities if e.get("content", "").strip()]


def assign_entity_ids(entities: list[dict]) -> list[dict]:
    """Assign stable short IDs (E1, E2, ...) to entities."""
    for i, e in enumerate(entities):
        e["short_id"] = f"E{i + 1}"
    return entities


def parse_relationship_response(response: dict) -> list[dict]:
    """Parse relationship extraction response."""
    return response.get("relationships", [])


def validate_edges(edges: list[dict], valid_ids: set[str]) -> list[dict]:
    """Filter out edges referencing non-existent entity IDs."""
    valid = []
    for edge in edges:
        if edge.get("source") in valid_ids and edge.get("target") in valid_ids:
            valid.append(edge)
        else:
            logger.warning("Rejected edge with invalid IDs: %s -> %s", edge.get("source"), edge.get("target"))
    return valid


def _format_entity_list(entities: list[dict]) -> str:
    """Format entities as a numbered list for the relationship prompt."""
    lines = []
    for e in entities:
        props = e.get("properties", {})
        prop_str = f" ({', '.join(f'{k}: {v}' for k, v in props.items())})" if props else ""
        lines.append(f"{e['short_id']}: [{e['type']}] {e['content']}{prop_str}")
    return "\n".join(lines)


# --- Pipeline ---

def run_extraction_pipeline(
    meeting_id: str,
    raw_transcript: str,
    provider: str = None,
    output_schema: str = None,
) -> dict:
    """Run the full 3-pass extraction pipeline.

    Returns the review JSON (same shape as ai_output_json) and populates
    the knowledge graph in SQLite.

    Falls back to single-shot analyze_transcript() if the pipeline fails.
    """
    from llm_client import OUTPUT_SCHEMA
    if output_schema is None:
        output_schema = OUTPUT_SCHEMA

    kg = KnowledgeGraph()

    # Clear any existing graph for this meeting (reindex case)
    kg.clear_meeting(meeting_id)

    try:
        # --- Pass 1: Entity Extraction ---
        logger.info("Pass 1: Extracting entities from meeting %s", meeting_id)
        chunks = chunk_transcript(raw_transcript)
        all_entities: list[dict] = []

        for chunk in chunks:
            prompt = ENTITY_PROMPT_TEMPLATE.format(chunk=chunk["text"])
            try:
                response = generate(prompt, provider=provider, system_prompt=ENTITY_SYSTEM_PROMPT)
                entities = parse_entity_response(response)
                # Attach chunk offset info
                for e in entities:
                    e["chunk_start"] = chunk["start"]
                    e["chunk_end"] = chunk["end"]
                all_entities.extend(entities)
            except Exception:
                logger.exception("Pass 1 failed for chunk at position %d", chunk["start"])
                continue

        if not all_entities:
            logger.warning("Pass 1 produced zero entities, falling back to single-shot")
            return _fallback_single_shot(raw_transcript, provider)

        # Deduplicate persons and topics
        all_entities = _deduplicate_entities(all_entities)
        all_entities = assign_entity_ids(all_entities)

        # Store entities in graph
        entity_id_map = {}  # short_id -> graph node_id
        counters: dict[str, int] = {}

        for e in all_entities:
            etype = e["type"]
            if etype == "person":
                node_id = kg.find_or_create_person(e["content"])
            elif etype == "topic":
                node_id = kg.find_or_create_topic(e["content"])
            else:
                counters[etype] = counters.get(etype, 0) + 1
                node_id = kg.add_meeting_entity(
                    meeting_id, etype, e["content"], counters[etype],
                    properties=e.get("properties"),
                    source_start=e.get("chunk_start"),
                    source_end=e.get("chunk_end"),
                )
            entity_id_map[e["short_id"]] = node_id

        # Store transcript chunks
        for i, chunk in enumerate(chunks):
            kg.add_transcript_chunk(meeting_id, i, chunk["text"],
                                    source_start=chunk["start"], source_end=chunk["end"])

        # --- Pass 2: Relationship Extraction ---
        logger.info("Pass 2: Extracting relationships for meeting %s", meeting_id)
        valid_short_ids = {e["short_id"] for e in all_entities}

        # Batch entities into groups of ~30
        batch_size = 30
        all_edges: list[dict] = []
        for batch_start in range(0, len(all_entities), batch_size):
            batch = all_entities[batch_start:batch_start + batch_size]
            entity_list = _format_entity_list(batch)

            # Use relevant transcript context for this batch
            context = raw_transcript[:3000]  # First 3000 chars as context

            prompt = RELATIONSHIP_PROMPT_TEMPLATE.format(
                entity_list=entity_list, context=context
            )
            try:
                response = generate(prompt, provider=provider, system_prompt=RELATIONSHIP_SYSTEM_PROMPT)
                edges = parse_relationship_response(response)
                edges = validate_edges(edges, valid_short_ids)
                all_edges.extend(edges)
            except Exception:
                logger.exception("Pass 2 failed for entity batch starting at %d", batch_start)
                continue

        # Store edges in graph
        for edge in all_edges:
            src_graph_id = entity_id_map.get(edge["source"])
            tgt_graph_id = entity_id_map.get(edge["target"])
            if src_graph_id and tgt_graph_id:
                kg.add_edge(src_graph_id, tgt_graph_id, edge["edge_type"], meeting_id)

        # --- Pass 3: Review Synthesis ---
        logger.info("Pass 3: Synthesizing review for meeting %s", meeting_id)
        subgraph = kg.get_meeting_subgraph(meeting_id)
        graph_text = kg.serialize_subgraph_for_prompt(subgraph)

        prompt = SYNTHESIS_PROMPT_TEMPLATE.format(graph_text=graph_text, schema=output_schema)
        try:
            review_output = generate(prompt, provider=provider, system_prompt=SYNTHESIS_SYSTEM_PROMPT)
        except Exception:
            logger.exception("Pass 3 failed, assembling minimal review from graph")
            review_output = _assemble_review_from_graph(subgraph)

        logger.info("Pipeline complete for meeting %s: %d nodes, %d edges",
                     meeting_id, len(subgraph["nodes"]), len(subgraph["edges"]))
        return review_output

    except Exception:
        logger.exception("Pipeline failed entirely for meeting %s, falling back to single-shot", meeting_id)
        return _fallback_single_shot(raw_transcript, provider)


def _deduplicate_entities(entities: list[dict]) -> list[dict]:
    """Deduplicate by type + normalized content."""
    seen = set()
    unique = []
    for e in entities:
        key = (e["type"], e["content"].strip().lower())
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return unique


def _fallback_single_shot(raw_transcript: str, provider: str = None) -> dict:
    """Fall back to the existing single-shot analyze_transcript."""
    from transcript_parser import parse_transcript
    utterances = parse_transcript(raw_transcript)
    return analyze_transcript(utterances, provider=provider)


def _assemble_review_from_graph(subgraph: dict) -> dict:
    """Build a minimal review JSON directly from graph nodes when Pass 3 fails."""
    decisions = []
    action_items = []
    risks = []
    participants = []

    for node in subgraph["nodes"]:
        props = node.get("properties", {})
        if node["node_type"] == "decision":
            decisions.append({
                "id": f"D{len(decisions) + 1}",
                "description": node["content"],
                "decision_type": props.get("decision_type", "emergent"),
                "made_by": props.get("made_by", "Unknown"),
                "confidence": props.get("confidence", "medium"),
                "confidence_rationale": "Assembled from knowledge graph",
                "source_quote": "",
            })
        elif node["node_type"] == "action_item":
            action_items.append({
                "id": f"A{len(action_items) + 1}",
                "task": node["content"],
                "owner": props.get("owner", "Unassigned"),
                "deadline": props.get("deadline"),
                "commitment_type": props.get("commitment_type", "unknown"),
                "confidence": props.get("confidence", "medium"),
                "confidence_rationale": "Assembled from knowledge graph",
                "source_quote": "",
            })
        elif node["node_type"] == "risk":
            risks.append({
                "id": f"R{len(risks) + 1}",
                "description": node["content"],
                "raised_by": props.get("raised_by", "Unknown"),
                "severity": props.get("severity", "medium"),
                "source_quote": "",
            })
        elif node["node_type"] == "person":
            participants.append(node["content"])

    return {
        "meeting_metadata": {
            "title": "Meeting Analysis",
            "date_mentioned": None,
            "participants": participants,
            "duration_estimate": None,
        },
        "decisions": decisions,
        "action_items": action_items,
        "open_risks": risks,
        "state_of_direction": "",
        "trust_flags": ["Analysis assembled from knowledge graph (Pass 3 synthesis failed)"],
    }
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_extraction_pipeline.py -v
```

- [ ] **Step 4: Run full suite**

```bash
pytest tests/ -v
```

- [ ] **Step 5: Commit**

```bash
git add extraction_pipeline.py tests/test_extraction_pipeline.py
git commit -m "feat: add 3-pass extraction pipeline with entity, relationship, and synthesis passes"
```

---

## Chunk 3: Integration (Backend + Frontend)

### Task 4: Wire Pipeline into Analyze Endpoint + Graph API

**Files:**
- Modify: `routes/analyze.py`
- Create: `routes/graph.py`
- Modify: `main.py`

- [ ] **Step 1: Update analyze endpoint to use pipeline**

In `routes/analyze.py`, replace the `analyze()` function's LLM call. Read the file first.

After `utterances = meeting["utterances_json"]` validation, replace:
```python
    try:
        ai_output = analyze_transcript(utterances, provider=provider)
    except ...
```

With:
```python
    raw_transcript = meeting.get("raw_transcript", "")

    try:
        from extraction_pipeline import run_extraction_pipeline
        ai_output = run_extraction_pipeline(meeting_id, raw_transcript, provider=provider)
    except Exception as e:
        # Pipeline failed — fall back to single-shot
        logger.warning("Extraction pipeline failed, falling back to single-shot: %s", e)
        try:
            ai_output = analyze_transcript(utterances, provider=provider)
        except ...  # keep existing error handling
```

- [ ] **Step 2: Create routes/graph.py**

```python
from fastapi import APIRouter, HTTPException

from database import get_meeting, get_meeting_graph
from knowledge_graph import KnowledgeGraph

router = APIRouter(prefix="/api", tags=["graph"])


@router.get("/meetings/{meeting_id}/graph")
async def meeting_graph(meeting_id: str):
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    graph = get_meeting_graph(meeting_id)
    return graph


@router.post("/meetings/{meeting_id}/reindex")
async def reindex_meeting(meeting_id: str, provider: str = None):
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    raw_transcript = meeting.get("raw_transcript", "")
    if not raw_transcript:
        raise HTTPException(status_code=400, detail="Meeting has no transcript to reindex")

    from extraction_pipeline import run_extraction_pipeline
    from database import update_ai_output

    try:
        ai_output = run_extraction_pipeline(meeting_id, raw_transcript, provider=provider)
        update_ai_output(meeting_id, ai_output)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Reindex failed: {e}")

    graph = get_meeting_graph(meeting_id)
    return {
        "status": "reindexed",
        "nodes_count": len(graph["nodes"]),
        "edges_count": len(graph["edges"]),
    }
```

- [ ] **Step 3: Register in main.py**

```python
from routes import upload, analyze, meetings, query, prep, live, chat, graph
app.include_router(graph.router)
```

- [ ] **Step 4: Run full tests**

```bash
pytest tests/ -v
```

- [ ] **Step 5: Commit**

```bash
git add routes/analyze.py routes/graph.py main.py
git commit -m "feat: wire extraction pipeline into analyze endpoint, add graph API"
```

---

### Task 5: Update Chat to Use Dual Retrieval

**Files:**
- Modify: `chat_session.py`

- [ ] **Step 1: Read chat_session.py, then update _build_rag_context**

Replace the existing `_build_rag_context` method to merge graph query + vector search:

```python
def _build_rag_context(self, query: str, memory, context_meeting_id: str = None) -> dict:
    """Dual retrieval: graph traversal + vector search, merged."""
    from knowledge_graph import KnowledgeGraph

    # Path 1: Graph query
    kg = KnowledgeGraph()
    graph_results = kg.query(query, meeting_id=context_meeting_id)
    graph_text = kg.serialize_subgraph_for_prompt(graph_results) if graph_results["nodes"] else ""

    # Path 2: Vector search (existing ChromaDB)
    transcript_chunks = []
    try:
        if context_meeting_id:
            all_results = memory.query(query, top_k=6)
            scoped = [r for r in all_results if r.get("meeting_id") == context_meeting_id][:3]
            global_results = [r for r in all_results if r.get("meeting_id") != context_meeting_id][:3]
            transcript_chunks = scoped + global_results
        else:
            transcript_chunks = memory.query(query, top_k=5)
    except Exception:
        pass

    return {
        "graph_context": graph_text,
        "transcript_context": transcript_chunks,
    }
```

Update `_build_prompt` to use the new format:

```python
def _build_prompt(self, message: str, history: list, rag_context: dict) -> str:
    # Conversation history
    conv = "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in history[:-1]
    ) if len(history) > 1 else ""

    # Graph context
    graph_section = ""
    if rag_context.get("graph_context"):
        graph_section = f"\n\nKnowledge Graph:\n{rag_context['graph_context']}"

    # Transcript context
    transcript_section = ""
    if rag_context.get("transcript_context"):
        transcript_section = "\n\nOriginal Transcript Excerpts:\n" + "\n".join(
            f"- [{item['meeting_title']}] {item['content']}"
            for item in rag_context["transcript_context"]
        )

    return f"""Previous conversation:
{conv}
{graph_section}
{transcript_section}

Current question: {message}

Return a JSON object:
{{"answer": "your response citing specific meetings where relevant", "sources": ["meeting title 1"]}}

IMPORTANT: Only use information from the provided knowledge graph and transcripts. If you don't have enough information, say so."""
```

Also update `send_message` to extract sources from graph_context too (not just vector results).

- [ ] **Step 2: Run tests**

```bash
pytest tests/ -v
```

- [ ] **Step 3: Commit**

```bash
git add chat_session.py
git commit -m "feat: update chat to use dual retrieval (graph + vector search)"
```

---

### Task 6: Frontend — Connection Chips + Graph API

**Files:**
- Create: `frontend/src/components/review/ConnectionChips.tsx`
- Modify: `frontend/src/components/review/ReviewView.tsx`
- Modify: `frontend/src/components/meeting/MeetingDetail.tsx`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add graph API methods to api.ts**

```typescript
async getMeetingGraph(meetingId: string) {
    const res = await fetch(`${BASE}/api/meetings/${meetingId}/graph`);
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json() as Promise<{
        nodes: Array<{ id: string; node_type: string; content: string; meeting_id: string; properties: Record<string, any> }>;
        edges: Array<{ source_node_id: string; target_node_id: string; edge_type: string; meeting_id: string }>;
    }>;
},

async reindexMeeting(meetingId: string) {
    const res = await fetch(`${BASE}/api/meetings/${meetingId}/reindex`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
},
```

- [ ] **Step 2: Create ConnectionChips.tsx**

```typescript
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Edge {
    source_node_id: string
    target_node_id: string
    edge_type: string
}

interface Node {
    id: string
    node_type: string
    content: string
}

interface ConnectionChipsProps {
    nodeId: string
    edges: Edge[]
    nodeMap: Map<string, Node>
    onChipClick?: (nodeId: string) => void
}

const typeColors: Record<string, string> = {
    decision: 'bg-chart-3/10 text-chart-3 border-chart-3/20',
    action_item: 'bg-primary/10 text-primary border-primary/20',
    risk: 'bg-chart-5/10 text-chart-5 border-chart-5/20',
    topic: 'bg-chart-2/10 text-chart-2 border-chart-2/20',
    person: 'bg-secondary text-secondary-foreground border-border/50',
}

const edgeLabels: Record<string, string> = {
    DECIDED: 'decided',
    RATIFIED: 'ratified',
    OWNS: 'owns',
    RAISED: 'raised',
    DISCUSSED: 'discusses',
    DEPENDS_ON: 'depends on',
    RELATES_TO: 'related',
    ATTENDED: 'attended',
    MENTIONED_IN: 'mentioned in',
}

export function ConnectionChips({ nodeId, edges, nodeMap, onChipClick }: ConnectionChipsProps) {
    // Find edges connected to this node
    const connected = edges.filter(e => e.source_node_id === nodeId || e.target_node_id === nodeId)

    if (connected.length === 0) return null

    return (
        <div className="flex flex-wrap gap-1.5 pt-2">
            {connected.map((edge, i) => {
                const otherId = edge.source_node_id === nodeId ? edge.target_node_id : edge.source_node_id
                const otherNode = nodeMap.get(otherId)
                if (!otherNode || otherNode.node_type === 'transcript_chunk' || otherNode.node_type === 'meeting') return null

                const label = edgeLabels[edge.edge_type] || edge.edge_type
                const truncated = otherNode.content.length > 40
                    ? otherNode.content.substring(0, 40) + '...'
                    : otherNode.content

                return (
                    <button
                        key={i}
                        onClick={() => onChipClick?.(otherId)}
                        className={cn(
                            'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs transition-colors hover:opacity-80',
                            typeColors[otherNode.node_type] || typeColors.person
                        )}
                    >
                        <span className="font-medium">{label}:</span>
                        <span>{truncated}</span>
                    </button>
                )
            })}
        </div>
    )
}
```

- [ ] **Step 3: Update ReviewView to accept and render graph edges**

Add an optional `graphData` prop to ReviewView:
```typescript
interface ReviewViewProps {
    meetingId: string
    aiOutput: AiOutput
    onApprove?: (exports: { md?: string; json?: string }) => void
    graphData?: { nodes: any[]; edges: any[] }
}
```

In each decision/action/risk card, after the SourceQuote, render ConnectionChips if graphData is available. Match review items to graph nodes by content similarity or ID pattern.

- [ ] **Step 4: Update MeetingDetail to fetch graph data**

In `MeetingDetail.tsx`, after fetching the meeting, also fetch the graph:
```typescript
const graphData = await api.getMeetingGraph(meetingId)
```

Pass it to ReviewView as `graphData={graphData}`.

Add a "Reindex" button for meetings that don't have graph data (old meetings).

- [ ] **Step 5: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 6: Run all tests**

```bash
pytest tests/ -v
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ routes/graph.py
git commit -m "feat: add connection chips to review cards, graph API integration"
```
