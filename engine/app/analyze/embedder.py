"""One embedder for the KB and live queries (README: same settings for both).

Backends (EMBED_BACKEND): "gemini" (default; gemini-embedding-2, 768d) or "hash" (offline, deterministic,
for tests/CI only). Vectors from different backends must never be mixed; the backend is stored in the
embedding manifest and checked by ml/indexing/build_index.py.
"""
from __future__ import annotations

import hashlib
import os
import re
import time

import numpy as np

EMBED_MODEL = os.getenv("EMBED_MODEL", "gemini-embedding-2")
EMBED_DIM = int(os.getenv("EMBED_DIM", "768"))
BACKEND = os.getenv("EMBED_BACKEND", "gemini")
MAX_CHARS = 8000  # keep requests bounded; tickets are far shorter


def _unit(m: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(m, axis=1, keepdims=True)
    return (m / np.clip(n, 1e-12, None)).astype(np.float32)


class HashEmbedder:
    """Word + char-trigram feature hashing into EMBED_DIM; not semantic, but stable and offline."""
    name = "hash"

    def __init__(self, dim: int = EMBED_DIM):
        self.dim = dim

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        t = text.lower()
        feats = re.findall(r"\w+", t) + [t[i:i + 3] for i in range(max(len(t) - 2, 0))]
        for f in feats:
            h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "little")
            v[h % self.dim] += 1.0 if (h >> 63) & 1 else -1.0
        return v

    def embed(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), np.float32)
        return _unit(np.stack([self._vec(t) for t in texts]))


class GeminiEmbedder:
    name = "gemini"

    def __init__(self, dim: int = EMBED_DIM, model: str = EMBED_MODEL, batch: int = 100):
        from google import genai  # lazy: not needed for the hash backend
        self.client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        self.dim, self.model, self.batch = dim, model, batch

    def _call(self, chunk: list[str]) -> np.ndarray:
        from google.genai import types
        for attempt in range(6):
            try:
                r = self.client.models.embed_content(
                    model=self.model, contents=chunk,
                    config=types.EmbedContentConfig(output_dimensionality=self.dim))
                return np.array([e.values for e in r.embeddings], dtype=np.float32)
            except Exception:
                if attempt == 5:
                    raise
                time.sleep(min(2 ** attempt, 30))  # quota / transient errors

    def embed(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), np.float32)
        out = [self._call([t[:MAX_CHARS] or " " for t in texts[i:i + self.batch]])
               for i in range(0, len(texts), self.batch)]
        return _unit(np.vstack(out))  # truncated (MRL) vectors must be re-normalised


def get_embedder(backend: str | None = None):
    backend = backend or BACKEND
    return HashEmbedder() if backend == "hash" else GeminiEmbedder()
