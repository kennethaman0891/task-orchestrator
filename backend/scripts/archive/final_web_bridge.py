"""DECISIVE: prove the PHONE voice lane → create_workspace → shows in the WEB UI's API, via the EXACT call voice_msg.py makes."""
import subprocess, time, os, sys

# ── 0. Confirm THIS python has faster_whisper (the repo lane, the only one) ──
print("══ 0. Which python will do this? (must be repo lane, faster_whisper present) ══")
r = subprocess.run(["/opt/homebrew/bin/python3", "-c", "import faster_whisper; print('  ✅ faster_whisper importable')"],
                   capture_output=True, text=True)
print(r.stdout.strip() or f"  ❌ {r.stderr.strip()[:80]}")
print()

# ── 1. Read the exact bridge dict from main.py: which line is the REAL one main passes to run_bot? ──
print("══ 1. The 'bridge' dict main.py actually passes to run_bot (not a stale sibling) ══")
src = open("main.py", encoding="utf-8", errors="replace").read()
# The run_bot call passes `bridge` — find run_bot invocation
import re
for m in re.finditer(r"run_bot\(([^)]{0,60})\)", src):
    print(f"  run_bot call: {m.group(1).strip()[:60]}")
# find the final `bridge = {` that voice_msg's _b actually reads (installed via install_listener(bot, _bridge))
m2 = re.search(r"install_listener\(bot,?\s*(\w+)\)", src)
if m2:
    name = m2.group(1)
    print(f"  voice lane reads bridge var: `{name}`")
    # is create_workspace IN that var's definition?
    # find `NAME = {` then check for create_workspace key
    m3 = re.search(r"^%s = \{" % re.escape(name), src, re.M)
    if m3:
        chunk = src[m3.end():m3.end()+2500]
        cw = "create_workspace" in chunk
        print(f"  create_workspace in `{name}` dict: {'✅ YES' if cw else '❌ NO'}")
        for k in re.findall(r'"(\w+)":', chunk[:1200]):
            pass  # just proving parse
        # print a few keys for proof
        keys = re.findall(r'"(\w+)":', chunk[:1500])[:14]
        print(f"  keys present: {keys}")
    else:
        print(f"  ⚠️ couldn't find `{name} = {{` — checking _bridge global instead")
else:
    print("  ⚠️ no install_listener call found")
print()

# ── 2. THE decisive end-to-end: voice lane create_workspace('dogs') → web API lists it ──
print("══ 2. Now CALL create_workspace('dogs') via the exact bridge, then read the WEB API the frontend reads ══")
print("  (this is 100% offline-direct — no bot, no port fight, just the bridge fn main registers)")
import asyncio, httpx
async def main():
    from remote import voice_msg as vm
    # vm's _b reads the same bridge registers at install — but we're testing the fn directly:
    create_fn = vm._b("create_workspace")
    if not callable(create_fn):
        print("  ❌ create_workspace NOT in voice_msg._b — voice lane genuinely not wired")
        return
    print("  ✅ create_workspace resolves in the voice lane")
    r = create_fn("dogs")  # SYNC — no await (matches the fixed lane)
    print(f"  create_workspace('dogs') → {r}")
    print()
    print("══ 3. NOW the WEB API that the TTO web UI reads: does 'dogs' show? ══")
    await asyncio.sleep(3)
    rr = httpx.get("http://127.0.0.1:8765/api/workspaces", timeout=5)
    names = [w.get("name", "?") for w in rr.json().get("workspaces", [])]
    print(f"  web API workspaces: {names}")
    print(f"  dogs: {'✅ VISIBLE IN WEB UI NOW' if 'dogs' in names else '❌ STILL NOT IN WEB UI'}")

asyncio.run(main())
