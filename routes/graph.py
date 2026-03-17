import logging

from fastapi import APIRouter, HTTPException

from database import get_meeting, get_meeting_graph, update_ai_output

router = APIRouter(prefix="/api", tags=["graph"])

logger = logging.getLogger(__name__)


INTERNAL_PROPERTIES = {"quote_verified", "chunk_start", "chunk_end", "source_quote"}


def _clean_graph_for_api(graph: dict) -> dict:
    """Strip internal metadata properties from graph nodes before sending to frontend."""
    for node in graph.get("nodes", []):
        props = node.get("properties", {})
        for key in INTERNAL_PROPERTIES:
            props.pop(key, None)
    return graph


@router.get("/meetings/{meeting_id}/graph")
async def meeting_graph(meeting_id: str):
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    graph = get_meeting_graph(meeting_id)
    return _clean_graph_for_api(graph)


@router.post("/meetings/{meeting_id}/reindex")
async def reindex_meeting(meeting_id: str, provider: str = None):
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    raw_transcript = meeting.get("raw_transcript", "")
    if not raw_transcript:
        raise HTTPException(status_code=400, detail="Meeting has no transcript to reindex")

    from extraction_pipeline import run_extraction_pipeline

    try:
        ai_output = run_extraction_pipeline(meeting_id, raw_transcript, provider=provider)
        update_ai_output(meeting_id, ai_output)
    except Exception as e:
        logger.exception("Reindex failed for meeting %s", meeting_id)
        raise HTTPException(status_code=502, detail=f"Reindex failed: {e}")

    graph = get_meeting_graph(meeting_id)
    return {
        "status": "reindexed",
        "nodes_count": len(graph["nodes"]),
        "edges_count": len(graph["edges"]),
    }
