"""Ollama Client & Qwen Model Speed Benchmarking Engine.
Connects to local Ollama, discovers Qwen models, measures generation speeds (tokens/sec),
and manages local LLM inference.
"""

import errno
import http.client
import json
import os
import re
import socket
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional, Tuple
from pydantic import BaseModel, Field

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"


def configured_ollama_url() -> str:
    """Read OLLAMA_URL at call time. Default is IPv4 loopback, not the name localhost."""
    raw = (os.environ.get("OLLAMA_URL") or DEFAULT_OLLAMA_URL).strip()
    return (raw or DEFAULT_OLLAMA_URL).rstrip("/")


def candidate_origins(base_url: str) -> List[str]:
    """Dial addresses for one configured URL. localhost tries 127.0.0.1, then ::1."""
    text = base_url if "://" in (base_url or "") else f"http://{base_url}"
    parsed = urllib.parse.urlparse(text)
    host = (parsed.hostname or "127.0.0.1").lower()
    scheme = parsed.scheme or "http"
    port = parsed.port or (443 if scheme == "https" else 11434)
    if host == "localhost":
        return [f"{scheme}://127.0.0.1:{port}", f"{scheme}://[::1]:{port}"]
    if ":" in host:
        return [f"{scheme}://[{host}]:{port}"]
    return [f"{scheme}://{host}:{port}"]


def _no_proxy_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))

_PARAM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*b\b", re.IGNORECASE)


def _billions_from_text(text: str) -> Optional[float]:
    match = _PARAM_RE.search(text or "")
    if not match:
        return None
    return float(match.group(1))


def _format_size(size_b: int) -> str:
    if size_b <= 0:
        return ""
    size_gb = round(size_b / (1024**3), 2)
    if size_gb >= 1:
        return f"{size_gb} GB"
    return f"{round(size_b / (1024**2))} MB"


def _is_qwen_name(name: str, family: str = "") -> bool:
    return "qwen" in (name or "").lower() or "qwen" in (family or "").lower()


def _model_billions(model: "QwenModelBenchmark") -> Optional[float]:
    for source in (model.parameter_size, model.model_name):
        billions = _billions_from_text(source)
        if billions is not None:
            return billions
    return None


class QwenModelBenchmark(BaseModel):
    model_name: str
    size_bytes: int = 0
    size_formatted: str = ""
    parameter_size: str = ""
    quantization_level: str = ""
    is_qwen: bool = True
    is_fastest: bool = False
    is_agentic: bool = False
    eval_tok_per_sec: float = 0.0
    prompt_eval_tok_per_sec: float = 0.0
    total_duration_ms: float = 0.0
    load_duration_ms: float = 0.0
    eval_tokens: int = 0
    prompt_tokens: int = 0
    has_thinking: bool = False
    status: str = "ready"  # ready | benchmarked | failed


class OllamaProbe(BaseModel):
    ok: bool
    version: str = "unavailable"
    reason: str = "refused"  # ok | refused | timeout | http
    error: Optional[str] = None
    url: str = ""


def _failure_kind(exc: BaseException) -> str:
    """Map a socket error onto refused or timeout. Reset is retried like a timeout."""
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return "timeout"
    if isinstance(exc, ConnectionResetError):
        return "timeout"
    err_no = getattr(exc, "errno", None)
    if err_no in (errno.ETIMEDOUT, errno.EAGAIN, errno.ECONNRESET, errno.EPIPE):
        return "timeout"
    return "refused"


def loopback_http(
    origin: str,
    path: str,
    *,
    method: str = "GET",
    body: Optional[bytes] = None,
    connect_timeout: float = 0.4,
    read_timeout: float = 5.0,
    max_bytes: int = 256 * 1024,
) -> Tuple[int, bytes]:
    """One HTTP call on an already-resolved loopback origin. No proxy, no redirect."""
    parsed = urllib.parse.urlparse(origin)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    sock = socket.create_connection((host, port), timeout=connect_timeout)
    sock.settimeout(read_timeout)
    conn: http.client.HTTPConnection
    if parsed.scheme == "https":
        import ssl
        ctx = ssl.create_default_context()
        sock = ctx.wrap_socket(sock, server_hostname=host)
        conn = http.client.HTTPSConnection(host, port, timeout=read_timeout, context=ctx)
    else:
        conn = http.client.HTTPConnection(host, port, timeout=read_timeout)
    conn.sock = sock
    try:
        headers = {"Accept": "application/json", "Connection": "close"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        payload = resp.read(max_bytes)
        return resp.status, payload
    finally:
        conn.close()


class OllamaEngine:
    def __init__(
        self,
        base_url: Optional[str] = None,
        connect_timeout: float = 0.4,
        read_timeout: float = 5.0,
    ):
        self._explicit_base = base_url.rstrip("/") if base_url else None
        self.connect_timeout = connect_timeout
        self.read_timeout = read_timeout
        self.base_url = candidate_origins(self._explicit_base or configured_ollama_url())[0]
        self._cached_benchmarks: Dict[str, QwenModelBenchmark] = {}
        self._cache_lock = threading.Lock()
        self.last_inventory_error: Optional[str] = None
        self.last_probe: Optional[OllamaProbe] = None

    def _origins(self) -> List[str]:
        return candidate_origins(self._explicit_base or configured_ollama_url())

    def _get_version_once(self, origin: str) -> OllamaProbe:
        try:
            status, payload = loopback_http(
                origin,
                "/api/version",
                connect_timeout=self.connect_timeout,
                read_timeout=self.read_timeout,
            )
        except Exception as exc:
            kind = _failure_kind(exc)
            print(f"[OllamaEngine] version {kind} at {origin}: {exc}", flush=True)
            return OllamaProbe(ok=False, reason=kind, error=f"{type(exc).__name__}: {exc}", url=origin)
        if status != 200:
            print(f"[OllamaEngine] version HTTP {status} at {origin}", flush=True)
            return OllamaProbe(ok=False, reason="http", error=f"HTTP {status}", url=origin)
        try:
            data = json.loads(payload.decode() or "{}")
        except Exception as exc:
            return OllamaProbe(ok=False, reason="http", error=f"bad version json: {exc}", url=origin)
        version = str(data.get("version") or "unknown")
        return OllamaProbe(ok=True, version=version, reason="ok", error=None, url=origin)

    def probe(self) -> OllamaProbe:
        """One liveness result. Retries a timeout once. Does not retry connection refused."""
        origins = self._origins()
        failures: List[OllamaProbe] = []
        for origin in origins:
            result = self._get_version_once(origin)
            if not result.ok and result.reason == "timeout":
                result = self._get_version_once(origin)
            if result.ok:
                self.base_url = origin
                self.last_probe = result
                return result
            failures.append(result)
            if result.reason == "refused":
                continue
        chosen = next((item for item in failures if item.reason != "refused"), failures[0] if failures else None)
        if chosen is None:
            chosen = OllamaProbe(ok=False, reason="refused", error="no dial address", url=self.base_url)
        self.base_url = origins[0] if origins else self.base_url
        self.last_probe = chosen
        return chosen

    def is_available(self) -> bool:
        """True only when a completed version probe returned HTTP 200."""
        return self.probe().ok

    def get_version(self) -> str:
        """Ollama version string from one probe. Unavailable when the probe misses."""
        result = self.probe()
        return result.version if result.ok else "unavailable"

    def list_models(self) -> List[Dict[str, Any]]:
        """List installed models. A failure is recorded on last_inventory_error and returns []."""
        try:
            status, payload = loopback_http(
                self.base_url,
                "/api/tags",
                connect_timeout=self.connect_timeout,
                read_timeout=max(self.read_timeout, 4.0),
            )
            if status != 200:
                raise RuntimeError(f"HTTP {status}")
            data = json.loads(payload.decode() or "{}")
            self.last_inventory_error = None
            return data.get("models", [])
        except Exception as exc:
            self.last_inventory_error = f"{type(exc).__name__}: {exc}"
            print(f"[OllamaEngine] list_models failed: {exc}", flush=True)
            return []

    def get_installed_models(self) -> List[QwenModelBenchmark]:
        """Every model Ollama has installed, including non-Qwen tags."""
        installed: List[QwenModelBenchmark] = []
        for raw in self.list_models():
            name = raw.get("name") or raw.get("model") or ""
            if not name:
                continue
            details = raw.get("details") or {}
            family = details.get("family") or ""
            name_lower = name.lower()
            caps = raw.get("capabilities") or []
            has_thinking = "thinking" in caps or "agentic" in name_lower or "thinking" in name_lower
            size_b = int(raw.get("size") or 0)
            with self._cache_lock:
                cached = self._cached_benchmarks.get(name)
            if cached:
                bench = cached
                bench.size_bytes = size_b or bench.size_bytes
                bench.size_formatted = _format_size(bench.size_bytes)
                bench.parameter_size = bench.parameter_size or details.get("parameter_size", "")
                bench.quantization_level = bench.quantization_level or details.get("quantization_level", "")
                bench.is_qwen = _is_qwen_name(name, family)
                bench.is_agentic = bench.is_agentic or has_thinking
                bench.has_thinking = bench.has_thinking or has_thinking
            else:
                bench = QwenModelBenchmark(
                    model_name=name,
                    size_bytes=size_b,
                    size_formatted=_format_size(size_b),
                    parameter_size=details.get("parameter_size", ""),
                    quantization_level=details.get("quantization_level", ""),
                    is_qwen=_is_qwen_name(name, family),
                    is_agentic=has_thinking,
                    has_thinking=has_thinking,
                )
            installed.append(bench)

        benchmarked = [b for b in installed if b.eval_tok_per_sec > 0]
        if benchmarked:
            fastest = max(benchmarked, key=lambda b: b.eval_tok_per_sec)
            for b in installed:
                b.is_fastest = b.model_name == fastest.model_name
        return installed

    def get_qwen_models(self) -> List[QwenModelBenchmark]:
        """Installed Ollama models whose name or family is Qwen."""
        return [m for m in self.get_installed_models() if m.is_qwen]

    def benchmark_model(self, model_name: str, prompt: str = "Say hello in one word") -> QwenModelBenchmark:
        """Run a micro-benchmark on a model to measure prompt eval and generation speeds."""
        payload = {
            "model": model_name,
            "prompt": prompt,
            "stream": False,
            "options": {
                "num_predict": 15,
                "temperature": 0.0,
            }
        }

        try:
            req = urllib.request.Request(
                f"{self.base_url}/api/generate",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            t0 = time.time()
            with _no_proxy_opener().open(req, timeout=35) as resp:
                elapsed_client_ms = (time.time() - t0) * 1000
                res_data = json.loads(resp.read().decode())

            total_ns = res_data.get("total_duration", 0)
            load_ns = res_data.get("load_duration", 0)
            prompt_eval_ns = res_data.get("prompt_eval_duration", 0)
            prompt_count = res_data.get("prompt_eval_count", 0)
            eval_ns = res_data.get("eval_duration", 0)
            eval_count = res_data.get("eval_count", 0)
            has_thinking = bool(res_data.get("thinking"))

            # Calculate speeds
            eval_speed = (eval_count / eval_ns * 1e9) if eval_ns > 0 else 0.0
            prompt_speed = (prompt_count / prompt_eval_ns * 1e9) if prompt_eval_ns > 0 else 0.0

            models_meta = {m.get("name"): m for m in self.list_models()}
            meta = models_meta.get(model_name, {})
            details = meta.get("details", {})

            size_b = int(meta.get("size") or 0)
            family = (details.get("family") or "")
            name_lower = model_name.lower()

            bench = QwenModelBenchmark(
                model_name=model_name,
                size_bytes=size_b,
                size_formatted=_format_size(size_b),
                parameter_size=details.get("parameter_size", ""),
                quantization_level=details.get("quantization_level", ""),
                is_qwen=_is_qwen_name(model_name, family),
                is_agentic=has_thinking or "agentic" in name_lower or "thinking" in name_lower,
                eval_tok_per_sec=round(eval_speed, 1),
                prompt_eval_tok_per_sec=round(prompt_speed, 1),
                total_duration_ms=round(total_ns / 1e6 if total_ns > 0 else elapsed_client_ms, 1),
                load_duration_ms=round(load_ns / 1e6, 1),
                eval_tokens=eval_count,
                prompt_tokens=prompt_count,
                has_thinking=has_thinking,
                status="benchmarked",
            )
            with self._cache_lock:
                self._cached_benchmarks[model_name] = bench
            return bench

        except Exception as exc:
            print(f"[OllamaEngine] Benchmark failed for {model_name}: {exc}", flush=True)
            return QwenModelBenchmark(
                model_name=model_name,
                status="failed",
            )

    def benchmark_all_qwen_models(self) -> List[QwenModelBenchmark]:
        """Run benchmark across all installed Qwen models."""
        models = self.get_qwen_models()
        results: List[QwenModelBenchmark] = []
        for m in models:
            bench = self.benchmark_model(m.model_name)
            results.append(bench)

        if results:
            successful = [r for r in results if r.eval_tok_per_sec > 0]
            if successful:
                fastest = max(successful, key=lambda r: r.eval_tok_per_sec)
                for r in results:
                    r.is_fastest = (r.model_name == fastest.model_name)
        return results

    def select_optimal_model(
        self,
        strategy: str = "fastest",
        installed: Optional[List[QwenModelBenchmark]] = None,
        hardware: Optional[Any] = None,
    ) -> str:
        """Pick an installed model for this laptop.

        An explicit empty list returns "" and does not query Ollama.
        `hardware.safe_max_model_bytes` is a ceiling: larger tags stay
        installed but are not chosen. Fastest uses measured tok/s when any
        eligible model has been benchmarked, otherwise the smallest parameter
        tier that fits. Reasoning prefers an agentic model near
        `hardware.recommended_model_tier`.
        """
        if installed is None:
            models = self.get_installed_models()
        else:
            models = list(installed)
        if not models:
            return ""

        safe_max = 0
        tier = "7b"
        if hardware is not None:
            safe_max = int(getattr(hardware, "safe_max_model_bytes", 0) or 0)
            tier = str(getattr(hardware, "recommended_model_tier", "") or "7b")

        def fits(model: QwenModelBenchmark) -> bool:
            if safe_max <= 0 or model.size_bytes <= 0:
                return True
            return model.size_bytes <= safe_max

        eligible = [m for m in models if fits(m)]
        if not eligible:
            eligible = [min(models, key=lambda m: m.size_bytes or 10**18)]

        if strategy == "reasoning":
            agentic = [
                m for m in eligible
                if m.is_agentic or "agentic" in m.model_name.lower() or "thinking" in m.model_name.lower()
            ]
            pool = agentic or eligible
            target = _billions_from_text(tier) or 7.0

            def reasoning_key(model: QwenModelBenchmark):
                billions = _model_billions(model)
                distance = abs(billions - target) if billions is not None else 10**6
                return (distance, -(model.size_bytes or 0), model.model_name)

            return min(pool, key=reasoning_key).model_name

        benchmarked = [m for m in eligible if m.eval_tok_per_sec > 0]
        if benchmarked:
            return max(benchmarked, key=lambda m: m.eval_tok_per_sec).model_name

        def fastest_key(model: QwenModelBenchmark):
            billions = _model_billions(model)
            name = model.model_name.lower()
            coder = 0 if ("coder" in name or "code" in name) else 1
            qwen = 0 if model.is_qwen or "qwen" in name else 1
            return (
                billions if billions is not None else 10**6,
                coder,
                qwen,
                model.size_bytes or 0,
                name,
            )

        return min(eligible, key=fastest_key).model_name

    def generate_chat(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 4096,
        timeout_seconds: int = 120,
    ) -> Dict[str, Any]:
        """Execute chat inference with full prompt and return text + reasoning."""
        if model.lower().startswith("ollama/"):
            model = model.split("/", 1)[1]
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            }
        }

        req = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        t0 = time.time()
        try:
            with _no_proxy_opener().open(req, timeout=timeout_seconds) as resp:
                elapsed_ms = (time.time() - t0) * 1000
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as err:
            err_body = err.read().decode() if err.fp else str(err)
            raise RuntimeError(f"Ollama API HTTP {err.code}: {err_body}")
        except Exception as exc:
            raise RuntimeError(f"Failed to query Ollama at {self.base_url}: {exc}")

        msg = data.get("message", {})
        content = msg.get("content", "")
        thinking = msg.get("thinking") or ""
        eval_count = data.get("eval_count", 0)
        eval_ns = data.get("eval_duration", 0)
        eval_tok_per_sec = round((eval_count / eval_ns * 1e9), 1) if eval_ns > 0 else 0.0

        return {
            "model": model,
            "content": content,
            "thinking": thinking,
            "eval_count": eval_count,
            "eval_tok_per_sec": eval_tok_per_sec,
            "duration_ms": round(elapsed_ms, 1),
        }


def ollama_profile_section(engine: OllamaEngine) -> Dict[str, Any]:
    """One probe, then inventory only when that probe is up.

    A down daemon does not call get_installed_models. A tags failure after a
    live probe keeps available true and records models_status failed.
    """
    probe = engine.probe()
    models: List[QwenModelBenchmark] = []
    inventory_error = None
    models_status = "skipped"
    if probe.ok:
        models = engine.get_installed_models()
        inventory_error = engine.last_inventory_error
        if inventory_error:
            models_status = "failed"
            models = []
        elif not models:
            models_status = "empty"
        else:
            models_status = "listed"
    return {
        "ollama": {
            "available": probe.ok,
            "version": probe.version if probe.ok else "unavailable",
            "url": probe.url or engine.base_url,
            "reason": probe.reason,
            "error": probe.error,
        },
        "models": models,
        "models_status": models_status,
        "inventory_error": inventory_error,
    }
