#!/usr/bin/env python3
"""
Generates a broadcast-quality 1080p 'Session Chaos' graphic (motion_assets/01_session_chaos.png)
Depicting chaotic, overlapping, unmanaged AI terminal sessions with error spikes,
running Claude Code, Gemini CLI, Codex, OpenCode, token thrashing, and context limits.
"""

import math
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1920, 1080
OUTPUT_PATH = Path('motion_assets/01_session_chaos.png')
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

# Fonts
font_mono = ImageFont.truetype('/System/Library/Fonts/SFNSMono.ttf', 14)
font_mono_bold = ImageFont.truetype('/System/Library/Fonts/SFNSMono.ttf', 15)
font_mono_sm = ImageFont.truetype('/System/Library/Fonts/SFNSMono.ttf', 12)
font_title = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 13)
font_badge = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 11)
font_big_hud = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 24)

# Color tokens
C_BG = (10, 12, 16)
C_TERM_BG = (14, 16, 22)
C_TERM_BORDER = (38, 42, 54)
C_BAR = (20, 24, 32)
C_TEXT = (210, 220, 235)
C_MUTED = (120, 130, 150)
C_CYAN = (0, 210, 255)
C_PURPLE = (168, 85, 247)
C_GREEN = (34, 197, 94)
C_YELLOW = (245, 158, 11)
C_RED = (239, 68, 68)

def draw_terminal_window(width, height, title, lines, badges=[], is_critical=False, has_blur=False):
    win = Image.new('RGBA', (width + 40, height + 40), (0, 0, 0, 0))
    wdraw = ImageDraw.Draw(win)

    bx, by = 20, 20
    bw, bh = width, height

    # Drop shadow
    shadow = Image.new('RGBA', (width + 40, height + 40), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle([bx + 4, by + 8, bx + bw + 4, by + bh + 8], radius=12, fill=(0, 0, 0, 180))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    win.paste(shadow, (0, 0), shadow)

    # Window body
    border_col = (*C_RED, 200) if is_critical else (*C_TERM_BORDER, 255)
    bg_col = (18, 14, 16, 248) if is_critical else (*C_TERM_BG, 245)
    wdraw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=10, fill=bg_col, outline=border_col, width=1)

    # Titlebar
    wdraw.rounded_rectangle([bx, by, bx + bw, by + 34], radius=10, fill=(*C_BAR, 255))
    wdraw.rectangle([bx, by + 24, bx + bw, by + 34], fill=(*C_BAR, 255))
    wdraw.line([(bx, by + 34), (bx + bw, by + 34)], fill=(45, 50, 65, 255), width=1)

    # Traffic light dots
    wdraw.ellipse([bx + 12, by + 11, bx + 22, by + 21], fill=(255, 95, 86, 255))
    wdraw.ellipse([bx + 28, by + 11, bx + 38, by + 21], fill=(255, 189, 46, 255))
    wdraw.ellipse([bx + 44, by + 11, bx + 54, by + 21], fill=(39, 201, 63, 255))

    # Title
    tb = wdraw.textbbox((0, 0), title, font=font_title)
    tw = tb[2] - tb[0]
    wdraw.text((bx + (bw - tw) // 2, by + 10), title, font=font_title, fill=C_TEXT)

    # Badges on top right
    badge_x = bx + bw - 14
    for btext, bcol in badges:
        bb = wdraw.textbbox((0, 0), btext, font=font_badge)
        bw_w = bb[2] - bb[0] + 14
        badge_x -= bw_w
        wdraw.rounded_rectangle([badge_x, by + 8, badge_x + bw_w, by + 26], radius=4, fill=(*bcol, 40), outline=(*bcol, 160), width=1)
        wdraw.text((badge_x + 7, by + 11), btext, font=font_badge, fill=bcol)
        badge_x -= 6

    # Terminal Content Lines
    cy = by + 46
    for line in lines:
        if cy > by + bh - 20:
            break
        col = line.get('color', C_TEXT)
        text = line.get('text', '')
        font = line.get('font', font_mono)
        wdraw.text((bx + 16, cy), text, font=font, fill=col)
        cy += 20

    if has_blur:
        win = win.filter(ImageFilter.GaussianBlur(1.2))

    return win


def main():
    print("▶ Generating custom Session Chaos graphic for Task Orchestrator...")
    canvas = Image.new('RGBA', (W, H), C_BG)
    draw = ImageDraw.Draw(canvas)

    # 1. Subtle radial red/amber warning glow from background
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse([200, 100, 1720, 980], fill=(239, 68, 68, 25))
    gdraw.ellipse([600, 300, 1320, 780], fill=(245, 158, 11, 20))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    canvas.paste(glow, (0, 0), glow)

    # 2. Tech grid lines
    for x in range(0, W, 48):
        draw.line([(x, 0), (x, H)], fill=(20, 24, 32, 255), width=1)
    for y in range(0, H, 48):
        draw.line([(0, y), (W, y)], fill=(20, 24, 32, 255), width=1)

    # Terminal window contents
    windows_data = [
        # Window 1: Deep back left
        {
            'x': 40, 'y': 60, 'w': 520, 'h': 360,
            'title': 'claude-code: auth_agent.py',
            'badges': [('PID 8412', C_MUTED)],
            'critical': False, 'blur': True,
            'lines': [
                {'text': '$ claude --agent "refactor OAuth provider"', 'color': C_CYAN},
                {'text': 'Reading workspace: 418 files indexed...', 'color': C_MUTED},
                {'text': 'Thinking: Searching for jwt.verify tokens...', 'color': C_PURPLE},
                {'text': 'Found 14 references in backend/auth.py', 'color': C_TEXT},
                {'text': 'WARN: rate_limit tier 2 approaching 85%', 'color': C_YELLOW},
                {'text': 'Token budget: 94,180 / 100,000', 'color': C_YELLOW},
                {'text': 'Diff generated (+42, -18 lines)', 'color': C_GREEN},
                {'text': 'Waiting for user confirmation: [y/N]', 'color': C_CYAN},
            ]
        },
        # Window 2: Deep back center
        {
            'x': 600, 'y': 40, 'w': 560, 'h': 380,
            'title': 'gemini-cli: database_migration.ts',
            'badges': [('PID 9011', C_MUTED), ('CONTEXT 96%', C_RED)],
            'critical': True, 'blur': True,
            'lines': [
                {'text': '> gemini-cli --run-deep-audit --model pro', 'color': C_CYAN},
                {'text': 'Loaded system prompt [48k tokens]', 'color': C_MUTED},
                {'text': 'CRITICAL: Token context window near limit (96%)', 'color': C_RED},
                {'text': 'Compacting trajectory context...', 'color': C_YELLOW},
                {'text': 'SyntaxError: Unexpected token < in JSON at position 0', 'color': C_RED},
                {'text': '   at JSON.parse (<anonymous>)', 'color': C_RED},
                {'text': '   at SessionManager.restore (/var/agent/mgr.ts:88:12)', 'color': C_RED},
                {'text': 'Session state desynchronized! Restart required.', 'color': C_RED},
            ]
        },
        # Window 3: Deep back right
        {
            'x': 1200, 'y': 70, 'w': 540, 'h': 350,
            'title': 'codex runner: task #883',
            'badges': [('TIMEOUT', C_RED)],
            'critical': False, 'blur': True,
            'lines': [
                {'text': '$ codex --execute-plan ./pipeline.yaml', 'color': C_CYAN},
                {'text': 'Spawning sub-agent worker [node_03]...', 'color': C_MUTED},
                {'text': 'HTTP 504: Gateway Timeout to Anthropic API', 'color': C_RED},
                {'text': 'Retrying in 4000ms (attempt 3/5)...', 'color': C_YELLOW},
                {'text': 'Error: Lost stdout socket connection', 'color': C_RED},
                {'text': 'Unmanaged PTY killed by parent process', 'color': C_RED},
            ]
        },
        # Window 4: Middle left
        {
            'x': 80, 'y': 380, 'w': 580, 'h': 420,
            'title': 'npm run dev — frontend [PORT 5173]',
            'badges': [('PORT CONFLICT', C_YELLOW)],
            'critical': False, 'blur': False,
            'lines': [
                {'text': '$ vite dev --host 0.0.0.0', 'color': C_CYAN},
                {'text': 'Port 5173 is in use, trying 5174...', 'color': C_YELLOW},
                {'text': 'Port 5174 is in use, trying 5175...', 'color': C_YELLOW},
                {'text': 'Port 5175 is in use, trying 5176...', 'color': C_YELLOW},
                {'text': '[VITE v5.4.2] ready in 480 ms', 'color': C_GREEN},
                {'text': '➜  Local:   http://localhost:5176/', 'color': C_CYAN},
                {'text': '➜  Network: use --host to expose', 'color': C_MUTED},
                {'text': 'WS reconnect failed: WebSocket is already in CLOSING state', 'color': C_RED},
                {'text': '[HMR] disconnected from server. Polling fallback...', 'color': C_YELLOW},
                {'text': '14 unattached terminals listening to dev server', 'color': C_RED},
            ]
        },
        # Window 5: Center foreground (Primary Focal Point)
        {
            'x': 540, 'y': 280, 'w': 720, 'h': 480,
            'title': 'TERMINAL CHAOS // 32 UNMANAGED ACTIVE CLI SESSIONS',
            'badges': [('CPU 98%', C_RED), ('32 CLIs', C_RED), ('CONTEXT THRASH', C_YELLOW)],
            'critical': True, 'blur': False,
            'lines': [
                {'text': '🔴 SYSTEM ALERT: 32 DISCONNECTED AGENT WORKSPACES RUNNING', 'color': C_RED, 'font': font_mono_bold},
                {'text': '─────────────────────────────────────────────────────────────', 'color': (60, 65, 80)},
                {'text': '$ ps aux | grep -E "claude|gemini|codex|opencode"', 'color': C_CYAN},
                {'text': '  PID  %CPU  %MEM   VSZ   COMMAND', 'color': C_MUTED},
                {'text': ' 4102  48.2  14.1  9.2G   claude-code --dangerously-skip-permissions', 'color': C_TEXT},
                {'text': ' 4118  39.5  12.4  8.1G   gemini-cli worker --continuous', 'color': C_TEXT},
                {'text': ' 4134  62.1  18.0 11.4G   codex agent task_runner', 'color': C_RED},
                {'text': ' 4180  24.0   8.2  4.8G   opencode daemon --port 8080', 'color': C_TEXT},
                {'text': '─────────────────────────────────────────────────────────────', 'color': (60, 65, 80)},
                {'text': 'WARNING: RAM exhaustion detected (28.4 GB / 32 GB wired)', 'color': C_RED},
                {'text': 'CRITICAL: No central orchestration HUD detected!', 'color': C_RED},
                {'text': 'ERROR: Multiple agents modifying same file: src/api/client.ts', 'color': C_RED},
                {'text': 'CONCURRENCY CONFLICT: Git lockfile index.lock already exists', 'color': C_YELLOW},
                {'text': 'Terminal context switches: 420 / hour (extreme developer fatigue)', 'color': C_YELLOW},
                {'text': '> [Awaiting Task Orchestrator intervention...]', 'color': C_CYAN, 'font': font_mono_bold},
            ]
        },
        # Window 6: Middle right
        {
            'x': 1180, 'y': 360, 'w': 620, 'h': 420,
            'title': 'pytest -v tests/agent_workflow_test.py',
            'badges': [('8 FAILED', C_RED), ('2 PASSED', C_GREEN)],
            'critical': False, 'blur': False,
            'lines': [
                {'text': '$ pytest -v -n 4 tests/', 'color': C_CYAN},
                {'text': 'tests/test_agent_routing.py::test_handshake FAILED', 'color': C_RED},
                {'text': 'tests/test_token_buffer.py::test_overflow FAILED', 'color': C_RED},
                {'text': 'tests/test_state_sync.py::test_multi_agent_lock FAILED', 'color': C_RED},
                {'text': 'AssertionError: Agent B overwrote state produced by Agent A', 'color': C_RED},
                {'text': '   Expected: "STATUS_COMPLETED"', 'color': C_MUTED},
                {'text': '   Actual:   "STATUS_INTERRUPTED_BY_ORPHAN_PROCESS"', 'color': C_RED},
                {'text': '══════════════ 8 failed, 2 passed in 14.82s ══════════════', 'color': C_RED},
                {'text': 'Notice: Orphan terminal processes still consuming port 4000', 'color': C_YELLOW},
            ]
        },
        # Window 7: Bottom wide terminal
        {
            'x': 280, 'y': 700, 'w': 880, 'h': 330,
            'title': 'opencode --multi-agent --sync-stdio',
            'badges': [('LOST CONTEXT', C_RED)],
            'critical': False, 'blur': False,
            'lines': [
                {'text': '$ opencode agent: "Implement microservices gateway"', 'color': C_CYAN},
                {'text': 'Generating 8 files across 3 directories...', 'color': C_MUTED},
                {'text': 'Warning: Shell buffer truncated (10,000 lines scrollback overflow)', 'color': C_YELLOW},
                {'text': 'Error: Terminal tab died unexpectedly with code 137 (OOM Killer)', 'color': C_RED},
                {'text': '[Process completed with error]', 'color': C_RED},
            ]
        },
    ]

    # Draw windows in order (back to front)
    for win_info in windows_data:
        term_img = draw_terminal_window(
            width=win_info['w'],
            height=win_info['h'],
            title=win_info['title'],
            lines=win_info['lines'],
            badges=win_info['badges'],
            is_critical=win_info['critical'],
            has_blur=win_info['blur']
        )
        canvas.paste(term_img, (win_info['x'] - 20, win_info['y'] - 20), term_img)

    # 3. Add Top Floating Alert Banner (High-Tech HUD)
    banner_w, banner_h = 760, 48
    bx = (W - banner_w) // 2
    by = 28
    draw.rounded_rectangle([bx, by, bx + banner_w, by + banner_h], radius=8, fill=(18, 12, 14, 235), outline=(239, 68, 68, 220), width=2)
    draw.ellipse([bx + 18, by + 17, bx + 32, by + 31], fill=(239, 68, 68, 255))
    draw.text((bx + 46, by + 12), "CRITICAL ALERT: UNMANAGED MULTI-AGENT TERMINAL CHAOS", font=font_title, fill=(255, 255, 255))
    draw.text((bx + banner_w - 180, by + 14), "TOKEN EXHAUSTION", font=font_badge, fill=(239, 68, 68))

    # 4. Cinematic vignette (darken the corners)
    vignette = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    vdraw = ImageDraw.Draw(vignette)
    vdraw.rectangle([0, 0, W, H], outline=(0, 0, 0, 140), width=40)
    vdraw.rectangle([0, 0, W, H], outline=(0, 0, 0, 90), width=80)
    vignette = vignette.filter(ImageFilter.GaussianBlur(32))
    canvas.paste(vignette, (0, 0), vignette)

    canvas.save(OUTPUT_PATH, 'PNG', optimize=True)
    print(f"✅ Generated 1080p Session Chaos graphic: {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size / 1024:.1f} KB)")


if __name__ == '__main__':
    main()
