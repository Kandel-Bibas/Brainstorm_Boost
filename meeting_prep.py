"""Meeting Prep Engine — pre-meeting intelligence functions."""
from __future__ import annotations

import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

from database import get_open_action_items, get_speaker_profiles
from meeting_memory import MeetingMemory
from llm_client import generate


def get_open_items_for_prep(participants: list[str] | None = None) -> list[dict]:
    """Return open action items, optionally filtered by participant list. Deduplicates by id."""
    if participants is None:
        raw = get_open_action_items()
    else:
        seen_ids: set[str] = set()
        raw = []
        for participant in participants:
            for item in get_open_action_items(participant=participant):
                if item["id"] not in seen_ids:
                    seen_ids.add(item["id"])
                    raw.append(item)

    # Deduplicate by id (safety guard for single-participant path)
    seen: set[str] = set()
    result = []
    for item in raw:
        if item["id"] not in seen:
            seen.add(item["id"])
            result.append(item)
    return result


def get_related_context(agenda: str, memory: MeetingMemory, top_k: int = 5) -> list[dict]:
    """Vector search past meetings via ChromaDB for topics in the agenda."""
    return memory.query(agenda, top_k=top_k)


def recommend_participants(agenda: str, memory: MeetingMemory) -> list[dict]:
    """Search speaker_profiles for expertise matching agenda topics.

    Cross-references with ChromaDB results to find who has relevant past contributions.
    Returns profiles sorted by past_contributions (meeting_count) descending.
    """
    # Get context from ChromaDB to find speakers with relevant history
    context_items = memory.query(agenda, top_k=10)
    relevant_meeting_ids: set[str] = {item["meeting_id"] for item in context_items}

    # Pull all speaker profiles and score them
    profiles = get_speaker_profiles()
    agenda_lower = agenda.lower()

    scored: list[tuple[int, dict]] = []
    for profile in profiles:
        topics: list[str] = profile.get("topics") or []
        expertise: str = profile.get("expertise_summary") or ""

        # Topic keyword overlap with agenda
        topic_match = any(t.lower() in agenda_lower or agenda_lower in t.lower() for t in topics)
        expertise_match = any(word in expertise.lower() for word in agenda_lower.split() if len(word) > 3)

        # Include profiles that have relevant topics or expertise
        if topic_match or expertise_match or profile.get("meeting_count", 0) > 0:
            profile_copy = dict(profile)
            profile_copy["past_contributions"] = profile.get("meeting_count", 0)
            scored.append((profile.get("meeting_count", 0), profile_copy))

    # Sort by past_contributions descending
    scored.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in scored]


def generate_read_ahead(
    agenda: str,
    participants: list[str],
    memory: MeetingMemory,
    provider: str | None = None,
) -> dict:
    """Generate a read-ahead brief for an upcoming meeting.

    Gathers context, open items, and participant recommendations, then uses an LLM
    to synthesize a structured brief.

    Returns a dict with: summary, related_decisions, open_items,
    recommended_participants, assumptions.
    """
    # Gather inputs
    related_context = get_related_context(agenda, memory, top_k=5)
    open_items = get_open_items_for_prep(participants=participants if participants else None)
    recommended = recommend_participants(agenda, memory)

    # Build context text
    context_text = "\n".join(
        f"- [{item['meeting_title']}] {item['content']}" for item in related_context
    ) or "No related past meetings found."

    open_items_text = "\n".join(
        f"- {item['task']} (Owner: {item.get('owner', 'Unassigned')}, Due: {item.get('deadline', 'TBD')})"
        for item in open_items
    ) or "No open action items."

    rec_names = ", ".join(p["name"] for p in recommended[:5]) or "None identified"

    prompt = f"""You are preparing a read-ahead brief for an upcoming meeting.

Agenda: {agenda}

Participants invited: {', '.join(participants) if participants else 'TBD'}

Related past meeting context:
{context_text}

Open action items relevant to participants:
{open_items_text}

Suggested additional participants based on expertise: {rec_names}

Generate a structured read-ahead brief. Return a JSON object with exactly these fields:
{{
  "summary": "2-3 sentence overview of what the meeting needs to accomplish and key background",
  "related_decisions": ["list of relevant past decisions from context that may affect this meeting"],
  "open_items": ["list of open action items that should be reviewed in this meeting"],
  "recommended_participants": ["list of names who should attend based on expertise"],
  "assumptions": ["list of assumptions or open questions participants should come prepared to address"]
}}

Return ONLY valid JSON, no markdown fencing."""

    try:
        result = generate(prompt, provider=provider)
    except Exception:
        logger.warning("LLM generation failed for read-ahead brief, using fallback", exc_info=True)
        # Fallback: build a structured response from what we have without LLM
        result = {
            "summary": f"Upcoming meeting on: {agenda}",
            "related_decisions": [item["content"] for item in related_context if item.get("item_type") == "decision"],
            "open_items": [item["task"] for item in open_items],
            "recommended_participants": [p["name"] for p in recommended[:5]],
            "assumptions": [],
        }
        return result

    # Ensure expected keys are present even if LLM omits some
    defaults = {
        "summary": "",
        "related_decisions": [],
        "open_items": [],
        "recommended_participants": [],
        "assumptions": [],
    }
    if isinstance(result, dict):
        for key, default in defaults.items():
            result.setdefault(key, default)
    else:
        result = defaults

    return result
