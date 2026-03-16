from __future__ import annotations

import torch
from sentence_transformers import SentenceTransformer

_model = None


def _get_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def get_embedding_model() -> SentenceTransformer:
    global _model
    if _model is None:
        device = _get_device()
        _model = SentenceTransformer("all-MiniLM-L6-v2", device=device)
    return _model
