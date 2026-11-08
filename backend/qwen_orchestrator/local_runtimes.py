"""Local model servers that are already running on this machine.

Probes are GET-only, loopback-only, and short. Nothing is pulled or loaded.
"""

from __future__ import annotations

import json
import os
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel

from .ollama_engine import loopback_http


class RuntimeRow(BaseModel):
    runtime: str
    base_url: str
    models: List[str] = []
    latency_ms: float = 0.0
    error: Optional[str] = None


def _loopback_host(url: str) -> bool:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    return host in {"127.0.0.1", "localhost", "::1"}


def _prefs_path() -> Path:
    override = (os.environ.get("QWEN_PREFS_PATH") or "").strip()
    if override:
        return Path(override)
    return Path.home() / ".DPO" / "qwen_prefs.json"


def read_prefs() -> Dict[str, str]:
    path = _prefs_path()
    try:
        data = json.loads(path.read_text())
    except Exception:
        return {"runtime": "", "model": ""}
    if not isinstance(data, dict):
        return {"runtime": "", "model": ""}
    return {
        "runtime": str(data.get("runtime") or ""),
        "model": str(data.get("model") or ""),
    }


def write_prefs(runtime: str, model: str) -> Dict[str, str]:
    path = _prefs_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"runtime": runtime.strip(), "model": model.strip()}
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload))
    tmp.replace(path)
    return payload


def _row(runtime: str, base_url: str, models: List[str], started: float, error: Optional[str]) -> RuntimeRow:
    return RuntimeRow(
        runtime=runtime,
        base_url=base_url,
        models=models,
        latency_ms=round((time.time() - started) * 1000, 1),
        error=error,
    )


def _get_json(base_url: str, path: str) -> Any:
    if not _loopback_host(base_url):
        raise RuntimeError("non-loopback")
    status, payload = loopback_http(base_url, path, connect_timeout=0.4, read_timeout=1.5)
    if status != 200:
        raise RuntimeError(f"HTTP {status}")
    return json.loads(payload.decode() or "{}")


def lmstudio_chat_models(data: Any) -> List[str]:
    """Loaded chat ids only. A not-loaded catalog entry is not a selectable model."""
    models: List[str] = []
    entries = data.get("data") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        return models
    for item in entries:
        if not isinstance(item, dict):
            continue
        if str(item.get("state") or "") != "loaded":
            continue
        kind = str(item.get("type") or item.get("compatibility_type") or "").lower()
        if "embed" in kind:
            continue
        name = str(item.get("id") or "").strip()
        if name:
            models.append(name)
    return models


def _probe_lmstudio(base_url: str = "http://127.0.0.1:1234") -> RuntimeRow:
    started = time.time()
    try:
        data = _get_json(base_url, "/api/v0/models")
    except Exception as exc:
        return _row("lmstudio", base_url, [], started, f"{type(exc).__name__}: {exc}")
    return _row("lmstudio", base_url, lmstudio_chat_models(data), started, None)


def _probe_openai_server(runtime: str, base_url: str, health_path: str) -> RuntimeRow:
    started = time.time()
    try:
        if not _loopback_host(base_url):
            raise RuntimeError("non-loopback")
        status, _payload = loopback_http(base_url, health_path, connect_timeout=0.4, read_timeout=1.5)
        if status != 200:
            raise RuntimeError(f"HTTP {status}")
        listed = _get_json(base_url, "/v1/models")
    except Exception as exc:
        return _row(runtime, base_url, [], started, f"{type(exc).__name__}: {exc}")
    models: List[str] = []
    entries = listed.get("data") if isinstance(listed, dict) else None
    if isinstance(entries, list):
        for item in entries:
            if isinstance(item, dict):
                name = str(item.get("id") or "").strip()
            else:
                name = str(item or "").strip()
            if name:
                models.append(name)
    return _row(runtime, base_url, models, started, None)


def discover_local_runtimes(ollama_section: Optional[Dict[str, Any]] = None) -> List[RuntimeRow]:
    """Ollama row comes from the profile probe. Other servers are probed in parallel."""
    rows: List[RuntimeRow] = []
    if ollama_section is not None:
        ollama = ollama_section.get("ollama") or {}
        available = bool(ollama.get("available"))
        names = []
        if available:
            for model in ollama_section.get("models") or []:
                name = getattr(model, "model_name", None) or (model.get("model_name") if isinstance(model, dict) else "")
                if name:
                    names.append(name)
        rows.append(RuntimeRow(
            runtime="ollama",
            base_url=str(ollama.get("url") or "http://127.0.0.1:11434"),
            models=names,
            latency_ms=0.0,
            error=None if available else (ollama.get("error") or ollama.get("reason") or "down"),
        ))

    jobs: List[Callable[[], RuntimeRow]] = [
        _probe_lmstudio,
        lambda: _probe_openai_server("llamacpp", "http://127.0.0.1:8080", "/health"),
        lambda: _probe_openai_server("vllm", "http://127.0.0.1:8000", "/health"),
    ]
    found: Dict[str, RuntimeRow] = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for row in pool.map(lambda fn: fn(), jobs):
            found[row.runtime] = row
    for name in ("lmstudio", "llamacpp", "vllm"):
        if name in found:
            rows.append(found[name])
    return rows


def chat_completions(
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.1,
    max_tokens: int = 3000,
    timeout_seconds: float = 120,
) -> Dict[str, Any]:
    """OpenAI-compatible chat on a loopback server that already answered a probe."""
    if not _loopback_host(base_url):
        raise RuntimeError(f"Refusing non-loopback model server {base_url}")
    payload = json.dumps({
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }).encode("utf-8")
    status, body = loopback_http(
        base_url.rstrip("/"),
        "/v1/chat/completions",
        method="POST",
        body=payload,
        connect_timeout=0.4,
        read_timeout=timeout_seconds,
        max_bytes=2 * 1024 * 1024,
    )
    if status != 200:
        raise RuntimeError(f"HTTP {status}: {body[:300]!r}")
    data = json.loads(body.decode() or "{}")
    choices = data.get("choices") or []
    message = (choices[0].get("message") or {}) if choices else {}
    content = message.get("content") or ""
    return {"model": model, "content": content, "thinking": "", "eval_tok_per_sec": 0}
