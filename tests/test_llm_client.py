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
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    with patch("llm_client._check_ollama_available", return_value=True):
        providers = get_available_providers()
        assert "gemini" in providers
        assert "ollama" in providers


def test_get_available_providers_ollama_down(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    with patch("llm_client._check_ollama_available", return_value=False):
        providers = get_available_providers()
        assert providers == []
