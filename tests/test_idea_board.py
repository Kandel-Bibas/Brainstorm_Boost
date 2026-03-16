import pytest
from idea_board import IdeaBoard


@pytest.fixture
def board():
    return IdeaBoard(session_id="test-session")


def test_submit_idea(board):
    idea_id = board.submit_idea("Use solar panels on drones")
    assert idea_id is not None
    assert len(board.ideas) == 1
    assert board.ideas[0]["text"] == "Use solar panels on drones"


def test_submit_multiple(board):
    board.submit_idea("Solar panels")
    board.submit_idea("Wind power")
    board.submit_idea("Battery swap stations")
    assert len(board.ideas) == 3


def test_vote(board):
    idea_id = board.submit_idea("Solar panels")
    board.vote(idea_id, "token-1")
    assert board.ideas[0]["votes"] == 1

    board.vote(idea_id, "token-2")
    assert board.ideas[0]["votes"] == 2


def test_vote_once_per_token(board):
    idea_id = board.submit_idea("Solar panels")
    board.vote(idea_id, "token-1")
    board.vote(idea_id, "token-1")  # duplicate
    assert board.ideas[0]["votes"] == 1


def test_get_results(board):
    id1 = board.submit_idea("Solar panels")
    id2 = board.submit_idea("Wind power")
    board.vote(id2, "token-1")
    board.vote(id2, "token-2")
    board.vote(id1, "token-3")

    results = board.get_results()
    assert results[0]["text"] == "Wind power"  # More votes
    assert results[0]["votes"] == 2
    assert results[1]["text"] == "Solar panels"
    assert results[1]["votes"] == 1
