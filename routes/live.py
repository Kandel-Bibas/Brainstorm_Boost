from __future__ import annotations

import asyncio
import json
import logging
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from live_session import LiveSession

from idea_board import IdeaBoard

logger = logging.getLogger(__name__)

router = APIRouter(tags=["live"])

# Single active session (MVP — one session at a time)
_active_session: LiveSession | None = None
_active_board: IdeaBoard | None = None
_connected_clients: dict[str, WebSocket] = {}  # token -> websocket
_moderator_token: str | None = None


def _get_session() -> LiveSession:
    if _active_session is None:
        raise HTTPException(status_code=404, detail="No active live session")
    return _active_session


@router.post("/api/live/start")
async def start_session(request: Request):
    global _active_session, _active_board, _moderator_token, _connected_clients

    body = await request.json()
    agenda = body.get("agenda")
    participants = body.get("participants", [])

    if not agenda:
        raise HTTPException(status_code=400, detail="agenda is required")

    # End any existing session
    _connected_clients = {}
    _moderator_token = str(uuid4())

    _active_session = LiveSession(agenda=agenda, participants=participants)
    _active_board = IdeaBoard(session_id=_active_session.session_id)

    return {
        "session_id": _active_session.session_id,
        "join_code": _active_session.join_code,
        "moderator_token": _moderator_token,
    }


@router.post("/api/live/end")
async def end_session(request: Request):
    global _active_session, _active_board, _moderator_token

    session = _get_session()

    # Compile transcript and feed into Phase 1 pipeline
    raw_text, utterances = session.compile_transcript()

    meeting_id = None
    if utterances:
        from database import create_meeting
        meeting_id = create_meeting(
            title=f"Live: {session.agenda[:50]}",
            raw_transcript=raw_text,
            utterances=utterances,
        )

    # Notify all clients
    for token, ws in _connected_clients.items():
        try:
            await ws.send_json({"type": "session_ended", "meeting_id": meeting_id})
        except Exception:
            logger.warning("Failed to notify client %s of session end", token, exc_info=True)

    _active_session = None
    _active_board = None
    _moderator_token = None

    return {"meeting_id": meeting_id, "status": "ended"}


@router.get("/api/live/status")
async def session_status():
    if _active_session is None:
        return {"active": False}
    return {
        "active": True,
        "session_id": _active_session.session_id,
        "join_code": _active_session.join_code,
        "participant_count": len(_connected_clients),
        "utterance_count": len(_active_session.transcript),
    }


@router.websocket("/ws/session")
async def websocket_session(websocket: WebSocket, code: str = "", role: str = "participant"):
    global _active_session, _active_board

    await websocket.accept()

    if _active_session is None:
        await websocket.send_json({"type": "error", "message": "No active session"})
        await websocket.close()
        return

    if code != _active_session.join_code and role != "moderator":
        await websocket.send_json({"type": "error", "message": "Invalid join code"})
        await websocket.close()
        return

    # Assign a session token
    client_token = str(uuid4())
    _connected_clients[client_token] = websocket
    is_moderator = role == "moderator"

    try:
        await websocket.send_json({
            "type": "connected",
            "token": client_token,
            "role": role,
            "session_id": _active_session.session_id,
        })

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "utterance" and is_moderator:
                # Moderator sends transcribed utterances
                speaker = data.get("speaker", "Unknown")
                text = data.get("text", "")
                if text.strip():
                    _active_session.add_utterance(speaker, text)
                    # Broadcast to all clients
                    await _broadcast({
                        "type": "utterance",
                        "speaker": speaker,
                        "text": text,
                        "timestamp": _active_session.transcript[-1]["timestamp"],
                    })

                    # Send moderator-only updates periodically
                    if len(_active_session.transcript) % 3 == 0:
                        await _send_moderator_updates(websocket)

            elif msg_type == "submit_idea":
                text = data.get("text", "").strip()
                if text and _active_board:
                    idea_id = _active_board.submit_idea(text)
                    await _broadcast({
                        "type": "ideas_update",
                        "ideas": _active_board.get_results(),
                    })

            elif msg_type == "vote":
                idea_id = data.get("idea_id")
                if idea_id and _active_board:
                    _active_board.vote(idea_id, client_token)
                    await _broadcast({
                        "type": "ideas_update",
                        "ideas": _active_board.get_results(),
                    })

            elif msg_type == "request_stats" and is_moderator:
                await _send_moderator_updates(websocket)

    except WebSocketDisconnect:
        logger.debug("WebSocket client %s disconnected", client_token)
    except Exception:
        logger.exception("WebSocket error for client %s", client_token)
    finally:
        _connected_clients.pop(client_token, None)


async def _broadcast(message: dict):
    dead = []
    for token, ws in _connected_clients.items():
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(token)
    for t in dead:
        _connected_clients.pop(t, None)


async def _send_moderator_updates(ws: WebSocket):
    if _active_session is None:
        return

    stats = _active_session.get_participation_stats()
    alerts = _active_session.get_participation_alerts()
    drift = _active_session.check_topic_drift()

    try:
        await ws.send_json({"type": "participation", "stats": stats})
        await ws.send_json({"type": "drift", **drift})
        if alerts:
            for alert in alerts:
                await ws.send_json({"type": "alert", **alert})
    except Exception:
        logger.warning("Failed to send moderator updates", exc_info=True)

    # Context surfacing from past meetings
    try:
        if len(_active_session.transcript) >= 5:
            recent_text = " ".join(u["text"] for u in _active_session.transcript[-5:])
            from routes.query import get_memory
            memory = get_memory()
            context = memory.query(recent_text, top_k=3)
            if context:
                await ws.send_json({"type": "context", "items": context})
    except Exception:
        logger.warning("Failed to surface context from past meetings", exc_info=True)
