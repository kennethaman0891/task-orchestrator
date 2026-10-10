#!/opt/homebrew/bin/python3
"""Audit every user-facing mention of slash commands / button labels / slashes
across the whole backend. READ-ONLY — prints file:line for every hit.
"""
import os, sys

# User-facing vocabulary we are stripping to ZERO:
PARTICIPANTS = [
    "/use", "/workspaces", "/new ", "/session ", "/sessions ", "/task ",
    "/abort", "/help", "/panel", "/dispatch", "/sessions) to dispatch",
    "Click to see command", "slash command", "slash commands",
    "type /use", "tap /use", "run /use", "use /use", "the /help",
]

WALK_DIRS = ["remote", "."]  # remote/ + root
SKIP_SUBDIRS = {
    "node_modules", ".git", "__pycache__", "venv", ".venv", "dist", "build",
    ".venv3", "scripts",
}
SKIP_FILES = {"voice_msg.py"}  # keep (it's import/audio internal, no UI)

def scan():
    hits = []
    for base in WALK_DIRS:
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP_SUBDIRS]
            for fn in files:
                if not fn.endswith(".py") or fn in SKIP_FILES:
                    continue
                path = os.path.join(root, fn)
                try:
                    lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
                except OSError:
                    continue
                for i, l in enumerate(lines):
                    low = l.lower()
                    for p_txt in PARTICIPANTS:
                        if p_txt in low:
                            # Only flag TRUE user-facing literal strings,
                            # not code refs / urls / selectors / docstrings.
                            s = l.strip()
                            if not s or s.startswith(("#", "//", "/*", "*", '"', "'", "import", "from")):
                                continue
                            if "://" in s or ".env" in s or "discord_bot.py" in s:
                                continue
                            # Is it wrapped in quotes (a string sent to users)?
                            q = l.split(p_txt)
                            before = q[0][-3:].strip()
                            if before and before[0] not in ('"', "'", "f'"):
                                continue
                            hits.append((path, i + 1, p_txt, s[:110]))
                            break
    return hits

hits = scan()
print(f"── {len(hits)} user-facing slash/typing/slash-command references ├─")
for p, i, t, s in hits:
    print(f"  {p.replace(os.getcwd() + os.sep, '')}:{i} [{t}] {s}")

if not hits:
    print("\n🎉 ZERO user-facing slash/typing refs remain. Interface is fully voice.")

sys.exit(0 if not hits else 1)
