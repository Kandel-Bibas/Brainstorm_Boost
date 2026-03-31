"""Eval harness for comparing local LLM models on meeting extraction.

Usage:
    # Compare models on all stored meetings:
    python eval_harness.py

    # Test a specific model:
    python eval_harness.py --model qwen2.5:7b-instruct-q4_K_M

    # Test multiple models:
    python eval_harness.py --model qwen2.5:7b --model mistral-nemo:12b --model phi4:14b

    # Limit to N meetings:
    python eval_harness.py --limit 2

    # Use a specific meeting:
    python eval_harness.py --meeting-id abc123
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

import httpx

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from database import get_connection, init_db
from extraction_pipeline import (
    chunk_transcript,
    normalize_transcript,
    parse_entity_response,
    ENTITY_PROMPT_LOCAL,
    ENTITY_SYSTEM_PROMPT,
)
from llm_client import _parse_json_response, OLLAMA_BASE_URL

LLM_BASE_URL = os.getenv("LOCAL_LLM_URL", OLLAMA_BASE_URL)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

RESULTS_DIR = Path(__file__).parent / "eval_results"


def get_available_models() -> list[str]:
    """List models available on the local LLM server (LM Studio or Ollama)."""
    # Try OpenAI-compatible endpoint (LM Studio + Ollama)
    try:
        resp = httpx.get(f"{LLM_BASE_URL}/v1/models", timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            return [m["id"] for m in data.get("data", []) if "embed" not in m["id"].lower()]
    except Exception:
        pass
    # Fallback: Ollama-specific
    try:
        resp = httpx.get(f"{LLM_BASE_URL}/api/tags", timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        pass
    return []


def get_meetings(limit: int = None, meeting_id: str = None) -> list[dict]:
    """Fetch meetings with transcripts from the database."""
    init_db()
    with get_connection() as conn:
        if meeting_id:
            rows = conn.execute(
                "SELECT id, title, raw_transcript, ai_output_json FROM meetings WHERE id = ?",
                (meeting_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, title, raw_transcript, ai_output_json FROM meetings "
                "WHERE raw_transcript IS NOT NULL AND length(raw_transcript) > 100 "
                "ORDER BY created_at DESC"
            ).fetchall()

        meetings = []
        for r in rows:
            ai_output = None
            if r["ai_output_json"]:
                try:
                    ai_output = json.loads(r["ai_output_json"]) if isinstance(r["ai_output_json"], str) else r["ai_output_json"]
                except (json.JSONDecodeError, TypeError):
                    pass
            meetings.append({
                "id": r["id"],
                "title": r["title"],
                "transcript": r["raw_transcript"],
                "existing_output": ai_output,
            })
            if limit and len(meetings) >= limit:
                break
    return meetings


def call_ollama(model: str, prompt: str, system_prompt: str) -> dict:
    """Call an Ollama model and return parsed JSON + timing."""
    start = time.time()
    try:
        resp = httpx.post(
            f"{LLM_BASE_URL}/v1/chat/completions",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.1,
            },
            timeout=600.0,
        )
        elapsed = time.time() - start
        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}: {resp.text[:500]}", "elapsed": elapsed, "raw": resp.text[:500]}

        data = resp.json()
        # Support both OpenAI format (LM Studio) and Ollama format
        if "choices" in data:
            text = data["choices"][0]["message"]["content"]
        else:
            text = data.get("message", {}).get("content", "")
        try:
            parsed = _parse_json_response(text)
            return {"parsed": parsed, "elapsed": elapsed, "raw": text[:500], "json_ok": True}
        except (ValueError, json.JSONDecodeError) as e:
            logger.warning("    Raw output: %s", text[:300])
            return {"error": f"JSON parse failed: {e}", "elapsed": elapsed, "raw": text[:500], "json_ok": False}
    except httpx.TimeoutException:
        return {"error": "Timeout (120s)", "elapsed": time.time() - start, "json_ok": False}
    except Exception as e:
        return {"error": str(e), "elapsed": time.time() - start, "json_ok": False}


def score_extraction(result: dict, existing: dict | None) -> dict:
    """Score an extraction result."""
    scores = {
        "json_ok": result.get("json_ok", False),
        "elapsed": result.get("elapsed", 0),
    }

    if not result.get("parsed"):
        scores["entity_count"] = 0
        scores["decisions"] = 0
        scores["action_items"] = 0
        scores["risks"] = 0
        scores["persons"] = 0
        scores["has_quotes"] = 0
        return scores

    entities = result["parsed"].get("entities", [])
    scores["entity_count"] = len(entities)

    by_type = {}
    for e in entities:
        t = e.get("type", "unknown")
        by_type.setdefault(t, []).append(e)

    scores["persons"] = len(by_type.get("person", []))
    scores["decisions"] = len(by_type.get("decision", []))
    scores["action_items"] = len(by_type.get("action_item", []))
    scores["risks"] = len(by_type.get("risk", []))

    # Count how many items have source quotes
    quote_types = ["decision", "action_item", "risk"]
    total_items = sum(len(by_type.get(t, [])) for t in quote_types)
    items_with_quotes = sum(
        1 for t in quote_types
        for e in by_type.get(t, [])
        if e.get("source_quote") or e.get("properties", {}).get("source_quote")
    )
    scores["has_quotes"] = items_with_quotes
    scores["quote_rate"] = (items_with_quotes / total_items * 100) if total_items > 0 else 0

    # Compare against existing output if available
    if existing:
        scores["existing_decisions"] = len(existing.get("decisions", []))
        scores["existing_actions"] = len(existing.get("action_items", []))
        scores["existing_risks"] = len(existing.get("open_risks", []))

    return scores


def run_eval(models: list[str], meetings: list[dict]) -> dict:
    """Run eval across models and meetings."""
    results = {}

    for model in models:
        logger.info("=" * 60)
        logger.info("Testing model: %s", model)
        logger.info("=" * 60)
        model_results = []

        for meeting in meetings:
            logger.info("  Meeting: %s (%d chars)", meeting["title"][:50], len(meeting["transcript"]))

            transcript = normalize_transcript(meeting["transcript"])
            chunks = chunk_transcript(transcript)
            # Test on first chunk only (for speed)
            chunk = chunks[0]

            prompt = ENTITY_PROMPT_LOCAL.format(chunk=chunk["text"])

            result = call_ollama(model, prompt, ENTITY_SYSTEM_PROMPT)
            scores = score_extraction(result, meeting.get("existing_output"))

            logger.info("    JSON OK: %s | Time: %.1fs | Entities: %d | D:%d A:%d R:%d | Quotes: %d/%d (%.0f%%)",
                        scores["json_ok"],
                        scores["elapsed"],
                        scores["entity_count"],
                        scores["decisions"],
                        scores["action_items"],
                        scores["risks"],
                        scores.get("has_quotes", 0),
                        scores["decisions"] + scores["action_items"] + scores["risks"],
                        scores.get("quote_rate", 0))

            if result.get("error"):
                logger.warning("    Error: %s", result["error"][:200])

            model_results.append({
                "meeting_id": meeting["id"],
                "meeting_title": meeting["title"],
                "scores": scores,
                "error": result.get("error"),
            })

        results[model] = model_results

    return results


def print_summary(results: dict):
    """Print a comparison table."""
    print("\n" + "=" * 80)
    print("EVAL SUMMARY")
    print("=" * 80)

    header = f"{'Model':<35} {'JSON%':>6} {'Time':>6} {'D':>4} {'A':>4} {'R':>4} {'Q%':>5}"
    print(header)
    print("-" * 80)

    for model, runs in results.items():
        n = len(runs)
        if n == 0:
            continue
        json_ok = sum(1 for r in runs if r["scores"]["json_ok"]) / n * 100
        avg_time = sum(r["scores"]["elapsed"] for r in runs) / n
        avg_d = sum(r["scores"]["decisions"] for r in runs) / n
        avg_a = sum(r["scores"]["action_items"] for r in runs) / n
        avg_r = sum(r["scores"]["risks"] for r in runs) / n
        avg_q = sum(r["scores"].get("quote_rate", 0) for r in runs) / n

        print(f"{model:<35} {json_ok:>5.0f}% {avg_time:>5.1f}s {avg_d:>4.1f} {avg_a:>4.1f} {avg_r:>4.1f} {avg_q:>4.0f}%")

    print("=" * 80)
    print("D=decisions, A=action items, R=risks, Q%=items with source quotes")


def main():
    parser = argparse.ArgumentParser(description="Eval harness for local LLM models")
    parser.add_argument("--model", action="append", help="Model(s) to test (can repeat)")
    parser.add_argument("--limit", type=int, default=None, help="Max meetings to test")
    parser.add_argument("--meeting-id", type=str, help="Test a specific meeting")
    parser.add_argument("--all-models", action="store_true", help="Test all locally available Ollama models")
    args = parser.parse_args()

    # Determine models to test
    if args.all_models:
        models = get_available_models()
        if not models:
            logger.error("No Ollama models found. Run 'ollama pull <model>' first.")
            sys.exit(1)
        logger.info("Found %d Ollama models: %s", len(models), ", ".join(models))
    elif args.model:
        models = args.model
    else:
        # Default: test whatever is configured
        default_model = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct-q4_K_M")
        available = get_available_models()
        if available:
            models = available
            logger.info("Testing all available models: %s", ", ".join(models))
        else:
            models = [default_model]

    # Get test data
    meetings = get_meetings(limit=args.limit, meeting_id=args.meeting_id)
    if not meetings:
        logger.error("No meetings found in database. Upload some transcripts first.")
        sys.exit(1)
    logger.info("Testing %d model(s) on %d meeting(s)", len(models), len(meetings))

    # Run eval
    results = run_eval(models, meetings)

    # Print summary
    print_summary(results)

    # Save results
    RESULTS_DIR.mkdir(exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    output_path = RESULTS_DIR / f"eval_{timestamp}.json"
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    logger.info("Results saved to %s", output_path)


if __name__ == "__main__":
    main()
