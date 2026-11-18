# backend/tunnel.py — optional HTTPS public link (Cloudflare quick tunnel)
"""Opt-in public URL for invited collaborators.

Uses `cloudflared tunnel --url` (a quick tunnel). No Cloudflare account is
required. If the program is not installed, the owner still has LAN access and
the UI explains what is missing. The tunnel only forwards to this machine;
sign-in still requires an invited account.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
from typing import Optional
from urllib.parse import urlparse

_URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.I)


def find_cloudflared() -> Optional[str]:
    return shutil.which("cloudflared")


class TunnelManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._proc: Optional[subprocess.Popen] = None
        self._url: Optional[str] = None
        self._error: Optional[str] = None
        self._reader: Optional[threading.Thread] = None

    def status(self) -> dict:
        with self._lock:
            running = self._proc is not None and self._proc.poll() is None
            if self._proc is not None and not running and not self._error:
                self._error = "The public link stopped."
                self._url = None
            return {
                "available": find_cloudflared() is not None,
                "running": running,
                "url": self._url if running else None,
                "error": self._error,
            }

    def hostname(self) -> Optional[str]:
        with self._lock:
            if not self._url or self._proc is None or self._proc.poll() is not None:
                return None
            host = urlparse(self._url).hostname
            return host.lower() if host else None

    def start(self, port: int = 8765, timeout: float = 20.0) -> dict:
        binary = find_cloudflared()
        if not binary:
            with self._lock:
                self._error = (
                    "cloudflared is not installed, so a public link cannot be started. "
                    "People on your home network can still use the LAN address."
                )
                self._url = None
            return self.status()
        self.stop()
        try:
            proc = subprocess.Popen(
                [binary, "tunnel", "--url", f"http://127.0.0.1:{int(port)}", "--no-autoupdate"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except Exception as exc:
            with self._lock:
                self._proc = None
                self._url = None
                self._error = f"Could not start the public link: {exc}"
            return self.status()
        with self._lock:
            self._proc = proc
            self._url = None
            self._error = None
        deadline = time.time() + timeout
        url = None
        while time.time() < deadline:
            if proc.poll() is not None:
                break
            line = ""
            if proc.stdout is not None:
                try:
                    line = proc.stdout.readline()
                except Exception:
                    line = ""
            if not line:
                time.sleep(0.1)
                continue
            match = _URL_RE.search(line)
            if match:
                url = match.group(0)
                break
        with self._lock:
            if url:
                self._url = url
                self._error = None
                self._reader = threading.Thread(target=self._drain, args=(proc,), daemon=True)
                self._reader.start()
            else:
                err = "The public link did not become ready."
                if proc.poll() is not None:
                    err = "cloudflared exited before a public link was ready."
                self._error = err
                self._url = None
                try:
                    proc.terminate()
                except Exception:
                    pass
                self._proc = None
        return self.status()

    def _drain(self, proc: subprocess.Popen) -> None:
        try:
            if proc.stdout is None:
                return
            for line in proc.stdout:
                match = _URL_RE.search(line or "")
                if match:
                    with self._lock:
                        self._url = match.group(0)
        except Exception:
            pass

    def stop(self) -> dict:
        with self._lock:
            proc = self._proc
            self._proc = None
            self._url = None
            self._error = None
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        return self.status()


_manager: Optional[TunnelManager] = None


def get_tunnel_manager() -> TunnelManager:
    global _manager
    if _manager is None:
        _manager = TunnelManager()
    return _manager


def set_tunnel_manager(manager: Optional[TunnelManager]) -> None:
    global _manager
    _manager = manager


def tunnel_visitor_ip(request) -> Optional[str]:
    """Real client IP when this request arrived through our quick tunnel.

    Cloudflared connects from this machine, so the TCP peer is loopback. We
    only trust the forwarding headers while the tunnel we started is running
    and the peer is loopback. A normal desktop request has no Cloudflare
    headers and stays the owner.
    """
    client = getattr(request, "client", None)
    peer = getattr(client, "host", "") if client else ""
    if peer not in ("127.0.0.1", "::1", "localhost"):
        return None
    host = get_tunnel_manager().hostname()
    if not host:
        return None
    headers = request.headers
    cf_ip = (headers.get("cf-connecting-ip") or "").strip()
    cf_ray = (headers.get("cf-ray") or "").strip()
    if not cf_ip or not cf_ray:
        return None
    # Ignore obviously local spoofed values.
    if cf_ip in ("127.0.0.1", "::1", "localhost"):
        return None
    return cf_ip


def trusted_public_host(host: Optional[str]) -> bool:
    if not host:
        return False
    name = host.split(":")[0].strip().lower()
    expected = get_tunnel_manager().hostname()
    return bool(expected) and name == expected


def public_origin_ok(origin: Optional[str]) -> bool:
    if not origin:
        return False
    try:
        parsed = urlparse(origin)
    except Exception:
        return False
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    return trusted_public_host(parsed.hostname)


def lan_ipv4_addresses() -> list:
    """IPv4 addresses of this machine, skipping loopback."""
    found = []
    seen = set()

    def add(ip: str) -> None:
        ip = (ip or "").strip()
        if not ip or ip in seen or ip.startswith("127.") or ":" in ip:
            return
        parts = ip.split(".")
        if len(parts) != 4:
            return
        try:
            if any(int(part) < 0 or int(part) > 255 for part in parts):
                return
        except ValueError:
            return
        seen.add(ip)
        found.append(ip)

    try:
        import socket
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("192.0.2.1", 80))
            add(probe.getsockname()[0])
        finally:
            probe.close()
    except Exception:
        pass
    try:
        out = subprocess.check_output(["hostname", "-I"], text=True, timeout=2)
        for part in out.split():
            add(part)
    except Exception:
        pass
    if not found and os.name == "nt":
        try:
            out = subprocess.check_output(["ipconfig"], text=True, timeout=3, errors="replace")
            for match in re.findall(r"IPv4[^:]*:\s*([0-9.]+)", out):
                add(match)
        except Exception:
            pass
    return found


def sidecar_port() -> int:
    try:
        return int(os.environ.get("TTO_PORT", "8765"))
    except ValueError:
        return 8765


def access_snapshot(lan_enabled: bool) -> dict:
    port = sidecar_port()
    urls = [f"http://{ip}:{port}" for ip in lan_ipv4_addresses()] if lan_enabled else []
    return {
        "lan_access": bool(lan_enabled),
        "port": port,
        "localhost_url": f"http://127.0.0.1:{port}",
        "lan_urls": urls,
        "tunnel": get_tunnel_manager().status(),
    }
