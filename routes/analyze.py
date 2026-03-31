import json
import json as json_module
import asyncio
import logging
import queue
import threading
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

from config import EXPORTS_DIR
from database import get_meeting, update_ai_output, update_verified_output, record_export
from llm_client import analyze_transcript, get_available_providers

router = APIRouter(prefix="/api", tags=["analyze"])


def _check_local_llm() -> bool:
    """Check if a local LLM server (LM Studio/Ollama) is available."""
    import httpx
    import os
    url = os.getenv("LOCAL_LLM_URL", "http://localhost:1234")
    try:
        resp = httpx.get(f"{url}/v1/models", timeout=2.0)
        return resp.status_code == 200
    except Exception:
        return False

# Module-level stores for streaming analysis
_analysis_events: dict[str, queue.Queue] = {}  # meeting_id -> event queue
_analysis_cancel: dict[str, bool] = {}  # meeting_id -> cancel flag


def _emit_event(meeting_id: str, event: dict):
    """Push an SSE event to the queue for a meeting."""
    q = _analysis_events.get(meeting_id)
    if q:
        q.put(event)


@router.get("/analyze/{meeting_id}/progress")
async def analysis_progress(meeting_id: str):
    """SSE endpoint for streaming analysis progress and entities."""
    # Ensure queue exists
    if meeting_id not in _analysis_events:
        _analysis_events[meeting_id] = queue.Queue()

    async def event_stream():
        q = _analysis_events[meeting_id]
        while True:
            try:
                event = q.get_nowait()
                yield f"data: {json_module.dumps(event)}\n\n"
                if event.get("stage") in ("complete", "error"):
                    _analysis_events.pop(meeting_id, None)
                    _analysis_cancel.pop(meeting_id, None)
                    break
            except queue.Empty:
                await asyncio.sleep(0.2)
    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/analyze/{meeting_id}/stop")
async def stop_analysis(meeting_id: str):
    """Cancel an in-progress analysis. Pipeline will finish current chunk then stop."""
    _analysis_cancel[meeting_id] = True
    return {"meeting_id": meeting_id, "status": "stopping"}


@router.get("/providers")
def providers():
    available = get_available_providers()
    return {"providers": available, "default": available[0] if available else None}


@router.post("/analyze")
async def analyze(request: Request):
    body = await request.json()
    meeting_id = body.get("meeting_id")
    provider = body.get("provider")
    if not meeting_id:
        raise HTTPException(status_code=400, detail="meeting_id is required")

    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    utterances = meeting["utterances_json"]
    if not utterances:
        raise HTTPException(status_code=400, detail="No utterances found for this meeting")

    raw_transcript = meeting.get("raw_transcript", "")

    # Initialize event queue and cancel flag
    _analysis_events[meeting_id] = queue.Queue()
    _analysis_cancel[meeting_id] = False

    def on_progress(stage, progress, message):
        _emit_event(meeting_id, {"stage": stage, "progress": progress, "message": message})

    def on_entities(entities, chunk_index, total_chunks):
        """Called after each chunk — streams extracted entities to the frontend."""
        _emit_event(meeting_id, {
            "stage": "entities",
            "chunk": chunk_index + 1,
            "total_chunks": total_chunks,
            "entities": entities,
        })

    def should_cancel():
        """Check if the user requested cancellation."""
        return _analysis_cancel.get(meeting_id, False)

    try:
        # Use hybrid pipeline for local models (much better quality on 7B)
        # Use original pipeline for cloud models (Gemini handles full prompts well)
        use_hybrid = provider in (None, "ollama") and _check_local_llm()

        if use_hybrid:
            from hybrid_pipeline import run_hybrid_pipeline
            logger.info("Using hybrid pipeline for meeting %s (provider=%s)", meeting_id, provider)
            ai_output = run_hybrid_pipeline(
                meeting_id, raw_transcript, provider=provider or "ollama",
                progress_callback=on_progress,
                entity_callback=on_entities,
                cancel_check=should_cancel,
            )
        else:
            from extraction_pipeline import run_extraction_pipeline
            logger.info("Using standard pipeline for meeting %s (provider=%s)", meeting_id, provider)
            ai_output = run_extraction_pipeline(
                meeting_id, raw_transcript, provider=provider,
                progress_callback=on_progress,
                entity_callback=on_entities,
                cancel_check=should_cancel,
            )
    except Exception as e:
        logger.warning("Pipeline failed, falling back to single-shot: %s", e)
        try:
            ai_output = analyze_transcript(utterances, provider=provider)
        except PermissionError as e:
            raise HTTPException(status_code=401, detail=str(e))
        except ConnectionError as e:
            raise HTTPException(status_code=429, detail=str(e))
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except Exception as e:
            err_name = type(e).__name__
            if "AuthenticationError" in err_name:
                raise HTTPException(status_code=401, detail=f"Invalid API key: {e}")
            if "RateLimitError" in err_name:
                raise HTTPException(status_code=429, detail=f"Rate limited: {e}")
            raise HTTPException(status_code=502, detail=f"LLM API error: {e}")

    # Extract and store the clean transcript if the pipeline produced one
    clean_transcript = ai_output.pop("_clean_transcript", None)
    if clean_transcript:
        try:
            from database import update_raw_transcript
            update_raw_transcript(meeting_id, clean_transcript)
        except Exception:
            logger.exception("Failed to store clean transcript for %s", meeting_id)

    update_ai_output(meeting_id, ai_output)

    # Auto-update meeting title from AI-inferred title
    try:
        inferred_title = ai_output.get("meeting_metadata", {}).get("title")
        if inferred_title and inferred_title.strip():
            from database import update_meeting_title
            update_meeting_title(meeting_id, inferred_title.strip())
    except Exception:
        logger.exception("Failed to update meeting title for %s", meeting_id)

    return {"meeting_id": meeting_id, "status": "analyzed", "ai_output": ai_output}


def _generate_markdown(meeting: dict, verified: dict) -> str:
    md = []
    meta = verified.get("meeting_metadata", {})
    md.append(f"# {meta.get('title', meeting['title'])}")
    md.append(f"\n**Date:** {meta.get('date_mentioned', 'Not specified')}")
    md.append(f"**Participants:** {', '.join(meta.get('participants', []))}")
    md.append(f"**Status:** Approved")
    md.append(f"**Exported:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")

    if verified.get("state_of_direction"):
        md.append(f"\n## State of Direction\n\n{verified['state_of_direction']}")

    if verified.get("decisions"):
        md.append("\n## Decisions\n")
        for d in verified["decisions"]:
            md.append(f"### {d['id']}: {d['description']}")
            md.append(f"- **Made by:** {d.get('made_by', 'N/A')} | **Confidence:** {d.get('confidence', 'N/A')}")
            if d.get("source_quote"):
                md.append(f'- **Source:** "{d["source_quote"]}"')
            md.append("")

    if verified.get("action_items"):
        md.append("\n## Action Items\n")
        for a in verified["action_items"]:
            md.append(f"### {a['id']}: {a['task']}")
            owner = a.get('owner', 'Unassigned')
            deadline = a.get('deadline', 'N/A')
            confidence = a.get('confidence', 'N/A')
            md.append(f"- **Owner:** {owner} | **Deadline:** {deadline} | **Confidence:** {confidence}")
            if a.get("commitment_type"):
                md.append(f"- **Commitment:** {a['commitment_type']}")
            if a.get("source_quote"):
                md.append(f'- **Source:** "{a["source_quote"]}"')
            md.append("")

    if verified.get("open_risks"):
        md.append("\n## Open Risks\n")
        for r in verified["open_risks"]:
            md.append(f"### {r['id']}: {r['description']}")
            md.append(f"- **Raised by:** {r.get('raised_by', 'N/A')} | **Severity:** {r.get('severity', 'N/A')}")
            if r.get("source_quote"):
                md.append(f'- **Source:** "{r["source_quote"]}"')
            md.append("")

    if verified.get("trust_flags"):
        md.append("\n## Trust Flags\n")
        for flag in verified["trust_flags"]:
            md.append(f"- {flag}")

    md.append("\n---\n*Generated by Brainstorm Boost*\n")
    return "\n".join(md)


@router.post("/approve")
async def approve(request: Request):
    body = await request.json()
    meeting_id = body.get("meeting_id")
    verified_output = body.get("verified_output")

    if not meeting_id or not verified_output:
        raise HTTPException(status_code=400, detail="meeting_id and verified_output are required")

    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    update_verified_output(meeting_id, verified_output)

    # Auto-index into meeting memory for RAG queries
    try:
        from routes.query import get_memory
        memory = get_memory()
        memory.index_meeting(meeting_id, verified_output, raw_transcript=meeting.get("raw_transcript"))
    except Exception:
        logger.exception("Failed to auto-index meeting %s into memory", meeting_id)

    # Extract action items into dedicated table
    try:
        from database import create_action_item, upsert_speaker_profile
        for a in verified_output.get("action_items", []):
            create_action_item(
                meeting_id=meeting_id,
                task=a.get("task", ""),
                owner=a.get("owner"),
                deadline=a.get("deadline"),
                confidence=a.get("confidence"),
                source_quote=a.get("source_quote"),
            )
        participants = verified_output.get("meeting_metadata", {}).get("participants", [])
        for name in participants:
            title = verified_output.get("meeting_metadata", {}).get("title", "")
            upsert_speaker_profile(name=name, topics=[title] if title else [], meeting_count=1)
    except Exception:
        logger.exception("Failed to extract action items for meeting %s", meeting_id)

    # Generate exports
    safe_title = "".join(c if c.isalnum() or c in "-_ " else "" for c in meeting["title"])[:50].strip()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    base_name = f"{safe_title}_{ts}".replace(" ", "_")

    # Markdown export
    md_filename = f"{base_name}.md"
    md_path = EXPORTS_DIR / md_filename
    md_content = _generate_markdown(meeting, verified_output)
    md_path.write_text(md_content)
    record_export(meeting_id, md_filename, "markdown")

    # JSON export
    json_filename = f"{base_name}.json"
    json_path = EXPORTS_DIR / json_filename
    json_path.write_text(json.dumps(verified_output, indent=2))
    record_export(meeting_id, json_filename, "json")

    return {
        "meeting_id": meeting_id,
        "status": "approved",
        "exports": {
            "markdown": f"/exports/{md_filename}",
            "json": f"/exports/{json_filename}",
        },
    }
