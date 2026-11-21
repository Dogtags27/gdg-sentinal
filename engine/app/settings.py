"""Engine settings, read from environment variables (and .env in the repo root).

Every variable is listed in infra/env.template. Nothing here raises when a value is
missing: the engine boots, reports what is not configured in /healthz, and degrades.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_dotenv(path: Path) -> bool:
    if not path.exists():
        return False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.split(" #", 1)[0].strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)
    return True


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None or v == "" else v.strip().lower() in {"1", "true", "yes", "on"}


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name) or default)
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name) or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str
    embed_model: str
    embed_dim: int
    gen_model: str
    llm_timeout_s: float
    gemini_concurrency: int

    redis_url: str
    redis_chunk_index: str
    redis_chunk_prefix: str
    redis_queue_prefix: str
    update_queried_count: bool

    r2_endpoint: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket: str
    artifact_version: str
    artifact_cache: Path
    sync_artifacts: bool

    policy_path: Path

    @property
    def llm_configured(self) -> bool:
        return bool(self.gemini_api_key and self.gen_model)

    @property
    def r2_configured(self) -> bool:
        return all((self.r2_endpoint, self.r2_access_key_id, self.r2_secret_access_key, self.r2_bucket)) and "<" not in self.r2_endpoint


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    load_dotenv(ROOT / ".env")
    e = os.environ.get
    return Settings(
        gemini_api_key=e("GEMINI_API_KEY", ""),
        embed_model=e("EMBED_MODEL") or "gemini-embedding-2",
        embed_dim=_int("EMBED_DIM", 768),
        gen_model=e("GEN_MODEL", ""),
        llm_timeout_s=_float("LLM_TIMEOUT_S", 8.0),
        gemini_concurrency=_int("GEMINI_CONCURRENCY", 8),
        redis_url=e("REDIS_URL", ""),
        redis_chunk_index=e("REDIS_CHUNK_INDEX") or "idx:chunks",
        redis_chunk_prefix=e("REDIS_CHUNK_PREFIX") or "chunk:",
        redis_queue_prefix=e("REDIS_QUEUE_PREFIX") or "queue:",
        update_queried_count=_bool("UPDATE_QUERIED_COUNT", True),
        r2_endpoint=e("R2_ENDPOINT", ""),
        r2_access_key_id=e("R2_ACCESS_KEY_ID", ""),
        r2_secret_access_key=e("R2_SECRET_ACCESS_KEY", ""),
        r2_bucket=e("R2_BUCKET", ""),
        artifact_version=e("ARTIFACT_VERSION") or "v1",
        artifact_cache=Path(e("ARTIFACT_CACHE") or ROOT / ".cache" / "artifacts"),
        sync_artifacts=_bool("SYNC_ARTIFACTS", True),
        policy_path=Path(e("POLICY_PATH") or ROOT / "engine" / "config" / "policy.yaml"),
    )
