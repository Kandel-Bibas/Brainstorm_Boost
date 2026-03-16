# Brainstorm Boost

AI-powered meeting intelligence: transcript in, structured decisions/actions/risks out.

## Prerequisites

- Python 3.11+
- An [Anthropic API key](https://console.anthropic.com/)

## Setup

```bash
cd brainstorm-boost
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your real ANTHROPIC_API_KEY
```

## Run

```bash
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000

## Supported Transcript Formats

- **Teams WebVTT** — WEBVTT files with `<v Speaker>` voice tags
- **Zoom VTT** — Arrow timestamps with `Speaker: text` lines
- **Otter.ai plain text** — `Speaker Name  HH:MM` followed by text
- **Narrative / plain text** — Unstructured text (no speaker labels)

## What It Does

1. **Upload** a meeting transcript (file or pasted text)
2. **AI Analysis** — Claude extracts decisions, action items, risks, and metadata
3. **Human Review** — Edit any field inline, verify action items
4. **Export** — Approve to generate `.md` and `.json` exports

## What It Doesn't Do (Yet)

- Multi-user collaboration
- Calendar/email integration
