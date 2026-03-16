import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest


# Use a temp database for tests
@pytest.fixture(autouse=True)
def temp_db(monkeypatch, tmp_path):
    db_path = tmp_path / "test.db"
    monkeypatch.setattr("database.DB_PATH", db_path)
    from database import init_db
    init_db()
    yield db_path


@pytest.fixture(autouse=True)
def mock_embedding_model():
    """Mock SentenceTransformer to avoid HuggingFace downloads in tests."""
    mock_model = MagicMock()
    mock_model.encode = lambda texts, **kwargs: np.random.rand(
        len(texts) if isinstance(texts, list) else 1, 384
    ).astype(np.float32)

    with patch("embeddings.get_embedding_model", return_value=mock_model):
        yield mock_model


@pytest.fixture(autouse=True)
def reset_singletons():
    """Reset module-level singletons between tests."""
    import embeddings
    embeddings._model = None
    yield
    embeddings._model = None
