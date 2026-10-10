#!/usr/bin/env python3
"""Task management utilities for tto-web backend.

Provides safe task execution with error handling and monitoring.
"""
import asyncio
import logging
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

# Registry of background tasks
_background_tasks: Dict[str, asyncio.Task] = {}


def create_task_safe(name: str, coro, delay: float = 0.1) -> Optional[asyncio.Task]:
    """Create a background task with automatic restart on crash.

    Args:
        name: Unique identifier for the task
        coro: Coroutine to run
        delay: Delay between restart attempts

    Returns:
        Task reference or None if failed to create
    """
    async def _wrapped():
        retries = 0
        while True:
            try:
                await coro
            except Exception as exc:
                retries += 1
                wait = min(delay * (2 ** (retries - 1)), 60)
                logger.error(f"[bg:{name}] crashed ({exc!r}), restarting in {wait:.0f}s (attempt {retries})")
                await asyncio.sleep(wait)
            else:
                retries = 0
            await asyncio.sleep(delay)

    try:
        task = asyncio.create_task(_wrapped())
        _background_tasks[name] = task
        return task
    except RuntimeError as e:
        logger.error(f"Failed to create task '{name}': {e}")
        return None


def get_task(name: str) -> Optional[asyncio.Task]:
    """Get a background task by name."""
    return _background_tasks.get(name)


def remove_task(name: str) -> bool:
    """Remove and cancel a background task."""
    task = _background_tasks.pop(name, None)
    if task and not task.done():
        task.cancel()
        return True
    return False


def stop_all_tasks() -> int:
    """Cancel all background tasks. Returns count of cancelled tasks."""
    count = 0
    for name, task in list(_background_tasks.items()):
        if not task.done():
            task.cancel()
            count += 1
    _background_tasks.clear()
    return count


def wrap_subprocess_async(coro_func: Callable, *args, **kwargs) -> asyncio.Task:
    """Wrap a synchronous function call in asyncio.to_thread()."""
    return asyncio.create_task(asyncio.to_thread(coro_func, *args, **kwargs))
