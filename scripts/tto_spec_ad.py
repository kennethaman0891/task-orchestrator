#!/usr/bin/env python3
"""
Task Orchestrator — Spec Ad Renderer
"From 1 to ∞"
19.2s + 2s end card · 60 fps · 1920×1080 (16:9)

Built entirely in Python: numpy + Pillow. No AI video generation.
Outputs: tto_spec_ad_1080p.mp4  (and optionally 9:16 1080×1920)
"""

import math
import os
import subprocess
import sys
import tempfile
import shutil
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip3 install numpy Pillow")
    sys.exit(1)

# ─────────────────────────── CONSTANTS ───────────────────────────────────────
FPS       = 60
W, H      = 1920, 1080
TOTAL_DUR = 21.2          # seconds
TOTAL_FRAMES = int(TOTAL_DUR * FPS)

# Brand colours
BG        = (9,   10,  12)   # #090A0C  near-black
CORNER    = (15,  22,  32)   # #0F1620  deep-space corner
CYAN      = (0,   210, 255)  # #00D2FF  TTO primary
CYAN_DIM  = (0,   120, 160)
GREEN     = (34,  197, 94)   # #22C55E  agent beacon
WHITE     = (255, 255, 255)
GRAY      = (160, 170, 185)
CARD_BG   = (26,  29,  33)   # #1A1D21  terminal card
TERM_BG   = (15,  17,  17)   # #0F1111

OUT_DIR   = Path(__file__).parent.parent / "motion_assets" / "frames_1080p"
VIDEO_OUT = Path(__file__).parent.parent / "motion_assets" / "tto_spec_ad_1080p.mp4"

# ─────────────────────────── FONT HELPERS ────────────────────────────────────
def _load_font(size, bold=False, mono=False):
    """Try SF Pro, fall back to system fonts."""
    candidates = []
    if mono:
        candidates = [
            "/System/Library/Fonts/Supplemental/Courier New.ttf",
            "/System/Library/Fonts/Monaco.dfont",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        ]
    elif bold:
        candidates = [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf",
            "/Library/Fonts/SF-Pro-Display-Bold.otf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
    else:
        candidates = [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()

# Pre-load font sizes
FONT_HUGE   = _load_font(96, bold=True)
FONT_BIG    = _load_font(64, bold=True)
FONT_MID    = _load_font(42, bold=True)
FONT_SMALL  = _load_font(28)
FONT_TINY   = _load_font(20)
FONT_MONO   = _load_font(22, mono=True)
FONT_MONO_S = _load_font(16, mono=True)

# ─────────────────────────── EASING ──────────────────────────────────────────
def ease_out_quart(t):
    return 1 - (1 - t) ** 4

def ease_in_out(t):
    return t * t * (3 - 2 * t)

def ease_out_expo(t):
    if t >= 1: return 1
    return 1 - 2 ** (-10 * t)

def lerp(a, b, t):
    return a + (b - a) * t

def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))

def scene_t(frame, start_s, end_s):
    """Normalised [0,1] progress within a scene."""
    s = start_s * FPS
    e = end_s   * FPS
    return clamp((frame - s) / max(e - s, 1))

# ─────────────────────────── DRAWING UTILS ───────────────────────────────────
def new_frame():
    img = Image.new("RGB", (W, H), BG)
    return img, ImageDraw.Draw(img)

def draw_vignette(img):
    """Warm corner vignette."""
    arr = np.array(img, dtype=np.float32)
    for y in range(H):
        for x in range(0, W, 4):   # stride 4 for speed
            dx = (x / W - 0.5) * 2
            dy = (y / H - 0.5) * 2
            d  = min(1.0, math.sqrt(dx*dx + dy*dy))
            f  = 1 - d * 0.45
            arr[y, x:x+4] *= f
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8))

def add_grain(img, strength=6):
    arr  = np.array(img, dtype=np.int16)
    noise = np.random.randint(-strength, strength+1, arr.shape, dtype=np.int16)
    return Image.fromarray((arr + noise).clip(0, 255).astype(np.uint8))

def draw_glow_line(draw, x0, y0, x1, y1, color=CYAN, width=3, glow_r=18, alpha_max=200):
    """Draw a glowing neon line using multiple alpha-blended passes."""
    for r in [glow_r, glow_r//2, 2]:
        a = int(alpha_max * (1 - r / glow_r) * 0.6) if r > 2 else alpha_max
        c = color + (a,)
        draw.line([(x0, y0), (x1, y1)], fill=c, width=r)
    draw.line([(x0, y0), (x1, y1)], fill=WHITE+(220,), width=max(1, width-1))

def draw_glow_circle(draw, cx, cy, r, color=CYAN, alpha=180):
    for radius in range(r, 0, -4):
        a = int(alpha * (radius / r) ** 0.5)
        draw.ellipse([cx-radius, cy-radius, cx+radius, cy+radius], fill=color+(a,))

def draw_text_centered(draw, text, font, y, color=WHITE):
    bbox  = draw.textbbox((0, 0), text, font=font)
    tw    = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y), text, font=font, fill=color)
    return tw

def draw_text_shadow(draw, text, font, x, y, color=WHITE, shadow=(0,0,0)):
    draw.text((x+2, y+2), text, font=font, fill=shadow)
    draw.text((x,   y),   text, font=font, fill=color)

def lerp_color(c1, c2, t):
    return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))

# ─────────────────────────── PILLOW RGBA COMPOSITE ───────────────────────────
def composite(base, overlay):
    """Alpha-composite an RGBA overlay onto an RGB base image."""
    base_rgba = base.convert("RGBA")
    base_rgba.alpha_composite(overlay)
    return base_rgba.convert("RGB")

def overlay_layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))

# ═══════════════════════════════════════════════════════════════════════════════
#  SCENE RENDERERS
# ═══════════════════════════════════════════════════════════════════════════════

# ─────── S1  0.00–1.60  THE SLAM ─────────────────────────────────────────────
def render_s1(frame):
    t  = scene_t(frame, 0.0, 1.6)
    te = ease_out_quart(t)

    img, draw = new_frame()
    ov = overlay_layer()
    od = ImageDraw.Draw(ov)

    # Ambient glow
    glow_alpha = int(80 * te)
    od.ellipse([W//2-400, H//2-200, W//2+400, H//2+200],
               fill=CYAN_DIM + (glow_alpha,))

    # The line rushing in from deep space (z=far → near)
    streak_progress = clamp(t / 0.17)      # 0→1 during first 0.17 s
    line_ep = ease_out_quart(streak_progress)

    # horizontal slam line, centre Y ≈ H//2 + 80 (under where wordmark will be)
    LINE_Y = H // 2 + 80
    x_start = int(W * 0.5 - W * 1.5 * (1 - line_ep))
    x_end   = int(W * 0.5 + W * 1.5 * (1 - line_ep))
    streak_w = max(2, int(60 * (1 - line_ep) + 2))
    od.line([(x_start, LINE_Y), (x_end, LINE_Y)],
            fill=CYAN + (220,), width=streak_w)
    # glow passes
    for gw in [40, 20, 8]:
        od.line([(x_start, LINE_Y), (x_end, LINE_Y)],
                fill=CYAN + (int(80 * (1 - line_ep) + 20),), width=gw)

    img = composite(img, ov)
    ov2 = overlay_layer()
    od2 = ImageDraw.Draw(ov2)

    # After slam (t > 0.17): show static "1 → ∞" reveal line under wordmark
    if t > 0.17:
        reveal_t = clamp((t - 0.17) / 0.5)
        re = ease_out_expo(reveal_t)
        # draw arc line from left to right: "1 ——→ ∞"
        lx0 = int(W * 0.25)
        lx1 = int(W * 0.25 + (W * 0.5) * re)
        for lw in [18, 8, 2]:
            a  = max(10, 200 - lw * 8)
            od2.line([(lx0, LINE_Y + 3), (lx1, LINE_Y + 3)],
                     fill=CYAN + (a,), width=lw)
        # Arrowhead
        if re > 0.9:
            ax = lx1
            ay = LINE_Y + 3
            od2.polygon([(ax, ay), (ax-14, ay-8), (ax-14, ay+8)],
                        fill=CYAN + (220,))

    # Wordmark: TASK ORCHESTRATOR
    if t > 0.23:
        word_t  = clamp((t - 0.23) / 0.44)
        word_a  = int(255 * ease_out_expo(word_t))
        draw2   = ImageDraw.Draw(ov2)
        bbox    = draw2.textbbox((0, 0), "TASK ORCHESTRATOR", font=FONT_BIG)
        tw      = bbox[2] - bbox[0]
        draw2.text(((W - tw) // 2, H // 2 - 60),
                   "TASK ORCHESTRATOR", font=FONT_BIG, fill=WHITE + (word_a,))
        # tagline small
        tl_a = int(word_a * 0.7)
        bbox2 = draw2.textbbox((0, 0), "One Command. Multiple Agents. Complete Control.", font=FONT_SMALL)
        tw2   = bbox2[2] - bbox2[0]
        draw2.text(((W - tw2) // 2, H // 2 + 20),
                   "One Command. Multiple Agents. Complete Control.",
                   font=FONT_SMALL, fill=CYAN + (tl_a,))

    # Shake on slam
    if 0.14 < t < 0.22:
        shake_t = (t - 0.14) / 0.08
        shake_amp = int(8 * math.sin(shake_t * math.pi * 6) * (1 - shake_t))
        img = img.transform(img.size, Image.AFFINE,
                            (1, 0, shake_amp, 0, 1, shake_amp))

    img = composite(img, ov2)
    img = add_grain(img)
    return img


# ─────── S2  1.60–4.80  THE GRID ─────────────────────────────────────────────
TERM_CMD  = '> orchestrate "build auth module"'
TYPED_CHARS = list(TERM_CMD)
AGENT_ROWS = [
    ("agent-01", "Claude Code",    "ASSIGNED", GREEN),
    ("agent-02", "OpenCode",       "ASSIGNED", GREEN),
    ("agent-03", "Gemini CLI",     "QUEUED",   (200, 200, 60)),
    ("agent-04", "Codex",          "QUEUED",   (200, 200, 60)),
    ("agent-05", "Claude Code #2", "IDLE",     GRAY),
    ("agent-06", "OpenCode #2",    "IDLE",     GRAY),
]

def render_terminal_card(draw, ox, oy, cw, ch, label, status, status_color, alpha=255):
    """Draw a single terminal card."""
    # Card background
    draw.rectangle([ox, oy, ox+cw, oy+ch], fill=CARD_BG, outline=CYAN_DIM, width=1)
    # Title bar
    draw.rectangle([ox, oy, ox+cw, oy+22], fill=(30, 34, 40))
    # Traffic lights
    for i, c in enumerate([(220, 80, 60), (220, 180, 60), GREEN]):
        draw.ellipse([ox+8+i*16, oy+6, ox+18+i*16, oy+16], fill=c)
    # Label
    draw.text((ox+58, oy+5), label, font=FONT_MONO_S, fill=GRAY)
    # Status badge
    bx = ox + cw - 70
    draw.rectangle([bx, oy+5, bx+62, oy+18], fill=status_color+(40,), outline=status_color+(160,))
    draw.text((bx+4, oy+6), status, font=FONT_MONO_S, fill=status_color)
    # Mock terminal lines
    for i in range(4):
        y_line = oy + 32 + i * 14
        line_w = int(cw * 0.4 * (1 - i * 0.15))
        draw.rectangle([ox+8, y_line, ox+8+line_w, y_line+6], fill=(40, 44, 50))

def render_s2(frame):
    t  = scene_t(frame, 1.6, 4.8)
    te = ease_out_quart(t)

    img, draw = new_frame()
    ov = overlay_layer()
    od = ImageDraw.Draw(ov)

    LINE_Y = H // 2 + 80

    # 1) Logo rises away
    logo_rise = clamp(t / 0.4)
    logo_y    = int((H // 2 - 60) - 120 * ease_out_quart(logo_rise))
    logo_a    = int(255 * (1 - logo_rise))
    if logo_a > 10:
        bbox = od.textbbox((0, 0), "TASK ORCHESTRATOR", font=FONT_MID)
        tw   = bbox[2] - bbox[0]
        od.text(((W - tw) // 2, logo_y), "TASK ORCHESTRATOR",
                font=FONT_MID, fill=WHITE + (logo_a,))

    # 2) Terminal grid rises in (t=0.5 → 1.0 of this scene ≡ 2.40 s)
    grid_t  = clamp((t - 0.25) / 0.6)   # grid appears mid-scene
    grid_e  = ease_out_quart(grid_t)
    grid_oy = int(lerp(H + 40, 60, grid_e))

    # Draw 6 terminal cards in 3×2 grid
    cols, rows = 3, 2
    card_w = 290
    card_h = 120
    gx0 = (W - cols * card_w - (cols - 1) * 16) // 2
    gy0 = grid_oy

    for idx, (name, tool, status, sc) in enumerate(AGENT_ROWS):
        col = idx % cols
        row = idx // cols
        cx  = gx0 + col * (card_w + 16)
        cy  = gy0 + row * (card_h + 12)
        # fan-out 3D depth during 3.40–4.37 s  (scene_t 0.56–0.86)
        fan_t  = clamp((t - 0.56) / 0.30)
        fan_e  = ease_out_quart(fan_t)
        depth  = int(fan_e * 20 * (idx - 2.5))
        cy_fan = cy - depth
        a_card = int(255 * grid_e)
        render_terminal_card(od, cx, cy_fan, card_w, card_h,
                             tool, status, sc, a_card)

    # 3) Focus line under first card after grid lands
    if grid_t > 0.7:
        fl_t = clamp((grid_t - 0.7) / 0.3)
        fl_e = ease_out_expo(fl_t)
        lx0  = gx0
        lx1  = int(gx0 + (card_w + 16) * fl_e)
        for lw in [12, 5, 2]:
            od.line([(lx0, gy0 + card_h + 4), (lx1, gy0 + card_h + 4)],
                    fill=CYAN + (max(20, 200 - lw * 20),), width=lw)

    # 4) Typing animation (scene t 0.37–0.58 ≡ 2.50–3.30 s)
    if 0.37 < t < 0.70:
        type_t     = clamp((t - 0.37) / 0.21)
        char_count = int(type_t * len(TYPED_CHARS))
        typed_str  = "".join(TYPED_CHARS[:char_count])
        type_y     = gy0 + rows * (card_h + 12) + 20
        od.rectangle([gx0, type_y - 4, gx0 + 600, type_y + 24],
                     fill=(20, 22, 26))
        od.text((gx0 + 8, type_y), typed_str, font=FONT_MONO, fill=GREEN)
        # Autocomplete rows
        if char_count > 12:
            for ri, (n, tool, _, sc) in enumerate(AGENT_ROWS[:char_count - 12]):
                ry = type_y + 30 + ri * 20
                od.rectangle([gx0, ry, gx0 + 600, ry + 18], fill=(25, 28, 33))
                od.text((gx0 + 8, ry + 2), f"  → dispatch to {tool}",
                        font=FONT_MONO_S, fill=sc)

    img = composite(img, ov)
    img = add_grain(img)
    return img


# ─────── S3  4.80–7.20  ONE COMMAND ──────────────────────────────────────────
def render_s3(frame):
    t  = scene_t(frame, 4.8, 7.2)
    te = ease_out_quart(t)

    img, draw = new_frame()
    ov = overlay_layer()
    od = ImageDraw.Draw(ov)

    # Agent detail pane
    pane_w, pane_h = 640, 320
    px = (W - pane_w) // 2
    py = (H - pane_h) // 2 - 40
    alpha_pane = int(255 * clamp(t / 0.3))

    od.rectangle([px, py, px+pane_w, py+pane_h], fill=CARD_BG + (alpha_pane,),
                 outline=CYAN + (100,), width=1)

    # Header
    od.rectangle([px, py, px+pane_w, py+36], fill=(20, 24, 30) + (alpha_pane,))
    od.text((px+12, py+8), "Task Detail  ·  agent-01", font=FONT_MONO_S, fill=GRAY)

    # Fields
    fields = [
        ("Task",   '"build auth module"'),
        ("Status", "RUNNING"),
        ("Tokens", "1,247 used   ·   FREE"),
        ("Agents", "3 active   ·   3 idle"),
    ]
    for fi, (label, val) in enumerate(fields):
        fy = py + 50 + fi * 48
        od.text((px+20, fy), label + ":", font=FONT_MONO_S, fill=GRAY)
        fc = GREEN if val.startswith("RUNNING") else (CYAN if "FREE" in val else WHITE)
        od.text((px+120, fy), val, font=FONT_MONO, fill=fc + (alpha_pane,))
        od.line([(px+10, fy+30), (px+pane_w-10, fy+30)], fill=(40, 44, 50), width=1)

    # Dispatch button — camera glides to it (zoom in) at t=0.44
    btn_t  = clamp((t - 0.44) / 0.22)
    btn_e  = ease_out_quart(btn_t)
    zoom   = 1 + 0.08 * btn_e          # subtle zoom
    bx     = px + (pane_w - 200) // 2
    by     = py + pane_h - 56

    # Line fill animation (5.50–5.97 s → scene t 0.29–0.49)
    fill_t  = clamp((t - 0.29) / 0.20)
    fill_e  = ease_out_expo(fill_t)
    fill_x1 = int(bx + 200 * fill_e)

    od.rectangle([bx, by, bx+200, by+38], fill=(10, 50, 70) + (220,),
                 outline=CYAN + (200,), width=2)
    if fill_e > 0:
        od.rectangle([bx, by, fill_x1, by+38], fill=CYAN + (120,))
    btn_txt = "DISPATCH"
    bbox    = od.textbbox((0, 0), btn_txt, font=FONT_MID)
    tw      = bbox[2] - bbox[0]
    od.text((bx + (200 - tw) // 2, by + 4), btn_txt,
            font=FONT_MID, fill=WHITE + (220,))

    # Hot-head glow dot on leading edge
    if 0 < fill_e < 1:
        hx = fill_x1
        hy = by + 19
        for r in [24, 14, 6]:
            a = int(200 * (1 - r / 24))
            od.ellipse([hx-r, hy-r, hx+r, hy+r], fill=WHITE + (a,))

    # TAP flash (t=0.49)
    tap_t = clamp((t - 0.49) / 0.06)
    if 0 < tap_t < 1:
        flash_a = int(180 * math.sin(tap_t * math.pi))
        od.rectangle([0, 0, W, H], fill=WHITE + (flash_a,))

    # "Order placed" text
    if t > 0.52:
        conf_a = int(255 * clamp((t - 0.52) / 0.15))
        bbox   = od.textbbox((0, 0), "3 agents assigned, running in parallel.", font=FONT_MID)
        tw     = bbox[2] - bbox[0]
        od.text(((W - tw) // 2, py + pane_h + 20),
                "3 agents assigned, running in parallel.",
                font=FONT_MID, fill=GREEN + (conf_a,))

    # Fly-through: at t > 0.72, zoom into screen
    if t > 0.72:
        fly_t = clamp((t - 0.72) / 0.28)
        fly_z = 1 + fly_t * 3
        cx_   = W // 2
        cy_   = H // 2
        new_w = int(W / fly_z)
        new_h = int(H / fly_z)
        crop_box = (cx_ - new_w//2, cy_ - new_h//2,
                    cx_ + new_w//2, cy_ + new_h//2)
        img2 = composite(img, ov)
        img2 = img2.crop(crop_box).resize((W, H), Image.LANCZOS)
        return add_grain(img2)

    img = composite(img, ov)
    img = add_grain(img)
    return img


# ─────── S4  7.20–10.00  THE CITY ────────────────────────────────────────────
def render_city_top(od, offset_x=0):
    """Procedural night-city top-down grid."""
    # Ground
    od.rectangle([0, 0, W, H], fill=(5, 8, 14) + (255,))
    # Street grid
    block_w, block_h = 110, 80
    for gx in range(-block_w, W + block_w, block_w + 20):
        for gy in range(-block_h, H + block_h, block_h + 20):
            x = gx + offset_x
            # Building
            shade = int(20 + 15 * math.sin((gx + gy) * 0.03))
            od.rectangle([x+4, gy+4, x+block_w-4, gy+block_h-4],
                         fill=(shade, shade+4, shade+10) + (220,))
            # Lit windows
            for wy in range(gy+10, gy+block_h-10, 12):
                for wx in range(x+10, x+block_w-10, 10):
                    if (wx + wy) % 3 != 0:
                        wc = (60, 100, 140) if (wx+wy)%5 else GREEN
                        od.rectangle([wx, wy, wx+5, wy+5], fill=wc + (180,))

def render_s4(frame):
    t  = scene_t(frame, 7.2, 10.0)
    te = ease_out_quart(t)

    img, draw = new_frame()
    ov = overlay_layer()
    od = ImageDraw.Draw(ov)

    # Camera pan + 3/4 tilt via perspective shrink
    pan_x  = int(lerp(0, -120, ease_in_out(t)))
    tilt_y = int(lerp(0,  60,  ease_in_out(clamp(t * 2))))
    render_city_top(od, offset_x=pan_x)

    # Agent route line drawn progressively
    route_t  = clamp((t - 0.0) / 0.86)   # 0→9.60 s mark
    route_e  = ease_out_expo(route_t)

    # Waypoints for route
    pts = [
        (W//2, H//2 + 60),
        (W//2 - 180, H//2 - 20),
        (W//2 - 300, H//2 + 100),
        (W//2 - 180, H//2 + 220),
        (W//2 + 100, H//2 + 180),
        (W//2 + 260, H//2 + 60),   # home pin
    ]
    total_len = sum(math.dist(pts[i], pts[i+1]) for i in range(len(pts)-1))
    drawn_len = total_len * route_e
    cum = 0.0
    drawn_pts = [pts[0]]
    for i in range(len(pts)-1):
        seg_len = math.dist(pts[i], pts[i+1])
        if cum + seg_len >= drawn_len:
            frac = (drawn_len - cum) / seg_len
            mid  = (int(lerp(pts[i][0], pts[i+1][0], frac)),
                    int(lerp(pts[i][1], pts[i+1][1], frac)))
            drawn_pts.append(mid)
            break
        cum += seg_len
        drawn_pts.append(pts[i+1])

    for i in range(len(drawn_pts) - 1):
        for lw in [14, 6, 2]:
            od.line([drawn_pts[i], drawn_pts[i+1]],
                    fill=CYAN + (max(20, 160 - lw * 20),), width=lw)

    # Home pin
    if route_e > 0.95:
        hpx, hpy = pts[-1]
        draw_glow_circle(od, hpx, hpy, 20, CYAN, 200)
        od.text((hpx+22, hpy-10), "Home", font=FONT_TINY, fill=CYAN)

    # Glass card "Arriving today"
    card_a = int(255 * clamp((t - 0.1) / 0.3))
    cx_, cy_ = 60, 60
    od.rectangle([cx_, cy_, cx_+280, cy_+140], fill=(10, 15, 25) + (card_a,),
                 outline=CYAN + (card_a//2,), width=1)
    od.text((cx_+12, cy_+10), "All agents active", font=FONT_MONO_S, fill=WHITE)
    stages = ["Assigned", "Running", "Testing", "Complete"]
    for si, s in enumerate(stages):
        sx  = cx_ + 12 + si * 62
        sy  = cy_ + 90
        done = route_e * 4 > si
        sc   = GREEN if done else GRAY
        od.ellipse([sx, sy-8, sx+10, sy+2], fill=sc)
        od.text((sx-8, sy+5), s, font=FONT_MONO_S, fill=sc)

    # Defocus at end
    img = composite(img, ov)
    if t > 0.85:
        blur_r = int(lerp(0, 8, clamp((t - 0.85) / 0.15)))
        if blur_r > 0:
            img = img.filter(ImageFilter.GaussianBlur(blur_r))
    img = add_grain(img)
    return img


# ─────── S5  10.00–13.30  THE NOTCH ──────────────────────────────────────────
def render_s5(frame):
    t  = scene_t(frame, 10.0, 13.3)
    te = ease_out_quart(t)

    img, draw = new_frame()
    ov = overlay_layer()
    od = ImageDraw.Draw(ov)

    # Doorstep BG → desktop edge
    od.rectangle([0, 0, W, H], fill=(6, 8, 12) + (255,))
    # Faint floor boards
    for y in range(H//2, H, 60):
        od.line([(0, y), (W, y)], fill=(20, 22, 26) + (120,), width=1)

    # The line running along desktop edge
    edge_t = clamp(t / 0.4)
    edge_e = ease_out_expo(edge_t)
    lx0    = 0
    lx1    = int(W * edge_e)
    EDGE_Y = H // 3

    for lw in [16, 7, 2]:
        od.line([(lx0, EDGE_Y), (lx1, EDGE_Y)],
                fill=CYAN + (max(20, 180 - lw * 20),), width=lw)

    # Notch widget materialises at centre-top at t=0.33 (10.83 s)
    notch_t = clamp((t - 0.33) / 0.3)
    notch_e = ease_out_quart(notch_t)
    NW, NH  = 320, 44
    NX      = (W - NW) // 2
    NY      = 20
    notch_a = int(255 * notch_e)

    if notch_a > 10:
        # Drop shadow
        od.rectangle([NX+4, NY+4, NX+NW+4, NY+NH+4], fill=(0, 0, 0) + (60,))
        # Notch body
        od.rounded_rectangle([NX, NY, NX+NW, NY+NH], radius=14,
                              fill=(22, 26, 32) + (notch_a,),
                              outline=CYAN + (notch_a//2,), width=1)
        # Status dots
        statuses = [GREEN, GREEN, (200, 200, 60), GRAY]
        for di, dc in enumerate(statuses):
            dx = NX + 16 + di * 20
            dy = NY + 17
            od.ellipse([dx-5, dy-5, dx+5, dy+5], fill=dc + (notch_a,))
        # Agent count
        od.text((NX + 100, NY + 12), "3 active  ·  1 queued  ·  2 idle",
                font=FONT_MONO_S, fill=WHITE + (notch_a,))

    # Arc cools from light to glyph (10.83 s = t≈0.33)
    if notch_t > 0.5:
        glyph_t = clamp((notch_t - 0.5) / 0.5)
        # Arc under notch: "1 → ∞"
        ax0  = NX + 60
        ax1  = NX + NW - 60
        ay   = NY + NH + 8
        arc_color = lerp_color(WHITE, CYAN, glyph_t)
        od.line([(ax0, ay), (ax1, ay)], fill=arc_color + (200,), width=3)
        od.polygon([(ax1, ay), (ax1-10, ay-6), (ax1-10, ay+6)],
                   fill=arc_color + (200,))
        od.text((ax0-18, ay-8), "1", font=FONT_MONO_S, fill=arc_color + (200,))
        od.text((ax1+6, ay-8), "∞", font=FONT_MONO_S, fill=arc_color + (200,))

    # Notification "All tasks complete" at t=0.59 (12.00 s)
    if t > 0.59:
        notif_t = clamp((t - 0.59) / 0.25)
        notif_a = int(255 * ease_out_quart(notif_t))
        nx_  = W - 340
        ny_  = 80
        od.rounded_rectangle([nx_, ny_, nx_+320, ny_+64], radius=10,
                             fill=(22, 26, 32) + (notif_a,),
                             outline=GREEN + (notif_a//2,), width=1)
        od.text((nx_+14, ny_+10), "✓  All tasks complete.",
                font=FONT_SMALL, fill=WHITE + (notif_a,))
        od.text((nx_+14, ny_+36), "Task Orchestrator", font=FONT_TINY, fill=GRAY + (notif_a,))

    img = composite(img, ov)
    img = add_grain(img)
    return img


# ─────── S6  13.30–16.50  1 TO ∞ ──────────────────────────────────────────
PHRASE1 = "Everything in sync."
PHRASE2 = "From 1 to ∞."

def render_s6(frame):
    t  = scene_t(frame, 13.3, 16.5)
    te = ease_out_quart(t)

    img, draw = new_frame()
    ov = overlay_layer()
    od = ImageDraw.Draw(ov)

    # Ambient glow
    glow_a = int(60 * te)
    od.ellipse([W//2-500, H//2-250, W//2+500, H//2+250],
               fill=CYAN_DIM + (glow_a,))

    # Phase 1: "Everything in sync." (0→0.55)
    if t < 0.75:
        p1_t = clamp(t / 0.35)
        p1_a = int(255 * ease_out_expo(p1_t))
        # Letters filled with cyan then settle to white
        fill_col = lerp_color(CYAN, WHITE, clamp(t / 0.5))
        sync_col = CYAN  # "sync" stays cyan

        # Draw word by word
        words  = PHRASE1.split()
        word_x = 0
        bbox   = od.textbbox((0, 0), PHRASE1, font=FONT_BIG)
        total_w = bbox[2] - bbox[0]
        x_start = (W - total_w) // 2
        cx_ = x_start
        for wi, word in enumerate(words):
            wc = CYAN if word.lower().startswith("sync") else fill_col
            od.text((cx_, H // 2 - 40), word, font=FONT_BIG, fill=wc + (p1_a,))
            bbox_w = od.textbbox((0, 0), word + " ", font=FONT_BIG)
            cx_ += bbox_w[2] - bbox_w[0]

    # Phase 2: transform to "From 1 to ∞." (t=0.55–1.0)
    if t > 0.55:
        p2_t = clamp((t - 0.55) / 0.3)
        p2_e = ease_out_expo(p2_t)
        # Fade out phrase 1
        fade_a = int(255 * (1 - p2_e))
        # Phase 2 text rise in
        p2_a = int(255 * p2_e)
        bbox  = od.textbbox((0, 0), PHRASE2, font=FONT_HUGE)
        tw    = bbox[2] - bbox[0]
        txt_y = int(H // 2 - 60 + 30 * (1 - p2_e))
        od.text(((W - tw) // 2, txt_y), PHRASE2, font=FONT_HUGE, fill=WHITE + (p2_a,))

        # Arrow runs from under "1" to under "∞" (t=0.75–0.95 ≡ 15.20–16.00 s)
        if t > 0.75:
            arr_t = clamp((t - 0.75) / 0.20)
            arr_e = ease_out_expo(arr_t)
            # Measure positions of "1" and "∞" in PHRASE2
            prefix_1  = od.textbbox((0, 0), "From ", font=FONT_HUGE)
            w_1       = od.textbbox((0, 0), "1", font=FONT_HUGE)
            prefix_inf = od.textbbox((0, 0), "From 1 to ", font=FONT_HUGE)
            w_inf     = od.textbbox((0, 0), "∞", font=FONT_HUGE)
            x0_base   = (W - tw) // 2
            x_1       = x0_base + (prefix_1[2] - prefix_1[0])
            x_inf     = x0_base + (prefix_inf[2] - prefix_inf[0]) + (w_inf[2] - w_inf[0])
            line_y    = txt_y + (bbox[3] - bbox[1]) + 12
            lx1_      = int(x_1 + (x_inf - x_1) * arr_e)
            for lw in [18, 8, 2]:
                od.line([(x_1, line_y), (lx1_, line_y)],
                        fill=CYAN + (max(20, 200 - lw * 20),), width=lw)
            if arr_e > 0.9:
                od.polygon([(lx1_, line_y), (lx1_-14, line_y-8), (lx1_-14, line_y+8)],
                           fill=CYAN + (220,))

    img = composite(img, ov)
    img = add_grain(img)
    return img


# ─────── S7  16.50–19.20  HERO ────────────────────────────────────────────
def render_s7(frame):
    t  = scene_t(frame, 16.5, 19.2)
    te = ease_out_quart(t)

    img, draw = new_frame()
    ov = overlay_layer()
    od = ImageDraw.Draw(ov)

    # Black breath: dark stage
    od.rectangle([0, 0, W, H], fill=(4, 5, 7) + (255,))

    # On the hit at t=0.11 (16.80 s): logo arc slot + wordmark
    hit_t = clamp((t - 0.11) / 0.08)
    hit_e = ease_out_expo(hit_t)

    logo_a = int(255 * hit_e)
    LINE_Y = H // 2 + 70

    # Wordmark
    if logo_a > 10:
        bbox = od.textbbox((0, 0), "TASK ORCHESTRATOR", font=FONT_HUGE)
        tw   = bbox[2] - bbox[0]
        od.text(((W - tw) // 2, H // 2 - 80), "TASK ORCHESTRATOR",
                font=FONT_HUGE, fill=WHITE + (logo_a,))

    # Arc slots in
    if hit_e > 0.3:
        arc_x0 = int(W * 0.25)
        arc_x1 = int(W * 0.75)
        for lw in [22, 10, 3]:
            a = max(20, int(logo_a * 0.9) - lw * 10)
            od.line([(arc_x0, LINE_Y), (arc_x1, LINE_Y)],
                    fill=CYAN + (a,), width=lw)
        # Arrowhead
        od.polygon([(arc_x1, LINE_Y), (arc_x1-18, LINE_Y-10), (arc_x1-18, LINE_Y+10)],
                   fill=CYAN + (logo_a,))
        # "1" and "∞" labels
        od.text((arc_x0 - 20, LINE_Y - 12), "1", font=FONT_SMALL, fill=CYAN + (logo_a,))
        od.text((arc_x1 + 8,  LINE_Y - 12), "∞", font=FONT_SMALL, fill=CYAN + (logo_a,))

    # Slow light sweep under wordmark
    sweep_x = int((W * 0.1) + (W * 0.8) * ((t * 0.4) % 1.0))
    for sw in [60, 30, 10]:
        od.ellipse([sweep_x - sw, LINE_Y - 4, sweep_x + sw, LINE_Y + 4],
                   fill=WHITE + (int(40 * (1 - sw / 60)),))

    # "Amazon." → "Task Orchestrator." brand line
    if t > 0.5:
        brand_a = int(255 * clamp((t - 0.5) / 0.3))
        bbox    = od.textbbox((0, 0), "Task Orchestrator.", font=FONT_MID)
        tw      = bbox[2] - bbox[0]
        od.text(((W - tw) // 2, H // 2 + 110), "Task Orchestrator.",
                font=FONT_MID, fill=WHITE + (brand_a,))

    # Defocus at end → single dot
    img = composite(img, ov)
    if t > 0.85:
        blur_r = int(lerp(0, 12, clamp((t - 0.85) / 0.15)))
        if blur_r > 0:
            img = img.filter(ImageFilter.GaussianBlur(blur_r))
    # Single dot
    if t > 0.92:
        dot_a  = int(255 * clamp((t - 0.92) / 0.08))
        d_ov   = overlay_layer()
        d_od   = ImageDraw.Draw(d_ov)
        for r in [30, 15, 5]:
            d_od.ellipse([W//2-r, H//2-r, W//2+r, H//2+r],
                         fill=CYAN + (int(dot_a * r / 30),))
        img = composite(img, d_ov)
    img = add_grain(img)
    return img


# ─────── S8  19.20–21.20  END CARD ───────────────────────────────────────────
def render_s8(frame):
    t  = scene_t(frame, 19.2, 21.2)
    te = ease_out_quart(t)

    img, draw = new_frame()
    ov = overlay_layer()
    od = ImageDraw.Draw(ov)

    od.rectangle([0, 0, W, H], fill=(6, 7, 9) + (255,))

    # Particle constellation
    rng = np.random.default_rng(42)
    for _ in range(80):
        px_ = int(rng.integers(0, W))
        py_ = int(rng.integers(0, H))
        pr  = int(rng.integers(1, 4))
        pa  = int(60 * te * rng.random())
        od.ellipse([px_-pr, py_-pr, px_+pr, py_+pr], fill=CYAN + (pa,))

    # TTO Badge (simulated)
    badge_a = int(255 * ease_out_quart(clamp(t / 0.5)))
    bsize   = 90
    bx      = (W - bsize) // 2
    by      = H // 2 - 160
    od.rounded_rectangle([bx, by, bx+bsize, by+bsize], radius=18,
                         fill=(10, 50, 70) + (badge_a,),
                         outline=CYAN + (badge_a,), width=3)
    od.text((bx+15, by+22), "TTO", font=FONT_MID, fill=WHITE + (badge_a,))

    # Brand name
    name_a = int(255 * ease_out_expo(clamp((t - 0.1) / 0.5)))
    bbox   = od.textbbox((0, 0), "TASK ORCHESTRATOR", font=FONT_BIG)
    tw     = bbox[2] - bbox[0]
    od.text(((W - tw) // 2, H // 2 - 50), "TASK ORCHESTRATOR",
            font=FONT_BIG, fill=WHITE + (name_a,))

    # Tagline
    tag_a = int(255 * ease_out_expo(clamp((t - 0.2) / 0.5)))
    bbox2 = od.textbbox((0, 0), "One Command. Multiple Agents. Complete Control.", font=FONT_SMALL)
    tw2   = bbox2[2] - bbox2[0]
    od.text(((W - tw2) // 2, H // 2 + 10),
            "One Command. Multiple Agents. Complete Control.",
            font=FONT_SMALL, fill=CYAN + (tag_a,))

    # GitHub link
    link_a = int(255 * ease_out_expo(clamp((t - 0.35) / 0.4)))
    bbox3  = od.textbbox((0, 0), "github.com/kennethaman0891/tto", font=FONT_TINY)
    tw3    = bbox3[2] - bbox3[0]
    od.text(((W - tw3) // 2, H // 2 + 55),
            "github.com/kennethaman0891/tto",
            font=FONT_TINY, fill=GRAY + (link_a,))

    # Disclaimer
    disc_a = int(180 * te)
    bbox4  = od.textbbox((0, 0), "Spec ad · not affiliated with any AI vendor", font=FONT_TINY)
    tw4    = bbox4[2] - bbox4[0]
    od.text(((W - tw4) // 2, H - 40),
            "Spec ad · not affiliated with any AI vendor",
            font=FONT_TINY, fill=GRAY + (disc_a,))

    img = composite(img, ov)
    img = add_grain(img, strength=4)
    return img


# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN RENDER LOOP
# ═══════════════════════════════════════════════════════════════════════════════
SCENES = [
    (0.0,   1.6,   render_s1),
    (1.6,   4.8,   render_s2),
    (4.8,   7.2,   render_s3),
    (7.2,   10.0,  render_s4),
    (10.0,  13.3,  render_s5),
    (13.3,  16.5,  render_s6),
    (16.5,  19.2,  render_s7),
    (19.2,  21.2,  render_s8),
]

def get_renderer(frame):
    t_sec = frame / FPS
    for start, end, fn in SCENES:
        if start <= t_sec < end:
            return fn
    return SCENES[-1][2]   # end card for any overshoot


def render_all(out_dir: Path, preview_only=False):
    out_dir.mkdir(parents=True, exist_ok=True)
    n = 120 if preview_only else TOTAL_FRAMES
    print(f"Rendering {n} frames to {out_dir} …")
    for f in range(n):
        renderer = get_renderer(f)
        img      = renderer(f)
        fname    = out_dir / f"frame_{f:05d}.png"
        img.save(fname, "PNG", optimize=False)
        if f % 60 == 0:
            pct = f / n * 100
            print(f"  [{pct:5.1f}%]  frame {f:5d}/{n}  ({f/FPS:.2f}s)", flush=True)
    print("Done rendering.")


def encode_video(frame_dir: Path, out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(FPS),
        "-i", str(frame_dir / "frame_%05d.png"),
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "16",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out_path),
    ]
    print(f"Encoding → {out_path}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("ffmpeg error:", result.stderr[-1000:])
    else:
        size_mb = out_path.stat().st_size / 1_000_000
        print(f"✓  Video written: {out_path}  ({size_mb:.1f} MB)")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="TTO Spec Ad Renderer")
    ap.add_argument("--preview", action="store_true",
                    help="Render only 2 seconds (120 frames) for a quick preview")
    ap.add_argument("--no-encode", action="store_true",
                    help="Skip ffmpeg encoding step")
    ap.add_argument("--frame", type=int, default=None,
                    help="Render a single frame number and save as single_frame.png")
    args = ap.parse_args()

    if args.frame is not None:
        renderer = get_renderer(args.frame)
        img      = renderer(args.frame)
        out_p    = Path(__file__).parent.parent / "motion_assets" / "single_frame.png"
        out_p.parent.mkdir(parents=True, exist_ok=True)
        img.save(out_p)
        print(f"Saved single frame {args.frame} → {out_p}")
        sys.exit(0)

    render_all(OUT_DIR, preview_only=args.preview)

    if not args.no_encode:
        vid_path = VIDEO_OUT
        if args.preview:
            vid_path = VIDEO_OUT.with_stem(VIDEO_OUT.stem + "_preview")
        encode_video(OUT_DIR, vid_path)
