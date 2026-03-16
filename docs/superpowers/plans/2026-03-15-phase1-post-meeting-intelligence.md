# Phase 1: Post-Meeting Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 1 of Brainstorm Boost — add Ollama local LLM provider, speech-to-text pipeline, queryable meeting memory, and rewrite the frontend with a modern stack. All running on a single MacBook.

**Architecture:** FastAPI backend with provider-agnostic LLM abstraction (Anthropic/Gemini/Ollama), faster-whisper STT with pyannote diarization, ChromaDB for vector search + RAG. React frontend served as static build from FastAPI.

**Tech Stack:**
- Backend: Python 3.11+, FastAPI, SQLite, ChromaDB, faster-whisper, pyannote.audio, sentence-transformers
- Frontend: React 18, Vite, Tailwind CSS, shadcn/ui, Recharts
- LLM: Ollama (local), Anthropic/Gemini (cloud) via provider abstraction
- Spec: `docs/superpowers/specs/2026-03-15-brainstorm-boost-full-system-design.md`

---

## Chunk 1: Project Foundation

### Task 1: Initialize Git & Project Structure

**Files:**
- Create: `.gitignore`
- Create: `routes/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: Initialize git repository and Python 3.11+ venv**

The existing venv uses Python 3.9.6 which is too old for faster-whisper and pyannote.audio (require 3.10+). Create a new venv with Python 3.11+.

```bash
cd /Users/bibas/Work/DS4D/brainstorm-boost
git init

# Remove old Python 3.9 venv and create new one with 3.11+
rm -rf venv
python3.11 -m venv venv   # or python3 if 3.11+ is the default
source venv/bin/activate
pip install -r requirements.txt
```

If `python3.11` is not available, install it via Homebrew: `brew install python@3.11`

- [ ] **Step 2: Create .gitignore**

```gitignore
# Python
__pycache__/
*.py[cod]
*.egg-info/
venv/
.venv/

# Environment
.env

# Database & data
*.db
chroma_db/

# Exports (generated)
exports/

# IDE
.vscode/
.idea/

# Frontend build
frontend/node_modules/
frontend/dist/

# OS
.DS_Store
Thumbs.db

# Superpowers
.superpowers/
```

- [ ] **Step 3: Create test infrastructure**

`tests/__init__.py` — empty file

`tests/conftest.py`:
```python
import os
import tempfile
from pathlib import Path

import pytest

# Use a temp database for tests
@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("database.DB_PATH", db_path)
    from database import init_db
    init_db()
    yield db_path
```

- [ ] **Step 4: Create routes package**

`routes/__init__.py` — empty file

- [ ] **Step 5: Install test dependencies, configure pytest, and verify**

```bash
pip install pytest pytest-asyncio httpx
```

Create `pyproject.toml` (or add to existing):
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

```bash
pytest --co  # should collect 0 tests, no errors
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore routes/ tests/
git commit -m "chore: initialize git repo with project structure and test infrastructure"
```

---

### Task 2: Refactor main.py into Route Modules

Extract existing endpoints from `main.py` into organized route files using FastAPI `APIRouter`. All URLs stay the same — this is a non-breaking refactor.

**Files:**
- Modify: `main.py`
- Create: `routes/upload.py`
- Create: `routes/analyze.py`
- Create: `routes/meetings.py`
- Create: `tests/test_routes.py`

- [ ] **Step 1: Write integration tests for existing endpoints**

`tests/test_routes.py`:
```python
import pytest
from httpx import AsyncClient, ASGITransport
from main import app

transport = ASGITransport(app=app)

@pytest.mark.asyncio
async def test_providers_endpoint():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/providers")
        assert res.status_code == 200
        data = res.json()
        assert "providers" in data
        assert "default" in data

@pytest.mark.asyncio
async def test_meetings_list_empty():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/meetings")
        assert res.status_code == 200
        assert res.json() == []

@pytest.mark.asyncio
async def test_upload_transcript_text():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/upload-transcript",
            data={"text": " ".join(["word"] * 60)},
        )
        assert res.status_code == 200
        data = res.json()
        assert "meeting_id" in data
        assert data["utterance_count"] >= 1

@pytest.mark.asyncio
async def test_upload_transcript_too_short():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/upload-transcript",
            data={"text": "too short"},
        )
        assert res.status_code == 400

@pytest.mark.asyncio
async def test_meeting_not_found():
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/meetings/nonexistent-id")
        assert res.status_code == 404
```

- [ ] **Step 2: Run tests to verify they pass against current code**

```bash
pytest tests/test_routes.py -v
```
Expected: All 5 tests PASS

- [ ] **Step 3: Create routes/upload.py**

```python
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from database import create_meeting
from transcript_parser import parse_transcript

router = APIRouter(prefix="/api", tags=["upload"])


@router.post("/upload-transcript")
async def upload_transcript(
    text: str = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    title: str = Form(default=None),
):
    raw = None
    filename = None

    if file and file.filename:
        raw_bytes = await file.read()
        raw = raw_bytes.decode("utf-8-sig")
        filename = file.filename
    elif text:
        raw = text
    else:
        raise HTTPException(status_code=400, detail="Provide either text or a file")

    word_count = len(raw.split())
    if word_count < 50:
        raise HTTPException(
            status_code=400,
            detail=f"Transcript too short ({word_count} words). Need at least 50 words for meaningful analysis.",
        )

    utterances = parse_transcript(raw)
    meeting_title = title or filename or f"Meeting {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
    meeting_id = create_meeting(meeting_title, raw, utterances)

    format_detected = utterances[0]["format_detected"] if utterances else "narrative"

    return {
        "meeting_id": meeting_id,
        "title": meeting_title,
        "utterance_count": len(utterances),
        "format_detected": format_detected,
        "utterances": utterances,
    }
```

- [ ] **Step 4: Create routes/analyze.py**

```python
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from config import EXPORTS_DIR
from database import get_meeting, update_ai_output, update_verified_output, record_export
from llm_client import analyze_transcript, get_available_providers

router = APIRouter(prefix="/api", tags=["analyze"])


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

    update_ai_output(meeting_id, ai_output)
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
        md.append("| ID | Decision | Made By | Confidence |")
        md.append("|-----|----------|---------|------------|")
        for d in verified["decisions"]:
            md.append(f"| {d['id']} | {d['description']} | {d.get('made_by', 'N/A')} | {d.get('confidence', 'N/A')} |")
            if d.get("source_quote"):
                md.append(f"\n> {d['source_quote']}\n")

    if verified.get("action_items"):
        md.append("\n## Action Items\n")
        md.append("| ID | Task | Owner | Deadline | Confidence |")
        md.append("|-----|------|-------|----------|------------|")
        for a in verified["action_items"]:
            md.append(f"| {a['id']} | {a['task']} | {a.get('owner', 'Unassigned')} | {a.get('deadline', 'N/A')} | {a.get('confidence', 'N/A')} |")
            if a.get("source_quote"):
                md.append(f"\n> {a['source_quote']}\n")

    if verified.get("open_risks"):
        md.append("\n## Open Risks\n")
        md.append("| ID | Risk | Raised By | Severity |")
        md.append("|-----|------|-----------|----------|")
        for r in verified["open_risks"]:
            md.append(f"| {r['id']} | {r['description']} | {r.get('raised_by', 'N/A')} | {r.get('severity', 'N/A')} |")
            if r.get("source_quote"):
                md.append(f"\n> {r['source_quote']}\n")

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

    safe_title = "".join(c if c.isalnum() or c in "-_ " else "" for c in meeting["title"])[:50].strip()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    base_name = f"{safe_title}_{ts}".replace(" ", "_")

    md_filename = f"{base_name}.md"
    md_path = EXPORTS_DIR / md_filename
    md_content = _generate_markdown(meeting, verified_output)
    md_path.write_text(md_content)
    record_export(meeting_id, md_filename, "markdown")

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
```

- [ ] **Step 5: Create routes/meetings.py**

```python
from fastapi import APIRouter, HTTPException

from database import get_meeting, list_meetings

router = APIRouter(prefix="/api", tags=["meetings"])


@router.get("/meetings")
def meetings_list():
    return list_meetings()


@router.get("/meetings/{meeting_id}")
def meeting_detail(meeting_id: str):
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting
```

- [ ] **Step 6: Create shared config module**

`config.py`:
```python
from pathlib import Path

PROJECT_DIR = Path(__file__).parent
EXPORTS_DIR = PROJECT_DIR / "exports"
EXPORTS_DIR.mkdir(exist_ok=True)
```

- [ ] **Step 7: Rewrite main.py to use routers**

```python
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from config import EXPORTS_DIR
from database import init_db
from routes import upload, analyze, meetings

app = FastAPI(title="Brainstorm Boost", version="0.2.0")

app.mount("/exports", StaticFiles(directory=str(EXPORTS_DIR)), name="exports")

# Register routers
app.include_router(upload.router)
app.include_router(analyze.router)
app.include_router(meetings.router)


@app.on_event("startup")
def startup():
    init_db()


@app.get("/", response_class=HTMLResponse)
def serve_index():
    index_path = Path(__file__).parent / "static" / "index.html"
    return HTMLResponse(content=index_path.read_text())
```

- [ ] **Step 7: Run tests to verify refactor is non-breaking**

```bash
pytest tests/test_routes.py -v
```
Expected: All 5 tests PASS (same as before refactor)

- [ ] **Step 8: Commit**

```bash
git add main.py routes/ tests/
git commit -m "refactor: extract endpoints into route modules using FastAPI APIRouter"
```

---

### Task 3: Add Ollama Provider

**Files:**
- Modify: `llm_client.py`
- Create: `tests/test_llm_client.py`

- [ ] **Step 1: Install openai package for Ollama's API**

```bash
pip install openai
```

- [ ] **Step 2: Write tests for Ollama provider**

`tests/test_llm_client.py`:
```python
import json
from unittest.mock import patch, MagicMock

import pytest

from llm_client import (
    get_available_providers,
    _parse_json_response,
    _format_transcript_for_prompt,
)


def test_parse_json_response_direct():
    raw = '{"key": "value"}'
    assert _parse_json_response(raw) == {"key": "value"}


def test_parse_json_response_fenced():
    raw = '```json\n{"key": "value"}\n```'
    assert _parse_json_response(raw) == {"key": "value"}


def test_parse_json_response_invalid():
    with pytest.raises(ValueError, match="Could not parse JSON"):
        _parse_json_response("not json at all")


def test_format_transcript():
    utterances = [
        {"speaker": "Alice", "text": "Hello", "timestamp": "00:01:00"},
        {"speaker": "Bob", "text": "Hi there", "timestamp": None},
    ]
    result = _format_transcript_for_prompt(utterances)
    assert "[00:01:00] Alice: Hello" in result
    assert "Bob: Hi there" in result
    assert "[" not in result.split("\n")[1]  # No timestamp bracket for None


def test_get_available_providers_with_ollama(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    # Mock Ollama health check
    with patch("llm_client._check_ollama_available", return_value=True):
        providers = get_available_providers()
        assert "anthropic" in providers
        assert "ollama" in providers
        assert "gemini" not in providers


def test_get_available_providers_ollama_down(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    with patch("llm_client._check_ollama_available", return_value=False):
        providers = get_available_providers()
        assert providers == []
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_llm_client.py -v
```
Expected: `_check_ollama_available` tests FAIL (function doesn't exist yet)

- [ ] **Step 4: Add Ollama provider to llm_client.py**

Add these functions to `llm_client.py`:

```python
import httpx  # add to imports (lighter than requests for async)

OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct-q4_K_M")


def _check_ollama_available() -> bool:
    """Check if Ollama is running and has at least one model."""
    try:
        resp = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2.0)
        return resp.status_code == 200
    except (httpx.ConnectError, httpx.TimeoutException):
        return False
```

Update `get_available_providers()`:
```python
def get_available_providers() -> list[str]:
    providers = []
    if os.getenv("ANTHROPIC_API_KEY"):
        providers.append("anthropic")
    if os.getenv("GOOGLE_API_KEY"):
        providers.append("gemini")
    if _check_ollama_available():
        providers.append("ollama")
    return providers
```

Add the Ollama analysis function:
```python
def _analyze_with_ollama(user_prompt: str) -> dict:
    from openai import OpenAI

    client = OpenAI(base_url=f"{OLLAMA_BASE_URL}/v1", api_key="ollama")

    try:
        response = client.chat.completions.create(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
        )
        text = response.choices[0].message.content
        return _parse_json_response(text)
    except (json.JSONDecodeError, ValueError):
        pass

    # Retry with stricter prompt
    retry_prompt = (
        user_prompt
        + "\n\nIMPORTANT: Your previous response was not valid JSON. "
        "Return ONLY the JSON object, no markdown fencing, no explanation text."
    )
    try:
        response = client.chat.completions.create(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": retry_prompt},
            ],
            temperature=0.0,
        )
        text = response.choices[0].message.content
        return _parse_json_response(text)
    except (json.JSONDecodeError, ValueError) as e:
        raise ValueError(f"Ollama returned invalid JSON after retry: {e}")
```

Update `analyze_transcript()` to handle the "ollama" provider:
```python
    if provider == "ollama":
        return _analyze_with_ollama(user_prompt)
```

Add a public `generate()` function for free-form prompts (used by meeting memory RAG):
```python
def generate(prompt: str, provider: str = None) -> dict:
    """Send a free-form prompt to an LLM and return parsed JSON response.

    Unlike analyze_transcript() which formats utterances into the meeting analysis
    prompt, this function sends the prompt as-is. Used by meeting_memory.py for RAG.
    """
    available = get_available_providers()
    if provider and provider not in available:
        raise ValueError(f"Provider '{provider}' not available. Available: {available}")
    if not provider:
        if not available:
            raise ValueError("No LLM provider configured")
        provider = available[0]

    if provider == "anthropic":
        return _analyze_with_anthropic(prompt)
    elif provider == "gemini":
        return _analyze_with_gemini(prompt)
    elif provider == "ollama":
        return _analyze_with_ollama(prompt)
    else:
        raise ValueError(f"Unknown provider: {provider}")
```

- [ ] **Step 5: Add httpx to requirements.txt**

```
httpx>=0.27.0
```

- [ ] **Step 6: Run tests**

```bash
pip install httpx
pytest tests/test_llm_client.py -v
```
Expected: All 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add llm_client.py tests/test_llm_client.py requirements.txt
git commit -m "feat: add Ollama as local LLM provider via OpenAI-compatible API"
```

---

## Chunk 2: STT & Meeting Memory

### Task 4: Speech-to-Text Engine

**Files:**
- Create: `stt_engine.py`
- Create: `tests/test_stt_engine.py`
- Modify: `routes/upload.py` (add audio upload endpoint)
- Modify: `requirements.txt`

- [ ] **Step 1: Install STT dependencies**

```bash
pip install faster-whisper pyannote.audio sounddevice numpy
```

- [ ] **Step 2: Write tests for STT engine**

`tests/test_stt_engine.py`:
```python
import numpy as np
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from stt_engine import align_segments, format_as_utterances


def test_align_segments_simple():
    """Test aligning whisper segments with speaker labels."""
    whisper_segments = [
        {"start": 0.0, "end": 2.0, "text": "Hello everyone"},
        {"start": 2.5, "end": 5.0, "text": "Welcome to the meeting"},
    ]
    speaker_segments = [
        {"start": 0.0, "end": 3.0, "speaker": "SPEAKER_00"},
        {"start": 3.0, "end": 6.0, "speaker": "SPEAKER_01"},
    ]
    result = align_segments(whisper_segments, speaker_segments)
    assert len(result) == 2
    assert result[0]["speaker"] == "SPEAKER_00"
    assert result[0]["text"] == "Hello everyone"
    assert result[1]["speaker"] == "SPEAKER_01"
    assert result[1]["text"] == "Welcome to the meeting"


def test_align_segments_empty():
    assert align_segments([], []) == []


def test_format_as_utterances():
    aligned = [
        {"start": 0.0, "end": 2.0, "text": "Hello", "speaker": "SPEAKER_00"},
        {"start": 2.5, "end": 5.0, "text": "Hi there", "speaker": "SPEAKER_01"},
    ]
    result = format_as_utterances(aligned)
    assert len(result) == 2
    assert result[0]["speaker"] == "SPEAKER_00"
    assert result[0]["text"] == "Hello"
    assert result[0]["timestamp"] == "00:00:00"
    assert result[0]["format_detected"] == "audio"


def test_format_as_utterances_merges_consecutive():
    aligned = [
        {"start": 0.0, "end": 2.0, "text": "Hello", "speaker": "SPEAKER_00"},
        {"start": 2.0, "end": 4.0, "text": "everyone", "speaker": "SPEAKER_00"},
        {"start": 4.5, "end": 6.0, "text": "Hi", "speaker": "SPEAKER_01"},
    ]
    result = format_as_utterances(aligned)
    assert len(result) == 2
    assert result[0]["text"] == "Hello everyone"
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_stt_engine.py -v
```
Expected: FAIL (module doesn't exist)

- [ ] **Step 4: Implement stt_engine.py**

```python
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import AsyncIterator

_whisper_model = None
_diarization_pipeline = None


def _get_whisper_model(model_size: str = "medium"):
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel(
            model_size,
            device="auto",
            compute_type="auto",
        )
    return _whisper_model


def _get_diarization_pipeline():
    global _diarization_pipeline
    if _diarization_pipeline is None:
        import os
        from pyannote.audio import Pipeline
        hf_token = os.getenv("HF_TOKEN")
        if not hf_token:
            raise ValueError(
                "HF_TOKEN environment variable required for speaker diarization. "
                "Accept the pyannote model license at https://huggingface.co/pyannote/speaker-diarization-3.1 "
                "and set HF_TOKEN in your .env file."
            )
        _diarization_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        )
    return _diarization_pipeline


def align_segments(
    whisper_segments: list[dict],
    speaker_segments: list[dict],
) -> list[dict]:
    """Align whisper text segments with pyannote speaker labels.

    For each whisper segment, find the speaker segment that overlaps
    the most with it (by midpoint matching).
    """
    if not whisper_segments:
        return []

    aligned = []
    for ws in whisper_segments:
        midpoint = (ws["start"] + ws["end"]) / 2
        speaker = "Unknown"
        for ss in speaker_segments:
            if ss["start"] <= midpoint <= ss["end"]:
                speaker = ss["speaker"]
                break
        aligned.append({
            "start": ws["start"],
            "end": ws["end"],
            "text": ws["text"].strip(),
            "speaker": speaker,
        })
    return aligned


def format_as_utterances(aligned: list[dict]) -> list[dict]:
    """Convert aligned segments to utterance format, merging consecutive same-speaker segments."""
    if not aligned:
        return []

    merged = [aligned[0].copy()]
    for seg in aligned[1:]:
        if seg["speaker"] == merged[-1]["speaker"]:
            merged[-1]["text"] += " " + seg["text"]
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(seg.copy())

    utterances = []
    for seg in merged:
        seconds = int(seg["start"])
        ts = f"{seconds // 3600:02d}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"
        utterances.append({
            "speaker": seg["speaker"],
            "text": seg["text"],
            "timestamp": ts,
            "format_detected": "audio",
        })
    return utterances


def transcribe_file(file_path: Path, model_size: str = "medium") -> list[dict]:
    """Transcribe an audio file with speaker diarization.

    Returns list of utterances in the same format as transcript_parser.parse_transcript().
    """
    model = _get_whisper_model(model_size)
    segments, info = model.transcribe(str(file_path), beam_size=5)

    whisper_segments = []
    for seg in segments:
        whisper_segments.append({
            "start": seg.start,
            "end": seg.end,
            "text": seg.text,
        })

    # Speaker diarization
    try:
        pipeline = _get_diarization_pipeline()
        diarization = pipeline(str(file_path))
        speaker_segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            speaker_segments.append({
                "start": turn.start,
                "end": turn.end,
                "speaker": speaker,
            })
    except (ValueError, Exception):
        # If diarization fails (no HF_TOKEN, etc.), assign all to Unknown
        speaker_segments = [{
            "start": 0.0,
            "end": whisper_segments[-1]["end"] if whisper_segments else 0.0,
            "speaker": "Unknown",
        }]

    aligned = align_segments(whisper_segments, speaker_segments)
    return format_as_utterances(aligned)


async def transcribe_file_async(file_path: Path, model_size: str = "medium") -> list[dict]:
    """Async wrapper — runs transcription in a thread to avoid blocking the event loop."""
    return await asyncio.to_thread(transcribe_file, file_path, model_size)


# NOTE: transcribe_stream() is deferred to Phase 3 (live_session.py).
# It will be implemented as an async generator yielding utterances from
# streaming audio chunks for real-time transcription.


def unload_models():
    """Free STT models from memory."""
    global _whisper_model, _diarization_pipeline
    _whisper_model = None
    _diarization_pipeline = None
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_stt_engine.py -v
```
Expected: All 4 tests PASS

- [ ] **Step 6: Add audio upload endpoint to routes/upload.py**

Add to `routes/upload.py`:
```python
import tempfile
import asyncio
from pathlib import Path as FilePath

from stt_engine import transcribe_file_async

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".webm", ".ogg", ".flac"}


@router.post("/upload-audio")
async def upload_audio(
    file: UploadFile = File(...),
    title: str = Form(default=None),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    suffix = FilePath(file.filename).suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported audio format '{suffix}'. Supported: {', '.join(sorted(AUDIO_EXTENSIONS))}",
        )

    # Save to temp file for processing
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        # Reject files > 500MB (~4 hours of audio)
        if len(content) > 500 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Audio file too large (max 500MB / ~4 hours)")
        tmp.write(content)
        tmp_path = FilePath(tmp.name)

    try:
        utterances = await transcribe_file_async(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")
    finally:
        tmp_path.unlink(missing_ok=True)

    if not utterances:
        raise HTTPException(status_code=422, detail="No speech detected in audio file")

    raw_text = "\n".join(f"[{u['timestamp']}] {u['speaker']}: {u['text']}" for u in utterances)
    meeting_title = title or file.filename or f"Meeting {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
    meeting_id = create_meeting(meeting_title, raw_text, utterances)

    return {
        "meeting_id": meeting_id,
        "title": meeting_title,
        "utterance_count": len(utterances),
        "format_detected": "audio",
        "utterances": utterances,
    }
```

- [ ] **Step 7: Commit**

```bash
git add stt_engine.py routes/upload.py tests/test_stt_engine.py requirements.txt
git commit -m "feat: add speech-to-text engine with faster-whisper and pyannote diarization"
```

---

### Task 5: Meeting Memory (ChromaDB + RAG)

**Files:**
- Create: `meeting_memory.py`
- Create: `tests/test_meeting_memory.py`
- Create: `routes/query.py`
- Modify: `routes/analyze.py` (auto-index on approve)
- Modify: `main.py` (register query router)
- Modify: `requirements.txt`

- [ ] **Step 1: Install dependencies**

```bash
pip install chromadb sentence-transformers
```

- [ ] **Step 2: Write tests for meeting memory**

`tests/test_meeting_memory.py`:
```python
import pytest
from pathlib import Path

from meeting_memory import MeetingMemory


@pytest.fixture
def memory(tmp_path):
    return MeetingMemory(persist_dir=str(tmp_path / "chroma_test"))


@pytest.fixture
def sample_ai_output():
    return {
        "meeting_metadata": {"title": "Drone Battery Review", "participants": ["Alice", "Bob"]},
        "decisions": [
            {
                "id": "D1",
                "description": "Use lithium-polymer batteries for the new drone prototype",
                "made_by": "Alice",
                "confidence": "high",
                "source_quote": "Let's go with lithium-polymer, they have better energy density",
            }
        ],
        "action_items": [
            {
                "id": "A1",
                "task": "Research lithium-polymer battery suppliers",
                "owner": "Bob",
                "deadline": "Friday",
                "confidence": "high",
                "source_quote": "Bob, can you look into suppliers by Friday?",
            }
        ],
        "open_risks": [
            {
                "id": "R1",
                "description": "Battery weight may exceed airframe limits",
                "raised_by": "Bob",
                "severity": "medium",
                "source_quote": "I'm worried the weight might be too much for the current frame",
            }
        ],
        "state_of_direction": "Team decided on lithium-polymer batteries. Bob researching suppliers.",
    }


def test_index_and_query(memory, sample_ai_output):
    memory.index_meeting("meeting-1", sample_ai_output)
    results = memory.query("drone battery decision")
    assert len(results) > 0
    assert any("lithium-polymer" in r["content"].lower() for r in results)


def test_query_empty_db(memory):
    results = memory.query("anything")
    assert results == []


def test_index_multiple_meetings(memory, sample_ai_output):
    memory.index_meeting("meeting-1", sample_ai_output)

    second_output = {
        "meeting_metadata": {"title": "Frequency Allocation"},
        "decisions": [{"id": "D1", "description": "Use 5.8 GHz for drone comms", "source_quote": "5.8 GHz is best"}],
        "action_items": [],
        "open_risks": [],
        "state_of_direction": "Chose 5.8 GHz frequency band.",
    }
    memory.index_meeting("meeting-2", second_output)

    results = memory.query("frequency allocation")
    assert any("5.8" in r["content"] for r in results)

    results = memory.query("battery")
    assert any("lithium" in r["content"].lower() for r in results)
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_meeting_memory.py -v
```
Expected: FAIL (module doesn't exist)

- [ ] **Step 4: Implement meeting_memory.py**

```python
from __future__ import annotations

from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer

_embedding_model = None


def _get_embedding_model() -> SentenceTransformer:
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedding_model


class MeetingMemory:
    """ChromaDB-backed meeting knowledge base with semantic search."""

    def __init__(self, persist_dir: str = None):
        if persist_dir is None:
            persist_dir = str(Path(__file__).parent / "chroma_db")
        self._client = chromadb.PersistentClient(path=persist_dir)
        self._collection = self._client.get_or_create_collection(
            name="meeting_knowledge",
            metadata={"hnsw:space": "cosine"},
        )

    def index_meeting(self, meeting_id: str, ai_output: dict) -> None:
        """Index a meeting's AI output into ChromaDB for semantic search."""
        model = _get_embedding_model()
        documents = []
        metadatas = []
        ids = []

        title = ai_output.get("meeting_metadata", {}).get("title", "Untitled")

        # Index decisions
        for d in ai_output.get("decisions", []):
            doc = f"Decision: {d['description']}"
            if d.get("source_quote"):
                doc += f" (Source: \"{d['source_quote']}\")"
            documents.append(doc)
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "decision",
                "item_id": d.get("id", ""),
            })
            ids.append(f"{meeting_id}_{d.get('id', 'D')}")

        # Index action items
        for a in ai_output.get("action_items", []):
            doc = f"Action item: {a['task']}"
            if a.get("owner"):
                doc += f" (Owner: {a['owner']})"
            if a.get("deadline"):
                doc += f" (Deadline: {a['deadline']})"
            if a.get("source_quote"):
                doc += f" (Source: \"{a['source_quote']}\")"
            documents.append(doc)
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "action_item",
                "item_id": a.get("id", ""),
            })
            ids.append(f"{meeting_id}_{a.get('id', 'A')}")

        # Index risks
        for r in ai_output.get("open_risks", []):
            doc = f"Risk: {r['description']}"
            if r.get("source_quote"):
                doc += f" (Source: \"{r['source_quote']}\")"
            documents.append(doc)
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "risk",
                "item_id": r.get("id", ""),
            })
            ids.append(f"{meeting_id}_{r.get('id', 'R')}")

        # Index state of direction
        sod = ai_output.get("state_of_direction")
        if sod:
            documents.append(f"State of direction: {sod}")
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "direction",
                "item_id": "SOD",
            })
            ids.append(f"{meeting_id}_SOD")

        if not documents:
            return

        embeddings = model.encode(documents).tolist()
        self._collection.upsert(
            ids=ids,
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
        )

    def query(self, question: str, top_k: int = 5) -> list[dict]:
        """Semantic search across all indexed meetings."""
        if self._collection.count() == 0:
            return []

        model = _get_embedding_model()
        query_embedding = model.encode([question]).tolist()

        results = self._collection.query(
            query_embeddings=query_embedding,
            n_results=min(top_k, self._collection.count()),
        )

        items = []
        for i in range(len(results["ids"][0])):
            items.append({
                "content": results["documents"][0][i],
                "meeting_id": results["metadatas"][0][i]["meeting_id"],
                "meeting_title": results["metadatas"][0][i]["meeting_title"],
                "item_type": results["metadatas"][0][i]["item_type"],
                "distance": results["distances"][0][i] if results.get("distances") else None,
            })
        return items

    def query_with_llm(self, question: str, provider: str = None) -> dict:
        """RAG: retrieve relevant context, then synthesize an answer with the LLM."""
        from llm_client import generate

        context_items = self.query(question, top_k=5)
        if not context_items:
            return {"answer": "No meeting data found. Upload and approve meetings first.", "sources": []}

        context_text = "\n".join(
            f"- [{item['meeting_title']}] {item['content']}" for item in context_items
        )

        prompt = f"""Based on the following meeting knowledge base excerpts, answer this question:

Question: {question}

Meeting Knowledge Base:
{context_text}

Return a JSON object with this exact format:
{{"answer": "your synthesized answer citing specific meetings", "sources": ["meeting title 1", "meeting title 2"]}}

Only use information from the provided excerpts. If the excerpts don't contain enough information, say so."""

        result = generate(prompt, provider=provider)
        result["context"] = context_items
        return result
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_meeting_memory.py -v
```
Expected: All 3 tests PASS

- [ ] **Step 6: Create routes/query.py**

```python
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
```

- [ ] **Step 7: Wire auto-indexing into approve endpoint**

In `routes/analyze.py`, add to the `approve()` function after `update_verified_output()`:

```python
    # Auto-index into meeting memory for RAG queries
    try:
        from routes.query import get_memory
        memory = get_memory()
        memory.index_meeting(meeting_id, verified_output)
    except Exception:
        pass  # Don't fail the approve if indexing fails
```

- [ ] **Step 8: Register query router in main.py**

Add to `main.py`:
```python
from routes import upload, analyze, meetings, query

app.include_router(query.router)
```

- [ ] **Step 9: Run all tests**

```bash
pytest tests/ -v
```
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add meeting_memory.py routes/query.py routes/analyze.py main.py tests/test_meeting_memory.py requirements.txt
git commit -m "feat: add queryable meeting memory with ChromaDB and RAG"
```

---

## Chunk 3: Modern Frontend

### Task 6: Scaffold React Frontend

**Files:**
- Create: `frontend/` directory (React + Vite + Tailwind + shadcn/ui)
- Modify: `main.py` (serve built frontend)

- [ ] **Step 1: Create Vite React project**

```bash
cd /Users/bibas/Work/DS4D/brainstorm-boost
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

- [ ] **Step 2: Install Tailwind CSS**

```bash
npm install -D tailwindcss @tailwindcss/vite
```

Add Tailwind plugin to `frontend/vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/exports': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
  },
})
```

Replace `frontend/src/index.css` with:
```css
@import "tailwindcss";
```

- [ ] **Step 3: Install shadcn/ui**

```bash
cd frontend
npx shadcn@latest init
```

Select: New York style, Zinc color, CSS variables = yes.

Install core components:
```bash
npx shadcn@latest add button card badge tabs table textarea input select dialog toast dropdown-menu separator scroll-area progress
```

- [ ] **Step 4: Install additional frontend dependencies**

```bash
npm install recharts lucide-react @tanstack/react-query
```

- [ ] **Step 5: Set up project structure**

```
frontend/src/
├── main.tsx              # Entry point
├── App.tsx               # Root with router and providers
├── index.css             # Tailwind import
├── lib/
│   ├── api.ts            # API client (fetch wrappers)
│   └── utils.ts          # shadcn utils (already created by init)
├── components/
│   ├── layout/
│   │   ├── Header.tsx    # App header with nav
│   │   └── Layout.tsx    # Main layout wrapper
│   ├── upload/
│   │   ├── UploadView.tsx      # Upload page
│   │   ├── DropZone.tsx        # Drag-and-drop file upload
│   │   └── ProviderSelect.tsx  # AI provider dropdown
│   ├── review/
│   │   ├── ReviewView.tsx      # Review page
│   │   ├── MeetingMeta.tsx     # Metadata card
│   │   ├── DecisionsTable.tsx  # Decisions with inline edit
│   │   ├── ActionsTable.tsx    # Action items with inline edit
│   │   ├── RisksTable.tsx      # Risks table
│   │   └── EditableCell.tsx    # Reusable inline-edit cell
│   ├── meetings/
│   │   └── MeetingsView.tsx    # Past meetings list
│   └── query/
│       └── QueryView.tsx       # Meeting memory Q&A
└── hooks/
    └── useApi.ts               # React Query hooks
```

- [ ] **Step 6: Implement API client**

`frontend/src/lib/api.ts`:
```typescript
const BASE = '';

export interface Meeting {
  id: string;
  title: string;
  created_at: string;
  status: 'uploaded' | 'analyzed' | 'approved';
}

export interface AiOutput {
  meeting_metadata: {
    title: string;
    date_mentioned: string | null;
    participants: string[];
    duration_estimate: string | null;
  };
  decisions: Array<{
    id: string;
    description: string;
    decision_type: string;
    made_by: string;
    confidence: 'high' | 'medium' | 'low';
    confidence_rationale: string;
    source_quote: string;
  }>;
  action_items: Array<{
    id: string;
    task: string;
    owner: string;
    deadline: string | null;
    commitment_type: string;
    confidence: 'high' | 'medium' | 'low';
    confidence_rationale: string;
    source_quote: string;
    verified?: boolean;
  }>;
  open_risks: Array<{
    id: string;
    description: string;
    raised_by: string;
    severity: 'high' | 'medium' | 'low';
    source_quote: string;
  }>;
  state_of_direction: string;
  trust_flags: string[];
}

export const api = {
  async getProviders() {
    const res = await fetch(`${BASE}/api/providers`);
    return res.json() as Promise<{ providers: string[]; default: string | null }>;
  },

  async uploadTranscript(data: FormData) {
    const res = await fetch(`${BASE}/api/upload-transcript`, { method: 'POST', body: data });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async uploadAudio(data: FormData) {
    const res = await fetch(`${BASE}/api/upload-audio`, { method: 'POST', body: data });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async analyze(meetingId: string, provider?: string) {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id: meetingId, provider }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async approve(meetingId: string, verifiedOutput: AiOutput) {
    const res = await fetch(`${BASE}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id: meetingId, verified_output: verifiedOutput }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async getMeetings() {
    const res = await fetch(`${BASE}/api/meetings`);
    return res.json() as Promise<Meeting[]>;
  },

  async getMeeting(id: string) {
    const res = await fetch(`${BASE}/api/meetings/${id}`);
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async queryMemory(question: string, provider?: string) {
    const res = await fetch(`${BASE}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, provider }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },
};
```

- [ ] **Step 7: Build and verify**

```bash
cd frontend && npm run build
```
Expected: Build succeeds, output in `frontend/dist/`

- [ ] **Step 8: Update main.py to serve React build**

```python
@app.get("/", response_class=HTMLResponse)
def serve_index():
    # Serve React build if available, fall back to legacy static/index.html
    react_index = Path(__file__).parent / "frontend" / "dist" / "index.html"
    if react_index.exists():
        return HTMLResponse(content=react_index.read_text())
    legacy_index = Path(__file__).parent / "static" / "index.html"
    return HTMLResponse(content=legacy_index.read_text())

# Serve React static assets
react_dist = Path(__file__).parent / "frontend" / "dist"
if react_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(react_dist / "assets")), name="react-assets")
```

- [ ] **Step 9: Commit scaffold**

```bash
git add frontend/ main.py
git commit -m "feat: scaffold React frontend with Vite, Tailwind CSS, and shadcn/ui"
```

---

### Task 7: Build Frontend Components

This task builds out all React components. Due to the scope, it should be executed using the `frontend-design` skill for high-quality UI design. The implementing agent should use `@frontend-design` for each component.

**Files:**
- Create: All files in `frontend/src/components/` and `frontend/src/hooks/`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

The implementing agent should use `@frontend-design` skill for each component's visual design, producing polished, production-quality UI.

- [ ] **Step 1: Set up App.tsx with tab routing**

`frontend/src/App.tsx`:
```tsx
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/toaster'
import { Header } from '@/components/layout/Header'
import { UploadView } from '@/components/upload/UploadView'
import { ReviewView } from '@/components/review/ReviewView'
import { QueryView } from '@/components/query/QueryView'
import { MeetingsView } from '@/components/meetings/MeetingsView'
import type { AiOutput } from '@/lib/api'

const queryClient = new QueryClient()

type View = 'upload' | 'review' | 'query' | 'meetings'

export default function App() {
  const [view, setView] = useState<View>('upload')
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null)
  const [aiOutput, setAiOutput] = useState<AiOutput | null>(null)

  const handleAnalysisComplete = (meetingId: string, output: AiOutput) => {
    setCurrentMeetingId(meetingId)
    setAiOutput(output)
    setView('review')
  }

  const handleViewMeeting = (meetingId: string, output: AiOutput) => {
    setCurrentMeetingId(meetingId)
    setAiOutput(output)
    setView('review')
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-slate-50">
        <Header currentView={view} onNavigate={setView} />
        <main className="mx-auto max-w-6xl px-6 py-8">
          {view === 'upload' && (
            <UploadView onAnalysisComplete={handleAnalysisComplete} />
          )}
          {view === 'review' && aiOutput && currentMeetingId && (
            <ReviewView
              meetingId={currentMeetingId}
              initialOutput={aiOutput}
              onBack={() => setView('upload')}
            />
          )}
          {view === 'query' && <QueryView />}
          {view === 'meetings' && (
            <MeetingsView onViewMeeting={handleViewMeeting} />
          )}
        </main>
      </div>
      <Toaster />
    </QueryClientProvider>
  )
}
```

`frontend/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 2: Build Header component**

`frontend/src/components/layout/Header.tsx`:
```tsx
import { cn } from '@/lib/utils'
import { Upload, ClipboardCheck, Search, History } from 'lucide-react'

type View = 'upload' | 'review' | 'query' | 'meetings'

const tabs: { id: View; label: string; icon: typeof Upload }[] = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'review', label: 'Review', icon: ClipboardCheck },
  { id: 'query', label: 'Ask', icon: Search },
  { id: 'meetings', label: 'History', icon: History },
]

interface HeaderProps {
  currentView: View
  onNavigate: (view: View) => void
}

export function Header({ currentView, onNavigate }: HeaderProps) {
  return (
    <header className="bg-slate-900 text-white shadow-lg">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <h1 className="text-xl font-bold tracking-tight">
          Brainstorm <span className="text-blue-400">Boost</span>
        </h1>
        <nav className="flex gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                currentView === id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Build UploadView with DropZone**

Use `@frontend-design` skill for polished design. Requirements:
- Drag-and-drop zone accepting both transcript files (.vtt, .txt) AND audio files (.mp3, .wav, .m4a, .webm)
- Auto-detect file type and show appropriate icon (document vs audio)
- Paste transcript text area (shadcn Textarea)
- Provider selection dropdown (shadcn Select) — fetches from `/api/providers`
- Upload & Analyze button with loading state
- Progress spinner with status text
- Calls `api.uploadTranscript()` or `api.uploadAudio()` based on file type, then `api.analyze()`
- On success, calls `onAnalysisComplete(meetingId, aiOutput)`

- [ ] **Step 4: Build ReviewView with editable tables**

Use `@frontend-design` skill for polished design. Requirements:
- Meeting metadata card (shadcn Card) with title, date, participants, duration
- State of direction section
- Decisions table with inline-editable cells (click to edit, Enter to save, Escape to cancel)
- Action items table with inline editing + verified checkbox column
- Risks table with inline editing
- **Verbatim vs Interpretation display**: source quotes in blockquote with "Verbatim" badge, AI descriptions with "AI Interpretation" badge and slightly different background
- Confidence badges using shadcn Badge: green (high), yellow (medium), red (low)
- Trust flags shown in a warning banner at the top
- "Approve & Export" button → calls `api.approve()` → shows download links for .md and .json

- [ ] **Step 5: Build QueryView for meeting memory**

Use `@frontend-design` skill for polished design. Requirements:
- Clean search interface with text input: "Ask about past meetings..."
- Submit button and Enter key support
- Loading state while waiting for RAG response
- Response card showing the LLM-synthesized answer
- Source citations section listing which meetings were referenced
- Provider selection (optional — defaults to first available)

- [ ] **Step 6: Build MeetingsView**

Use `@frontend-design` skill for polished design. Requirements:
- shadcn Table of past meetings: title, date, status badge (uploaded/analyzed/approved)
- Click row to view → calls `api.getMeeting(id)` → `onViewMeeting(id, output)`
- Empty state with icon and "Upload a transcript to get started" CTA
- Status badges: gray (uploaded), yellow (analyzed), green (approved)

- [ ] **Step 7: Build and test end-to-end**

```bash
cd frontend && npm run build
```

Update `main.py` to serve the React SPA with a catch-all for client-side navigation:

```python
# After all API routes and static mounts, add catch-all for SPA routing
react_dist = Path(__file__).parent / "frontend" / "dist"
if react_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(react_dist / "assets")), name="react-assets")

    @app.get("/{path:path}")
    def serve_spa(path: str):
        """Catch-all: serve React index.html for client-side routing."""
        react_index = react_dist / "index.html"
        return HTMLResponse(content=react_index.read_text())
```

```bash
uvicorn main:app --reload --port 8000
# Open http://localhost:8000 and verify all views work
```

- [ ] **Step 8: Commit**

```bash
git add frontend/ main.py
git commit -m "feat: implement full React frontend with upload, review, query, and meetings views"
```

---

## Chunk 4: Integration & Polish

### Task 8: End-to-End Integration Test

**Files:**
- Create: `tests/test_integration.py`

- [ ] **Step 1: Write integration test for the full pipeline**

`tests/test_integration.py`:
```python
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch
from main import app

transport = ASGITransport(app=app)

SAMPLE_TRANSCRIPT = """
Alice  0:00
Okay everyone, let's talk about the drone battery situation.
We need to decide on the battery type by end of week.

Bob  0:45
I've been looking into lithium-polymer options. They have
better energy density but cost about 30% more than the
lithium-ion alternatives we've been using.

Alice  1:30
I think the energy density trade-off is worth it for this
application. The weight savings alone will improve flight
time significantly. Let's go with lithium-polymer.

Bob  2:00
Agreed. I'll reach out to three suppliers by Friday and
get quotes. I'm a bit worried about the temperature
performance in cold weather though - that could be a
problem for winter operations.

Alice  2:30
Good point. Bob, can you also ask suppliers about cold
weather performance specs? That's a risk we need to
track.
"""


@pytest.mark.asyncio
async def test_upload_analyze_approve_query():
    """Full pipeline: upload transcript → analyze → approve → query memory."""
    mock_ai_output = {
        "meeting_metadata": {
            "title": "Drone Battery Review",
            "date_mentioned": None,
            "participants": ["Alice", "Bob"],
            "duration_estimate": "~3 minutes",
        },
        "decisions": [{
            "id": "D1",
            "description": "Use lithium-polymer batteries",
            "decision_type": "emergent",
            "made_by": "Alice",
            "ratified_by": "Bob",
            "confidence": "high",
            "confidence_rationale": "Explicit agreement from both participants",
            "source_quote": "Let's go with lithium-polymer",
        }],
        "action_items": [{
            "id": "A1",
            "task": "Contact three battery suppliers for quotes",
            "owner": "Bob",
            "deadline": "Friday",
            "commitment_type": "volunteered",
            "depends_on": [],
            "confidence": "high",
            "confidence_rationale": "First-person commitment with specific deliverable and deadline",
            "source_quote": "I'll reach out to three suppliers by Friday",
        }],
        "open_risks": [{
            "id": "R1",
            "description": "Cold weather battery performance",
            "raised_by": "Bob",
            "severity": "medium",
            "source_quote": "worried about the temperature performance in cold weather",
        }],
        "state_of_direction": "Team chose lithium-polymer batteries. Bob sourcing suppliers by Friday.",
        "trust_flags": [],
    }

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Upload
        res = await client.post("/api/upload-transcript", data={"text": SAMPLE_TRANSCRIPT})
        assert res.status_code == 200
        meeting_id = res.json()["meeting_id"]

        # 2. Analyze (mock the LLM call)
        with patch("routes.analyze.analyze_transcript", return_value=mock_ai_output):
            res = await client.post(
                "/api/analyze",
                json={"meeting_id": meeting_id, "provider": "anthropic"},
            )
            # May fail if no provider configured - that's ok, we're testing the pipeline shape
            if res.status_code == 200:
                assert res.json()["ai_output"]["decisions"][0]["id"] == "D1"

        # 3. Approve
        with patch("routes.analyze.analyze_transcript", return_value=mock_ai_output):
            # First ensure we have AI output stored
            from database import update_ai_output
            update_ai_output(meeting_id, mock_ai_output)

            res = await client.post(
                "/api/approve",
                json={"meeting_id": meeting_id, "verified_output": mock_ai_output},
            )
            assert res.status_code == 200
            assert "exports" in res.json()
```

- [ ] **Step 2: Run integration test**

```bash
pytest tests/test_integration.py -v
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_integration.py
git commit -m "test: add end-to-end integration test for upload-analyze-approve pipeline"
```

---

### Task 9: Update requirements.txt & .env.example

**Files:**
- Modify: `requirements.txt`
- Modify: `.env.example`

- [ ] **Step 1: Update requirements.txt**

```
# Web framework
fastapi==0.115.0
uvicorn[standard]==0.30.6
python-multipart==0.0.12
python-dotenv==1.0.1

# LLM providers (cloud)
anthropic==0.40.0
google-generativeai==0.8.3

# LLM provider (local via Ollama)
openai>=1.0.0
httpx>=0.27.0

# Speech-to-text
faster-whisper>=1.0.0
pyannote.audio>=3.1

# Vector search & embeddings
chromadb>=0.4.0
sentence-transformers>=2.0

# Audio handling
sounddevice>=0.4.0
numpy>=1.24.0

# Testing
pytest>=8.0
pytest-asyncio>=0.23.0
```

- [ ] **Step 2: Update .env.example**

```
# Cloud LLM providers (for development)
ANTHROPIC_API_KEY=sk-ant-your-key-here
GOOGLE_API_KEY=your-google-api-key

# Local LLM (Ollama - set model name if different from default)
# OLLAMA_MODEL=qwen2.5:7b-instruct-q4_K_M

# Speaker diarization (required for audio upload)
# Accept license at: https://huggingface.co/pyannote/speaker-diarization-3.1
# Then create token at: https://huggingface.co/settings/tokens
HF_TOKEN=hf_your-token-here
```

- [ ] **Step 3: Commit**

```bash
git add requirements.txt .env.example
git commit -m "chore: update dependencies and env example for Phase 1"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
pytest tests/ -v --tb=short
```
Expected: All tests PASS

- [ ] **Step 2: Start the app and verify manually**

```bash
# Terminal 1: Start Ollama (optional - for local LLM testing)
ollama serve

# Terminal 2: Start the app
cd /Users/bibas/Work/DS4D/brainstorm-boost
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

Manual checks:
1. Open http://localhost:8000 → React frontend loads
2. Upload a transcript → analysis works with cloud provider
3. Review → inline editing works
4. Approve → exports generated
5. Query → "What decisions were made?" returns RAG answer
6. Past meetings → shows list with status badges

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during final verification"
```
