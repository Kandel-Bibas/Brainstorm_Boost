from __future__ import annotations

from uuid import uuid4


class IdeaBoard:
    """Anonymous idea submission and voting for live sessions."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.ideas: list[dict] = []
        self._votes: dict[str, set[str]] = {}  # idea_id -> set of voter tokens

    def submit_idea(self, text: str) -> str:
        idea_id = str(uuid4())
        self.ideas.append({
            "id": idea_id,
            "text": text.strip(),
            "votes": 0,
        })
        self._votes[idea_id] = set()
        return idea_id

    def vote(self, idea_id: str, voter_token: str) -> bool:
        if idea_id not in self._votes:
            return False
        if voter_token in self._votes[idea_id]:
            return False  # Already voted

        self._votes[idea_id].add(voter_token)
        for idea in self.ideas:
            if idea["id"] == idea_id:
                idea["votes"] += 1
                return True
        return False

    def get_results(self) -> list[dict]:
        return sorted(self.ideas, key=lambda x: x["votes"], reverse=True)
