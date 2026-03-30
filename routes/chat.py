"""Chat API routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from chat_session import ChatSession
from database import get_chat_messages, get_chat_session
from meeting_memory import MeetingMemory

router = APIRouter(prefix="/api", tags=["chat"])

_memory = None


def get_memory() -> MeetingMemory:
    global _memory
    if _memory is None:
        _memory = MeetingMemory()
    return _memory


@router.post("/chat")
async def chat(request: Request):
    """Send a message to the chat assistant.

    Request body:
        message (str): The user's message (required).
        session_id (str | None): Resume an existing session; creates a new one if omitted.
        context_meeting_id (str | None): Scope RAG retrieval to a specific meeting.
        provider (str | None): LLM provider override (gemini, ollama).

    Returns:
        {session_id, response, sources}
    """
    body = await request.json()

    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    session_id = body.get("session_id")
    context_meeting_id = body.get("context_meeting_id")
    provider = body.get("provider")

    try:
        session = ChatSession(session_id=session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    memory = get_memory()

    try:
        result = session.send_message(
            message,
            memory=memory,
            context_meeting_id=context_meeting_id,
            provider=provider,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Chat failed: {exc}")

    return result


@router.get("/chat/{session_id}/messages")
def get_session_messages(session_id: str):
    """Return all messages for a chat session in chronological order."""
    session = get_chat_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Chat session '{session_id}' not found")
    messages = get_chat_messages(session_id)
    return {"session_id": session_id, "messages": messages}
