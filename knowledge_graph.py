"""Knowledge graph operations on top of SQLite graph tables."""
from __future__ import annotations

import hashlib
import json
import logging
import re

from database import (
    create_graph_node,
    create_graph_edge,
    get_node,
    get_meeting_graph,
    find_nodes_by_content,
    delete_meeting_graph,
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

    def add_meeting_entity(
        self,
        meeting_id: str,
        node_type: str,
        content: str,
        sequence: int,
        properties: dict | None = None,
        source_start: int | None = None,
        source_end: int | None = None,
    ) -> str:
        node_id = f"{meeting_id}:{node_type}:{sequence}"
        create_graph_node(node_id, meeting_id, node_type, content, properties,
                          source_start, source_end)
        return node_id

    def add_meeting_node(self, meeting_id: str, title: str) -> str:
        node_id = f"meeting:{meeting_id}"
        create_graph_node(node_id, meeting_id, "meeting", title)
        return node_id

    def add_transcript_chunk(
        self,
        meeting_id: str,
        index: int,
        content: str,
        source_start: int | None = None,
        source_end: int | None = None,
    ) -> str:
        node_id = f"{meeting_id}:chunk:{index}"
        create_graph_node(node_id, meeting_id, "transcript_chunk", content,
                          source_start=source_start, source_end=source_end)
        return node_id

    def add_edge(
        self,
        source_id: str,
        target_id: str,
        edge_type: str,
        meeting_id: str | None = None,
        weight: float = 1.0,
    ) -> str:
        return create_graph_edge(source_id, target_id, edge_type, meeting_id, weight)

    def get_meeting_subgraph(self, meeting_id: str) -> dict:
        return get_meeting_graph(meeting_id)

    def clear_meeting(self, meeting_id: str):
        delete_meeting_graph(meeting_id)

    def query(self, question: str, meeting_id: str | None = None, max_hops: int = 1) -> dict:
        """Search graph by keyword, then traverse edges for connected nodes."""
        # Keyword search: try the full question and each individual word.
        # For each word also try a stem (first 5+ chars) to handle plurals/inflections.
        seen_ids: set[str] = set()
        matching_nodes: list[dict] = []

        words = question.split()
        search_terms: list[str] = [question]
        for w in words:
            search_terms.append(w)
            # Simple stem: drop last 2 chars if word is long enough (handles -s, -es, -ies, -ed)
            if len(w) > 5:
                search_terms.append(w[:-2])

        for term in search_terms:
            for node in find_nodes_by_content(term, limit=10):
                if node["id"] not in seen_ids:
                    seen_ids.add(node["id"])
                    matching_nodes.append(node)

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
            lines.append(
                f"[{node['node_type'].upper()}] {node['content']}"
                + (f" ({prop_str})" if prop_str else "")
            )

        if subgraph["edges"]:
            lines.append("\nRelationships:")
            for edge in subgraph["edges"]:
                src = node_map.get(edge["source_node_id"], {})
                tgt = node_map.get(edge["target_node_id"], {})
                src_label = src.get("content", edge["source_node_id"])[:50]
                tgt_label = tgt.get("content", edge["target_node_id"])[:50]
                lines.append(f"  {src_label} --[{edge['edge_type']}]--> {tgt_label}")

        return "\n".join(lines)
