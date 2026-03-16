from __future__ import annotations

import json
import os
import re

import httpx
from dotenv import load_dotenv

load_dotenv()

_anthropic_client = None
_gemini_client = None

ANTHROPIC_MODEL = "claude-sonnet-4-5-20250514"
GEMINI_MODEL = "gemini-2.0-flash"
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct-q4_K_M")

RE_JSON_FENCE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?\s*```", re.DOTALL)

GENERAL_SYSTEM_PROMPT = """You are a helpful assistant that answers questions about meeting history.
You synthesize information from meeting excerpts and provide clear, accurate answers.
Always cite which meetings your answer is based on. Return responses as valid JSON."""

SYSTEM_PROMPT = """You are a meeting analyst. You extract decisions, commitments, risks, and coordination dependencies from meeting transcripts.

HOW DECISIONS FORM IN MEETINGS:
Most meeting decisions are EMERGENT, not declarative. They crystallize through a pattern:
  1. Someone proposes or raises an issue
  2. Discussion, questions, modifications
  3. Someone formulates a summary ("so what we're saying is...")
  4. Group ratifies — via explicit agreement, silence, or topic shift
The formulator shapes the decision. A topic change after a formulation is implicit ratification. Capture these emergent decisions, not just explicit announcements.

COMMITMENT LANGUAGE — what to listen for:
  Strong: First-person + specific verb + deliverable + timeframe ("I'll have it by Friday")
  Conditional: Qualifiers present ("I can probably...", "If X happens, I'll Y")
  Soft: Hedged ("I'll try to look into that", "Let me see")
  Social compliance: "Sure, yeah" without elaboration — agreement without real commitment
  Deflection: "We should think about...", "Let's circle back" — no actual owner or action

COORDINATION ITEMS — commitments BETWEEN people:
  Detected via: "once you [do X]", "after [person] finishes", "so that [person] can", "give me a heads-up", "send it to [person]"
  These create dependency chains. Each half may look like a separate task, but they fail at the handoff. Always capture both sides and link them.

CONFIDENCE CALIBRATION — specific signals:
  Raises confidence: first-person singular, specific deliverable, specific date, volunteered (not assigned)
  Lowers confidence: hedging words (might, could, probably, maybe, sort of), disfluency clusters (um, uh, false starts) near a commitment, self-corrections that downgrade ("I will — well, I'll try to..."), laughter after a commitment, passive voice ("that'll get done"), collective pronouns ("we should"), assigned by someone else rather than volunteered, "soft commitment" or similar qualifier
  Never default to "high" — use "high" only when multiple raising signals are present and no lowering signals exist.

CRITICAL RULES:
- Extract ONLY what the transcript supports. Never invent.
- Every extracted item MUST have a verbatim source_quote.
- If a field cannot be determined, use null — never guess.
- Prefer under-extraction over hallucination."""

OUTPUT_SCHEMA = """{
  "meeting_metadata": {
    "title": "string — inferred meeting topic",
    "date_mentioned": "string or null",
    "participants": ["list of speaker names found"],
    "duration_estimate": "string or null"
  },
  "decisions": [
    {
      "id": "D1",
      "description": "what was decided",
      "decision_type": "explicit | emergent",
      "made_by": "who formulated or announced it",
      "ratified_by": "who confirmed — names, 'group consensus', or 'no objection'",
      "confidence": "high | medium | low",
      "confidence_rationale": "one sentence explaining the rating",
      "source_quote": "verbatim quote from transcript"
    }
  ],
  "action_items": [
    {
      "id": "A1",
      "task": "what needs to be done",
      "owner": "who is responsible (or 'Unassigned')",
      "deadline": "stated deadline or null",
      "commitment_type": "volunteered | assigned | coordination",
      "depends_on": ["A2"],
      "confidence": "high | medium | low",
      "confidence_rationale": "one sentence citing specific linguistic signals",
      "source_quote": "verbatim quote from transcript"
    }
  ],
  "open_risks": [
    {
      "id": "R1",
      "description": "risk or concern raised",
      "raised_by": "who raised it",
      "severity": "high | medium | low",
      "source_quote": "verbatim quote from transcript"
    }
  ],
  "state_of_direction": "2-3 sentence summary of overall project direction and momentum",
  "trust_flags": [
    "list of strings noting quality issues or analysis caveats"
  ]
}"""

USER_PROMPT_TEMPLATE = """Analyze the following meeting transcript. Return ONLY valid JSON matching this schema (no markdown fencing, no extra text):
{schema}

ANALYSIS PROCESS — work through these stages in order:

STAGE 1 — PARTICIPANTS AND CONTEXT
Identify all speakers. Note the meeting's apparent purpose and any organizational context.

STAGE 2 — DECISION DETECTION
Scan for both explicit decisions ("we will do X") and emergent decisions. For emergent decisions, look for the pattern: issue raised -> discussion -> someone formulates a conclusion -> group ratifies (agreement, silence + topic change, or no objection). A date or approach that a group calculates together IS a decision, even though nobody said "I decide."

STAGE 3 — ACTION ITEM EXTRACTION
For each commitment:
  a. Identify the task, owner, and deadline.
  b. Classify: did the owner volunteer, or were they assigned by someone else? If the task creates a dependency between two people, mark it as coordination and fill depends_on.
  c. Rate confidence using specific signals from the transcript:
     - "I'll have it by Friday" with no hedging = high
     - "I can probably have it done" = medium (hedging)
     - "I'll try to get through it" + disfluency = low
     - Laughter after commitment, "soft commitment," "no pressure" = lower confidence
     - Passive voice or "we should" with no named owner = low or Unassigned

STAGE 4 — RISK IDENTIFICATION
Extract concerns, blockers, and potential failure points. Rate severity by business impact, not by how loudly someone raised it.

STAGE 5 — COORDINATION CHAIN REVIEW
Review all action items. Where one person's output is another person's input, add the dependency via depends_on. Common patterns: "once you finish X", "after [person] does Y", "give me a heads-up so I can", "send it to [person]".

STAGE 6 — SYNTHESIS
Write the state_of_direction summary. Add trust_flags for any transcript quality issues or analysis uncertainties.

TRANSCRIPT:
{transcript}"""


def _check_ollama_available() -> bool:
    """Check if Ollama is running and has at least one model."""
    try:
        resp = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2.0)
        return resp.status_code == 200
    except (httpx.ConnectError, httpx.TimeoutException):
        return False


def get_available_providers() -> list[str]:
    providers = []
    if os.getenv("ANTHROPIC_API_KEY"):
        providers.append("anthropic")
    if os.getenv("GOOGLE_API_KEY"):
        providers.append("gemini")
    if _check_ollama_available():
        providers.append("ollama")
    return providers


def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        import anthropic

        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY environment variable is not set")
        _anthropic_client = anthropic.Anthropic(api_key=api_key)
    return _anthropic_client


def _get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        import google.generativeai as genai

        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY environment variable is not set")
        genai.configure(api_key=api_key)
        _gemini_client = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            system_instruction=SYSTEM_PROMPT,
        )
    return _gemini_client


def _parse_json_response(text: str) -> dict:
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try stripping markdown fences
    m = RE_JSON_FENCE.search(text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    raise ValueError(f"Could not parse JSON from LLM response: {text[:200]}...")


def _format_transcript_for_prompt(utterances: list[dict]) -> str:
    lines = []
    for utt in utterances:
        speaker = utt.get("speaker", "Unknown")
        ts = utt.get("timestamp")
        prefix = f"[{ts}] " if ts else ""
        lines.append(f"{prefix}{speaker}: {utt['text']}")
    return "\n".join(lines)


def _analyze_with_anthropic(user_prompt: str, system_prompt: str = SYSTEM_PROMPT) -> dict:
    import anthropic

    client = _get_anthropic_client()

    # First attempt
    try:
        response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=8192,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = response.content[0].text
        return _parse_json_response(text)
    except (json.JSONDecodeError, ValueError):
        pass
    except anthropic.AuthenticationError:
        raise
    except anthropic.RateLimitError:
        raise
    except anthropic.APIError:
        raise

    # Retry with stricter prompt
    retry_prompt = (
        user_prompt
        + "\n\nIMPORTANT: Your previous response was not valid JSON. "
        "Return ONLY the JSON object, no markdown fencing, no explanation text."
    )
    try:
        response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=8192,
            system=system_prompt,
            messages=[{"role": "user", "content": retry_prompt}],
        )
        text = response.content[0].text
        return _parse_json_response(text)
    except (json.JSONDecodeError, ValueError) as e:
        raise ValueError(f"Anthropic returned invalid JSON after retry: {e}")


def _analyze_with_gemini(user_prompt: str, system_prompt: str = SYSTEM_PROMPT) -> dict:
    import google.generativeai as genai

    model = _get_gemini_client()

    # First attempt
    try:
        response = model.generate_content(user_prompt)
        text = response.text
        return _parse_json_response(text)
    except (json.JSONDecodeError, ValueError):
        pass
    except Exception as e:
        err_str = str(e).lower()
        if "api key" in err_str or "authentication" in err_str or "permission" in err_str:
            raise PermissionError(f"Gemini authentication error: {e}")
        if "quota" in err_str or "rate" in err_str or "resource" in err_str:
            raise ConnectionError(f"Gemini rate limit: {e}")
        raise RuntimeError(f"Gemini API error: {e}")

    # Retry with stricter prompt
    retry_prompt = (
        user_prompt
        + "\n\nIMPORTANT: Your previous response was not valid JSON. "
        "Return ONLY the JSON object, no markdown fencing, no explanation text."
    )
    try:
        response = model.generate_content(retry_prompt)
        text = response.text
        return _parse_json_response(text)
    except (json.JSONDecodeError, ValueError) as e:
        raise ValueError(f"Gemini returned invalid JSON after retry: {e}")


def _analyze_with_ollama(user_prompt: str, system_prompt: str = SYSTEM_PROMPT) -> dict:
    from openai import OpenAI

    client = OpenAI(base_url=f"{OLLAMA_BASE_URL}/v1", api_key="ollama")

    try:
        response = client.chat.completions.create(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
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
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": retry_prompt},
            ],
            temperature=0.0,
        )
        text = response.choices[0].message.content
        return _parse_json_response(text)
    except (json.JSONDecodeError, ValueError) as e:
        raise ValueError(f"Ollama returned invalid JSON after retry: {e}")


def analyze_transcript(utterances: list, provider: str = None) -> dict:
    available = get_available_providers()

    if provider and provider not in available:
        raise ValueError(f"Provider '{provider}' is not configured. Available: {available}")

    if not provider:
        if not available:
            raise ValueError("No LLM provider configured. Set ANTHROPIC_API_KEY or GOOGLE_API_KEY in .env")
        provider = available[0]

    transcript_text = _format_transcript_for_prompt(utterances)
    user_prompt = USER_PROMPT_TEMPLATE.format(schema=OUTPUT_SCHEMA, transcript=transcript_text)

    if provider == "anthropic":
        return _analyze_with_anthropic(user_prompt)
    elif provider == "gemini":
        return _analyze_with_gemini(user_prompt)
    elif provider == "ollama":
        return _analyze_with_ollama(user_prompt)
    else:
        raise ValueError(f"Unknown provider: {provider}")


def generate(prompt: str, provider: str = None, system_prompt: str = None) -> dict:
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

    effective_system = system_prompt if system_prompt is not None else GENERAL_SYSTEM_PROMPT

    if provider == "anthropic":
        return _analyze_with_anthropic(prompt, system_prompt=effective_system)
    elif provider == "gemini":
        return _analyze_with_gemini(prompt, system_prompt=effective_system)
    elif provider == "ollama":
        return _analyze_with_ollama(prompt, system_prompt=effective_system)
    else:
        raise ValueError(f"Unknown provider: {provider}")
