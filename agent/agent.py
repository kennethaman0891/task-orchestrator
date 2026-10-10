#!/usr/bin/env python3
"""tto-agent - runs inside a terminal, connects to tto-web, executes tasks.

Run this in a terminal where you want tasks delivered:
    python3 ~/tto-web/agent/agent.py

It connects to the tto-web server via WebSocket, receives tasks, and
executes them as shell commands in that terminal.
"""
import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

SERVER_URL = os.environ.get("TTO_SERVER", "ws://localhost:8765/ws/terminal")

try:
    import websockets
except ImportError:
    sys.exit("Please install websockets: pip install websockets")

def get_tty():
    r = subprocess.run(["tty"], capture_output=True, text=True)
    out = r.stdout.strip()
    if out and out != "not a tty":
        return out.lstrip("/dev/")
    return f"proc-{os.getpid()}"

async def run_task(task, tty):
    """Execute a task in the current terminal."""
    desc = task.get("description", "")
    task_id = task.get("id", "")
    print(f"\n▶ tto: executing task [{task_id}]: {desc}", flush=True)
    print("▶ tto: " + "-" * 60, flush=True)

    try:
        # Execute the task as a shell command
        proc = await asyncio.create_subprocess_shell(
            desc,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        output_lines = []
        try:
            while True:
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=300)
                if not line:
                    break
                line_str = line.decode().rstrip()
                output_lines.append(line_str)
                print(f"  {line_str}", flush=True)
        except asyncio.TimeoutError:
            proc.kill()
            print("▶ tto: command timed out (300s), killed.", flush=True)

        exit_code = await proc.wait()
        output = "\n".join(output_lines[-30:])
        summary = f"exit={exit_code} · last output: {output[:300]}"
        print(f"\n▶ tto: done. {summary}", flush=True)
        return {"type": "task_complete", "task_id": task_id, "summary": summary}
    except Exception as e:
        print(f"\n▶ tto: failed: {e}", flush=True)
        return {"type": "task_complete", "task_id": task_id, "summary": f"error: {e}"}

async def main():
    tty = get_tty()
    print(f"▶ tto-agent: starting on {tty}", flush=True)
    print(f"▶ tto-agent: server = {SERVER_URL}", flush=True)

    retry = 0
    while True:
        try:
            async with websockets.connect(SERVER_URL + "/" + tty) as ws:
                print(f"▶ tto-agent: connected to server", flush=True)
                retry = 0
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    print(f"▶ tto-agent: received: {msg}", flush=True)
                    if msg.get("type") == "run_task":
                        result = await run_task(msg.get("task", {}), tty)
                        await ws.send(json.dumps(result))
                    elif msg.get("type") == "new_task":
                        # New task queued - the server decides when to run it
                        print(f"▶ tto-agent: task queued: {msg['task'].get('description', '')}", flush=True)
        except (websockets.exceptions.ConnectionClosed, OSError) as e:
            retry += 1
            delay = min(5 * retry, 30)
            print(f"▶ tto-agent: disconnected ({e}). retrying in {delay}s...", flush=True)
            await asyncio.sleep(delay)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n▶ tto-agent: stopped.", flush=True)
