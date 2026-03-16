from fastapi import APIRouter, HTTPException, Request

from meeting_memory import MeetingMemory

router = APIRouter(prefix="/api", tags=["query"])

_memory = None


def get_memory() -> MeetingMemory:
    global _memory
    if _memory is None:
        _memory = MeetingMemory()
    return _memory


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
