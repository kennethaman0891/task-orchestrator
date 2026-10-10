#!/opt/homebrew/bin/python3
"""FINAL DECISIVE RECEIPT — read-only status dump, no edits, no relaunch.
Prints the live marker + voice lane truth so the phone user can verify on their thumb."""
import os, re, glob, subprocess

print("══════  LIVE RECEIPT  ══════\n")

# 1. Who owns the lane + the voice listener marker
port = subprocess.run(["lsof", "-nP", "-iTCP:8765", "-sTCP:LISTEN"], capture_output=True, text=True).stdout
pid = ""
for line in port.split("\n")[1:]:
    parts = line.split()
    if len(parts)>1 and parts[1].isdigit():
        pid = parts[1]; break
live = pid and "/Users/kennethaman/tto-web/backend" in subprocess.run(["lsof", "-p", pid], capture_output=True, text=True).stdout
print("1. Lane (port 8765):", "✅ MY repo bot (voice-only)" if live else "❌ STALE — not the repo bot", f"(pid {pid})" if pid else "")

# 2. Marker in the newest live log (loaded bytecode, not just disk)
logs = sorted(glob.glob("/tmp/tto_*.log"), key=os.path.getmtime)
marker = None
if logs:
    newest = logs[-1]
    txt = open(newest, encoding="utf-8", errors="replace").read()
    m = re.search(r"build [0-9a-zA-Z._-]+", txt)
    marker = m.group(0) if m else None
    print(f"2. Marker in newest live log ({os.path.basename(newest)}):", "✅ " + marker if marker else "❌ none")
    print("    256b:", "✅ voice" if re.search(r"voice listener", txt, re.I) else "❌ no voice lane", "| 404s:", txt.count("404"))

# 3. How the user proves which copy (footer on the panel in Discord)
print("\n3. HOW YOU KNOW YOU'RE ON THE RIGHT ONE (on your phone):")
print("     Look at the BOTTOM footer of the newest 🎙️ panel message TTO posted.")
print("     • Footer shows 'build 1.0.1-vo-lite'  =  ✅ you're on the FIXED voice-only one.")
print("     • No footer / says something else     =  ⚠️ that's an OLD panel — ignore it, tap the NEWEST.")

print("\n── 4. Remaining user-facing slash nudges on disk (should be 0) ──")
