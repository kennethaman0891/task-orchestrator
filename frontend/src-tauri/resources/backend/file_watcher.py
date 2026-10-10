"""File watcher module for tto-web backend.

Monitors workspace directories for file changes and broadcasts events
via WebSocket to connected frontend clients.
"""
import asyncio
import os
from pathlib import Path
from typing import Callable, Dict, Optional, Set

# Directories to skip during scanning (avoid node_modules, .git, etc.)
EXCLUDED_DIRS = {'.git', '.venv', 'venv', '__pycache__', 'node_modules', 'dist', 'build', '.tox', '.mypy_cache', '.pytest_cache', 'target', '.next', '.parcel-cache'}

# Track last-known mtimes per path to detect changes
_file_mtime_cache: Dict[str, float] = {}
_active_watchers: Dict[str, asyncio.Task] = {}


class FileEvent:
    """Represents a file system change event."""
    def __init__(self, path: str, event_type: str, rel_path: Optional[str] = None):
        self.path = path
        self.event_type = event_type  # 'created', 'modified', 'deleted'
        self.rel_path = rel_path or path

    def to_dict(self) -> dict:
        return {
            "type": "file_changed",
            "path": self.path,
            "rel_path": self.rel_path,
            "event": self.event_type,
        }


def _get_mtime(filepath: Path) -> Optional[float]:
    """Get modification time of a file, return None if deleted."""
    try:
        return filepath.stat().st_mtime
    except (OSError, FileNotFoundError):
        return None


async def watch_directory(
    directory: str,
    broadcast_fn: Callable[[dict], None],
    polling_interval: float = 1.0,
) -> None:
    """Poll a directory for file changes and broadcast via WebSocket."""
    dir_path = Path(directory)
    if not dir_path.exists() or not dir_path.is_dir():
        return

    key = str(dir_path.resolve())

    async def _poll_loop():
        while True:
            try:
                await _scan_directory(dir_path, broadcast_fn)
            except Exception as e:
                print(f"[filewatcher] Error scanning {key}: {e}")
            await asyncio.sleep(polling_interval)

    task = asyncio.create_task(_poll_loop())
    _active_watchers[key] = task


async def stop_watching(directory: str) -> None:
    """Stop watching a directory."""
    dir_path = Path(directory)
    key = str(dir_path.resolve())
    if key in _active_watchers:
        _active_watchers[key].cancel()
        del _active_watchers[key]
    prefix = key + "/"
    _file_mtime_cache.update({k: v for k, v in _file_mtime_cache.items() if not k.startswith(prefix)})


def _is_excluded(path: Path, root: Path) -> bool:
    """Check if path contains any excluded directory component."""
    try:
        rel_parts = path.relative_to(root).parts
        return any(part in EXCLUDED_DIRS for part in rel_parts)
    except ValueError:
        return False


async def _scan_directory(root: Path, broadcast_fn: Callable[[dict], None]) -> None:
    """Scan directory and broadcast changes with directory pruning."""
    current_files: Set[str] = set()

    for dirpath, dirnames, filenames in os.walk(root):
        # Prune excluded directories in-place so os.walk avoids descending into them
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]

        base = Path(dirpath)
        for fname in filenames:
            path = base / fname
            try:
                rel = str(path.relative_to(root))
            except ValueError:
                continue

            mtime = _get_mtime(path)
            current_files.add(rel)

            if rel in _file_mtime_cache:
                old_mtime = _file_mtime_cache[rel]
                if mtime and mtime > old_mtime + 0.5:
                    broadcast_fn(FileEvent(str(path), "modified", rel).to_dict())
            else:
                if mtime is not None:
                    broadcast_fn(FileEvent(str(path), "created", rel).to_dict())

            if mtime is not None:
                _file_mtime_cache[rel] = mtime
            else:
                _file_mtime_cache.pop(rel, None)

    for rel in list(_file_mtime_cache.keys()):
        if rel not in current_files:
            full_path = root / rel
            if not full_path.exists():
                broadcast_fn(FileEvent(str(full_path), "deleted", rel).to_dict())
                del _file_mtime_cache[rel]


def get_workspace_root() -> Optional[Path]:
    """Get the workspace root from environment or default."""
    root = os.environ.get("TTO_WORKSPACE_ROOT")
    if root:
        return Path(root).resolve()
    return Path.home()
