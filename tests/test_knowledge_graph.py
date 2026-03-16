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
