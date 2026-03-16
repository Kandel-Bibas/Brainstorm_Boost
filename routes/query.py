from fastapi import APIRouter, HTTPException, Request

from meeting_memory import MeetingMemory

router = APIRouter(prefix="/api", tags=["query"])

_memory = None


def get_memory() -> MeetingMemory:
    global _memory
    if _memory is None:
        _memory = MeetingMemory()
    return _memory


@router.get("/memory/{meeting_id}/status")
async def memory_status(meeting_id: str):
    """Check if a meeting is indexed in ChromaDB."""
    memory = get_memory()
    return {"meeting_id": meeting_id, "indexed": memory.is_meeting_indexed(meeting_id)}


@router.post("/memory/{meeting_id}/index")
async def index_meeting(meeting_id: str):
    """Add a meeting to ChromaDB."""
    from database import get_meeting
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    ai_output = meeting.get("verified_output_json") or meeting.get("ai_output_json")
    if not ai_output:
        raise HTTPException(status_code=400, detail="Meeting has no AI output to index")

    memory = get_memory()
    memory.index_meeting(meeting_id, ai_output)
    return {"meeting_id": meeting_id, "status": "indexed"}


@router.delete("/memory/{meeting_id}")
async def remove_from_memory(meeting_id: str):
    """Remove a meeting from ChromaDB."""
    memory = get_memory()
    count = memory.remove_meeting(meeting_id)
    return {"meeting_id": meeting_id, "removed_items": count}


@router.post("/query")
async def query_meetings(request: Request):
    body = await request.json()
    question = body.get("question")
    provider = body.get("provider")

    if not question or not question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    memory = get_memory()

    try:
        result = memory.query_with_llm(question.strip(), provider=provider)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Query failed: {e}")

    return result
