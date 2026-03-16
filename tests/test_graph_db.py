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
