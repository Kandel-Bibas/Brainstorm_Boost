import pytest
from live_session import LiveSession


@pytest.fixture
def session():
    return LiveSession(
        agenda="Discuss drone battery options and frequency allocation",
        participants=["Alice", "Bob", "Charlie"],
    )


def test_session_creation(session):
    assert session.session_id is not None
    assert len(session.join_code) == 6
    assert session.join_code.isalnum()
    assert session.agenda_embedding is not None
    assert len(session.transcript) == 0


def test_add_utterance(session):
    session.add_utterance("Alice", "Hello everyone, let's get started")
    assert len(session.transcript) == 1
    assert session.transcript[0]["speaker"] == "Alice"


def test_participation_stats(session):
    session.add_utterance("Alice", "Hello everyone let's get started with the meeting")
    session.add_utterance("Bob", "Sounds good")
    session.add_utterance("Alice", "First topic is drone batteries and their performance")

    stats = session.get_participation_stats()
    assert "Alice" in stats
    assert "Bob" in stats
    assert stats["Alice"]["word_count"] > stats["Bob"]["word_count"]
    assert stats["Alice"]["percentage"] > stats["Bob"]["percentage"]


def test_participation_alerts(session):
    # Alice dominates, Charlie silent
    for _ in range(10):
        session.add_utterance("Alice", "I think we should do this and that and more things")
    session.add_utterance("Bob", "OK")

    alerts = session.get_participation_alerts()
    # Should flag Alice as dominant and Charlie as silent
    alert_messages = [a["message"] for a in alerts]
    assert any("Alice" in m for m in alert_messages)
    assert any("Charlie" in m for m in alert_messages)


def test_topic_drift_on_topic(session):
    session.add_utterance("Alice", "Let's discuss the drone battery options we have")
    session.add_utterance("Bob", "I think lithium polymer is the best frequency for our drones")

    drift = session.check_topic_drift()
    assert "similarity" in drift
    assert "drifted" in drift
    assert drift["similarity"] > 0.2  # Should be somewhat related


def test_topic_drift_off_topic(session):
    # Talk about completely unrelated topic
    for _ in range(5):
        session.add_utterance("Alice", "What should we have for lunch today pizza or sandwiches")

    drift = session.check_topic_drift()
    # Lower similarity expected for off-topic
    assert drift["similarity"] < 0.5


def test_compile_transcript(session):
    session.add_utterance("Alice", "Hello")
    session.add_utterance("Bob", "Hi there")
    session.add_utterance("Alice", "Let's begin")

    raw, utterances = session.compile_transcript()
    assert "Alice" in raw
    assert "Bob" in raw
    assert len(utterances) == 3
    assert utterances[0]["format_detected"] == "live"
