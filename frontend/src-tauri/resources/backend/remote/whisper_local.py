# ── Voice → text (Whisper, 100% local, no more Discord-typing needed) ──
import os, tempfile, shutil
_ffmpeg = shutil.which("ffmpeg")
_whisper = None  # set lazily: faster-whisper if importable, else ollama whisper

def _transcribe_audio(path: str) -> str:
    """Transcribe a voice message (opus-encoded .ogg from Discord) to text.
    Completely local — runs Whisper via faster-whisper when present, else
    routes to a local ollama whisper server. No cloud, no keys.
    """
    global _whisper
    if _whisper is None:
        try:
            from faster_whisper import WhisperModel
            _whisper = ("fw", WhisperModel("small", device="cpu", compute_type="int8"))
        except Exception:
            _whisper = ("ollama", None)  # fall through to ollama whisper
    engine, model = _whisper

    if engine == "fw" and model is not None:
        segments, _ = model.transcribe(path, language=None, vad_filter=True)
        return " ".join(seg.text.strip() for seg in segments).strip()

    # ollama whisper fallback (local, same box — no cloud)
    try:
        r = _post_ollama_audio(path)
        if r:
            return r.strip()
    except Exception:
        pass
    return ""

def _post_ollama_audio(path: str) -> str:
    """POST the audio to a local ollama whisper model and return text."""
    import urllib.request
    apis = ["http://127.0.0.1:11434/api/generate"]
    # whisper needs the full file; ollama whisper accepts base64 in prompt
    b64 = _base64_file(path)
    body = (
        '{"model":"whisper","prompt":"transcribe this audio","media":["data:'
        'audio/ogg;base64,' + b64 + '"],"stream":false}'
    ).encode("utf-8")
    for api in apis:
        try:
            req = urllib.request.Request(api, data=body, headers={"Content-Type":"application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                import json
                j = json.loads(r.read().decode("utf-8", "replace"))
                return (j.get("response") or "").strip()
        except Exception:
            continue
    return ""

def _base64_file(path: str) -> str:
    import base64
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")
