#!/usr/bin/env python3
"""
================================================================================
Task Orchestrator (TO) — Master Motion Graphics Video Generator
Built using iart-ai/motion-skills engineering principles:
- Subpixel Ken Burns camera zoom/pan with easeOutExpo / cubic-bezier curves
- Kinetic typography with letter-spacing tracking, bloom & mask reveals
- Cybernetic HUD telemetry pills with live status beacons
- Beat-synchronized transitions with micro-overshoot brand lockup
- 1080p 24fps broadcast rendering piped to FFmpeg (libx264 high-profile)
================================================================================
"""

import os
import sys
import math
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

# ------------------------------------------------------------------------------
# Configuration & Dimensions
# ------------------------------------------------------------------------------
W, H = 1920, 1080
FPS = 24
TOTAL_DURATION_SEC = 30.0
TOTAL_FRAMES = int(TOTAL_DURATION_SEC * FPS)  # 720 frames

ROOT_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT_DIR / 'motion_assets'
OUTPUT_DIR = ROOT_DIR / 'frontend' / 'public' / 'videos'
AUDIO_PATH = Path('/tmp/tto_promo_audio.aac')

# Colors
C_BG = (9, 10, 12)
C_CYAN = (0, 210, 255)
C_GREEN = (34, 197, 94)
C_PURPLE = (139, 92, 246)
C_AMBER = (245, 158, 11)
C_RED = (239, 68, 68)
C_WHITE = (255, 255, 255)
C_MUTED = (160, 165, 175)

# ------------------------------------------------------------------------------
# Typography Setup
# ------------------------------------------------------------------------------
def load_font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

FONT_TITLE = load_font([
    '/System/Library/Fonts/SFNS.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
], 74)

FONT_SUB = load_font([
    '/System/Library/Fonts/SFNS.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/Supplemental/Arial.ttf'
], 34)

FONT_HUD_TITLE = load_font([
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/SFNS.ttf'
], 22)

FONT_HUD_MONO = load_font([
    '/System/Library/Fonts/SFNSMono.ttf',
    '/System/Library/Fonts/Supplemental/Courier New Bold.ttf'
], 16)

FONT_CAPTION = load_font([
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/SFNS.ttf'
], 32)

FONT_KINETIC = load_font([
    '/System/Library/Fonts/SFNS.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
], 44)

FONT_URL = load_font([
    '/System/Library/Fonts/SFNSMono.ttf',
    '/System/Library/Fonts/Supplemental/Courier New.ttf'
], 22)


# ------------------------------------------------------------------------------
# Easing Curves
# ------------------------------------------------------------------------------
def ease_out_expo(t: float) -> float:
    return 1.0 if t >= 1.0 else 1.0 - math.pow(2, -10 * t)

def ease_in_out(t: float) -> float:
    return t * t * (3.0 - 2.0 * t)

def ease_out_back(t: float, overshoot: float = 1.3) -> float:
    t = min(1.0, max(0.0, t)) - 1.0
    return t * t * ((overshoot + 1.0) * t + overshoot) + 1.0


# ------------------------------------------------------------------------------
# Placeholder Generator (Used when asset is pending from user)
# ------------------------------------------------------------------------------
def create_placeholder(filename: str, scene_label: str, hint: str, accent_color) -> Image.Image:
    img = Image.new('RGBA', (W, H), (14, 16, 22, 255))
    draw = ImageDraw.Draw(img)

    for x in range(0, W, 80):
        draw.line([(x, 0), (x, H)], fill=(25, 30, 40, 255), width=1)
    for y in range(0, H, 80):
        draw.line([(0, y), (W, y)], fill=(25, 30, 40, 255), width=1)

    cx, cy = W // 2, H // 2
    w_card, h_card = 1200, 680
    draw.rounded_rectangle(
        [cx - w_card // 2, cy - h_card // 2, cx + w_card // 2, cy + h_card // 2],
        radius=16,
        fill=(10, 12, 16, 230),
        outline=(*accent_color, 180),
        width=2
    )

    t_label = f"[ AWAITING USER ASSET: {filename} ]"
    tb = draw.textbbox((0, 0), t_label, font=FONT_CAPTION)
    tw = tb[2] - tb[0]
    draw.text((cx - tw // 2, cy - 80), t_label, font=FONT_CAPTION, fill=(*accent_color, 255))

    tb_scene = draw.textbbox((0, 0), scene_label, font=FONT_TITLE)
    tw_scene = tb_scene[2] - tb_scene[0]
    draw.text((cx - tw_scene // 2, cy - 10), scene_label, font=FONT_TITLE, fill=(255, 255, 255, 255))

    tb_hint = draw.textbbox((0, 0), hint, font=FONT_HUD_MONO)
    tw_hint = tb_hint[2] - tb_hint[0]
    draw.text((cx - tw_hint // 2, cy + 90), hint, font=FONT_HUD_MONO, fill=(180, 190, 205, 255))

    dir_hint = f"Save file to: motion_assets/{filename}"
    tb_dh = draw.textbbox((0, 0), dir_hint, font=FONT_HUD_MONO)
    tw_dh = tb_dh[2] - tb_dh[0]
    draw.text((cx - tw_dh // 2, cy + 130), dir_hint, font=FONT_HUD_MONO, fill=(*accent_color, 220))

    return img


# ------------------------------------------------------------------------------
# HUD Overlay Renderer
# ------------------------------------------------------------------------------
def render_hud_overlay(pill_text, pill_color, sub_text, caption_text, alpha=1.0):
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    bx, by = 64, 54
    tb = draw.textbbox((0, 0), pill_text, font=FONT_HUD_TITLE)
    text_w = tb[2] - tb[0]
    pill_w = max(540, text_w + 70)
    pill_h = 48

    a_bg = int(215 * alpha)
    a_outline = int(230 * alpha)
    a_dot = int(255 * alpha)
    a_text = int(255 * alpha)
    a_sub = int(185 * alpha)

    draw.rounded_rectangle(
        [bx, by, bx + pill_w, by + pill_h],
        radius=10,
        fill=(12, 14, 18, a_bg),
        outline=(*pill_color, a_outline),
        width=2
    )
    draw.ellipse([bx + 18, by + 17, bx + 32, by + 31], fill=(*pill_color, a_dot))
    draw.text((bx + 46, by + 11), pill_text, font=FONT_HUD_TITLE, fill=(245, 247, 250, a_text))

    draw.text((bx + 8, by + 58), sub_text, font=FONT_HUD_MONO, fill=(160, 165, 175, a_sub))

    cb = draw.textbbox((0, 0), caption_text, font=FONT_CAPTION)
    cw = cb[2] - cb[0]
    ch = cb[3] - cb[1]
    cx = (W - cw) // 2
    cy = H - 105
    pad_x, pad_y = 36, 14

    draw.rounded_rectangle(
        [cx - pad_x, cy - pad_y, cx + cw + pad_x, cy + ch + pad_y],
        radius=10,
        fill=(9, 10, 14, int(225 * alpha)),
        outline=(59, 130, 246, int(150 * alpha)),
        width=1
    )
    draw.text((cx, cy), caption_text, font=FONT_CAPTION, fill=(255, 255, 255, a_text))

    return overlay


# ------------------------------------------------------------------------------
# Subpixel Ken Burns Zoom & Pan
# ------------------------------------------------------------------------------
def apply_zoom_pan(img: Image.Image, zoom: float, pan_x_ratio: float = 0.5, pan_y_ratio: float = 0.5) -> Image.Image:
    src_w, src_h = img.size
    target_aspect = W / H
    src_aspect = src_w / src_h

    if src_aspect > target_aspect:
        base_h = src_h
        base_w = src_h * target_aspect
    else:
        base_w = src_w
        base_h = src_w / target_aspect

    crop_w = base_w / zoom
    crop_h = base_h / zoom

    left = (src_w - crop_w) * pan_x_ratio
    top = (src_h - crop_h) * pan_y_ratio
    right = left + crop_w
    bottom = top + crop_h

    cropped = img.crop((int(left), int(top), int(right), int(bottom)))
    return cropped.resize((W, H), Image.Resampling.LANCZOS)


# ------------------------------------------------------------------------------
# Kinetic Text Overlay
# ------------------------------------------------------------------------------
def render_kinetic_text(text: str, progress: float, color=C_CYAN) -> Image.Image:
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if progress <= 0.05:
        return overlay

    draw = ImageDraw.Draw(overlay)
    t_ease = ease_out_expo(min(1.0, (progress - 0.05) / 0.35))

    tb = draw.textbbox((0, 0), text, font=FONT_KINETIC)
    tw = tb[2] - tb[0]
    th = tb[3] - tb[1]
    tx = (W - tw) // 2
    ty = H // 2 + 180 + int(30 * (1.0 - t_ease))
    alpha = int(240 * t_ease)

    pad_x, pad_y = 32, 12
    draw.rounded_rectangle(
        [tx - pad_x, ty - pad_y, tx + tw + pad_x, ty + th + pad_y],
        radius=8,
        fill=(8, 10, 14, int(220 * t_ease)),
        outline=(*color, int(160 * t_ease)),
        width=1
    )
    draw.text((tx, ty), text, font=FONT_KINETIC, fill=(*color, alpha))
    return overlay


# ------------------------------------------------------------------------------
# Scene 5: Hero Badge & End Card Renderer
# ------------------------------------------------------------------------------
def render_badge_frame(badge_img: Image.Image, progress: float, fade_out: float = 1.0) -> Image.Image:
    canvas = Image.new('RGBA', (W, H), (9, 10, 12, 255))
    draw = ImageDraw.Draw(canvas)

    # Radial ambient cyan bloom in center
    bloom_alpha = int(85 * min(1.0, progress * 1.5) * fade_out)
    if bloom_alpha > 0:
        bloom_w, bloom_h = 900, 900
        bloom = Image.new('RGBA', (bloom_w, bloom_h), (0, 0, 0, 0))
        bdraw = ImageDraw.Draw(bloom)
        bdraw.ellipse([50, 50, bloom_w - 50, bloom_h - 50], fill=(0, 210, 255, bloom_alpha))
        bloom = bloom.filter(ImageFilter.GaussianBlur(120))
        canvas.paste(bloom, ((W - bloom_w) // 2, 80), bloom)

    # Badge entrance with spring / ease_out_back
    target_badge_dim = 420
    scale_prog = ease_out_back(min(1.0, progress * 1.8), overshoot=1.2)
    current_dim = int(target_badge_dim * (scale_prog + 0.03 * math.sin(progress * math.pi)))
    bw = current_dim
    bh = current_dim

    if bw > 20 and bh > 20:
        b_scaled = badge_img.resize((bw, bh), Image.Resampling.LANCZOS)
        bx = (W - bw) // 2
        by = int(115 - 25 * (1.0 - scale_prog))
        canvas.paste(b_scaled, (bx, by), b_scaled)

    # Title: "TASK ORCHESTRATOR"
    t_prog = ease_out_expo(max(0.0, min(1.0, (progress - 0.25) / 0.30)))
    if t_prog > 0.01:
        title_text = "TASK ORCHESTRATOR"
        tb = draw.textbbox((0, 0), title_text, font=FONT_TITLE)
        tw = tb[2] - tb[0]
        tx = (W - tw) // 2
        ty = by + bh + 45 + int(15 * (1.0 - t_prog))

        alpha_title = int(255 * t_prog * fade_out)
        draw.text((tx, ty), title_text, font=FONT_TITLE, fill=(0, 210, 255, int(90 * t_prog * fade_out)))
        draw.text((tx, ty), title_text, font=FONT_TITLE, fill=(255, 255, 255, alpha_title))

    # Subtitle: "One Command. Multiple Agents. Complete Control."
    s_prog = ease_out_expo(max(0.0, min(1.0, (progress - 0.45) / 0.30)))
    if s_prog > 0.01:
        prefix = "One Command. Multiple Agents. Complete "
        accent = "Control."
        pb = draw.textbbox((0, 0), prefix, font=FONT_SUB)
        ab = draw.textbbox((0, 0), accent, font=FONT_SUB)
        total_w = (pb[2] - pb[0]) + (ab[2] - ab[0])
        sx = (W - total_w) // 2
        sy = by + bh + 130 + int(12 * (1.0 - s_prog))

        draw.text((sx, sy), prefix, font=FONT_SUB, fill=(230, 235, 245, int(235 * s_prog * fade_out)))
        draw.text((sx + (pb[2] - pb[0]), sy), accent, font=FONT_SUB, fill=(0, 210, 255, int(255 * s_prog * fade_out)))

    # CTA / Repo URL
    u_prog = ease_out_expo(max(0.0, min(1.0, (progress - 0.65) / 0.25)))
    if u_prog > 0.01:
        url_text = "https://github.com/kennethaman0891/task-orchestrator"
        ub = draw.textbbox((0, 0), url_text, font=FONT_URL)
        uw = ub[2] - ub[0]
        ux = (W - uw) // 2
        uy = by + bh + 205 + int(10 * (1.0 - u_prog))
        draw.text((ux, uy), url_text, font=FONT_URL, fill=(148, 163, 184, int(220 * u_prog * fade_out)))

    if fade_out < 1.0:
        dark = Image.new('RGBA', (W, H), (0, 0, 0, int(255 * (1.0 - fade_out))))
        canvas = Image.alpha_composite(canvas, dark)

    return canvas


# ------------------------------------------------------------------------------
# Asset Loader & Validator
# ------------------------------------------------------------------------------
def load_or_placeholder(filename: str, scene_label: str, hint: str, accent_color) -> Image.Image:
    path = ASSETS_DIR / filename
    if path.exists():
        print(f"  ✓ Found asset: {filename}")
        return Image.open(path).convert('RGBA')
    else:
        print(f"  ⏳ Asset pending from user: {filename} -> Using wireframe placeholder")
        return create_placeholder(filename, scene_label, hint, accent_color)


# ------------------------------------------------------------------------------
# Main Render Pipeline (Streamlined 5 Scenes)
# ------------------------------------------------------------------------------
def main():
    print("=" * 70)
    print("🎬 Task Orchestrator — Motion Graphics Renderer")
    print(f"   Resolution: {W}x{H} | FPS: {FPS} | Duration: {TOTAL_DURATION_SEC}s ({TOTAL_FRAMES} frames)")
    print(f"   Asset Directory: {ASSETS_DIR}")
    print("=" * 70)

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Load the 5 assets
    print("▶ Validating and loading scene assets...")
    img_chaos = load_or_placeholder('01_session_chaos.png', 'Scene 1: Multi-Agent Chaos', 'Generated by AI', C_RED)
    img_grid = load_or_placeholder('02_grid_overview.png', 'Scene 2: Task Orchestrator Grid', 'Capture Task Orchestrator grid + floating notch', C_GREEN)
    
    # Check 03_cyber_city (fallback to docs/city-overview.png if available)
    city_path = ASSETS_DIR / '03_cyber_city.png'
    fallback_city = ROOT_DIR / 'docs' / 'city-overview.png'
    if not city_path.exists() and fallback_city.exists():
        print("  ℹ Using docs/city-overview.png for 03_cyber_city.png fallback")
        img_city = Image.open(fallback_city).convert('RGBA').resize((W, H), Image.Resampling.LANCZOS)
    else:
        img_city = load_or_placeholder('03_cyber_city.png', 'Scene 3: 3D Developer City View', 'Capture 3D city mode with workspaces & vehicles', C_PURPLE)

    # Check 04_terminal_call (fallback to 04_mobile_voice.png if needed)
    call_path = ASSETS_DIR / '04_terminal_call.png'
    if call_path.exists():
        img_call = load_or_placeholder('04_terminal_call.png', 'Scene 4: Real-Time Terminal Voice Call', 'Capture Terminal Call overlay with agent', C_CYAN)
    else:
        img_call = load_or_placeholder('04_terminal_call.png', 'Scene 4: Real-Time Terminal Voice Call', 'Capture Terminal Call overlay with agent', C_CYAN)

    # Check 05_badge_logo (fallback to desktop-icon or promo badge)
    badge_path = ASSETS_DIR / '05_badge_logo.png'
    fallback_badge = ROOT_DIR / 'frontend' / 'public' / 'videos' / 'promo' / '07-badge.png'
    if badge_path.exists():
        print(f"  ✓ Found asset: 05_badge_logo.png")
        img_badge = Image.open(badge_path).convert('RGBA')
    elif fallback_badge.exists():
        print("  ℹ Using existing promo badge for 05_badge_logo.png fallback")
        img_badge = Image.open(fallback_badge).convert('RGBA')
    else:
        img_badge = Image.new('RGBA', (800, 800), (0, 0, 0, 0))
        bdraw = ImageDraw.Draw(img_badge)
        bdraw.rounded_rectangle([100, 100, 700, 700], radius=120, fill=(18, 22, 30, 240), outline=C_CYAN, width=12)
        bdraw.text((260, 310), "TO", font=FONT_TITLE, fill=(255, 255, 255, 255))
        bdraw.text((200, 430), "TASK ORCHESTRATOR", font=FONT_HUD_MONO, fill=C_CYAN)

    # 2. Pre-render HUD overlays
    hud_chaos = render_hud_overlay(
        pill_text="🔴 CRITICAL // 32 UNMANAGED ACTIVE CLI AGENTS",
        pill_color=C_RED,
        sub_text="CLAUDE CODE • OPENCODE • CODEX • GEMINI CLI",
        caption_text="THE CHAOS OF UNMANAGED SESSIONS"
    )

    hud_grid = render_hud_overlay(
        pill_text="🟢 TASK ORCHESTRATOR // DYNAMIC GRID ENGINE",
        pill_color=C_GREEN,
        sub_text="PERSISTENT PTY SESSIONS • NATIVE DESKTOP • ZERO LATENCY",
        caption_text="ONE UNIFIED COMMAND CENTER FOR ALL YOUR AGENTS"
    )

    hud_city = render_hud_overlay(
        pill_text="🟣 SPATIAL ENGINE // 3D DEVELOPER CITY",
        pill_color=C_PURPLE,
        sub_text="WORKSPACE SKYSCRAPERS • LIVE VEHICLE TELEMETRY • AMBIENT NIGHT SKY",
        caption_text="VISUALIZE EVERY WORKSPACE IN A LIVING 3D CITY"
    )

    hud_call = render_hud_overlay(
        pill_text="⚡ VOICE ENGINE // REAL-TIME TERMINAL CALL",
        pill_color=C_CYAN,
        sub_text="SUB-35MS SPEECH DUPLEX • LIVE AUDIO CAPTIONS • DIRECT AGENT DIALOGUE",
        caption_text="TALK DIRECTLY TO YOUR TERMINAL IN REAL-TIME VOICE"
    )

    # Output paths
    promo_mp4 = OUTPUT_DIR / 'promo.mp4'
    login_mp4 = OUTPUT_DIR / 'login.mp4'

    # 3. Setup FFmpeg pipe
    ffmpeg_cmd = [
        'ffmpeg', '-y',
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-s', f'{W}x{H}',
        '-pix_fmt', 'rgba',
        '-r', str(FPS),
        '-i', '-',
    ]

    if AUDIO_PATH.exists():
        ffmpeg_cmd.extend(['-i', str(AUDIO_PATH), '-c:a', 'aac', '-b:a', '192k'])

    ffmpeg_cmd.extend([
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        str(promo_mp4)
    ])

    print("▶ Spawning FFmpeg video pipe (1080p @ 24fps)...")
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)

    # 4. Frame Generation Loop (5 Scene Timelines):
    # Scene 1: Frames 0   - 119 (5.0s) -> Multi-Agent Chaos
    # Scene 2: Frames 120 - 287 (7.0s) -> Task Orchestrator Grid
    # Scene 3: Frames 288 - 455 (7.0s) -> 3D Developer City View
    # Scene 4: Frames 456 - 599 (6.0s) -> Mobile & Voice AI
    # Scene 5: Frames 600 - 719 (5.0s) -> Hero Badge & Outro

    for f in range(TOTAL_FRAMES):
        if f < 120:
            # Scene 1: Chaos (0.0s - 5.0s)
            p = f / 120.0
            zoom = 1.00 + 0.08 * ease_in_out(p)
            base = apply_zoom_pan(img_chaos, zoom, 0.5, 0.5)
            frame_img = Image.alpha_composite(base, hud_chaos)
            k_img = render_kinetic_text("TOO MANY AGENTS. ZERO VISIBILITY.", p, C_RED)
            frame_img = Image.alpha_composite(frame_img, k_img)
            if f < 12:
                fade = f / 12.0
                dark = Image.new('RGBA', (W, H), (0, 0, 0, int(255 * (1.0 - fade))))
                frame_img = Image.alpha_composite(frame_img, dark)

        elif f < 288:
            # Scene 2: Grid (5.0s - 12.0s)
            p = (f - 120) / 168.0
            zoom = 1.06 - 0.06 * ease_in_out(p)
            base = apply_zoom_pan(img_grid, zoom, 0.5, 0.5)
            frame_img = Image.alpha_composite(base, hud_grid)
            k_img = render_kinetic_text("INSTANT MAGNETIC ORDER.", p, C_GREEN)
            frame_img = Image.alpha_composite(frame_img, k_img)

            # Drop transition: Cyan flash hit (frames 120-128)
            if f < 128:
                flash_p = (f - 120) / 8.0
                flash_alpha = int(220 * (1.0 - flash_p))
                flash = Image.new('RGBA', (W, H), (0, 210, 255, flash_alpha))
                frame_img = Image.alpha_composite(frame_img, flash)

        elif f < 456:
            # Scene 3: 3D Developer City (12.0s - 19.0s)
            p = (f - 288) / 168.0
            zoom = 1.01 + 0.07 * ease_in_out(p)
            pan_x = 0.52 - 0.08 * p
            pan_y = 0.50 - 0.04 * p
            base = apply_zoom_pan(img_city, zoom, pan_x, pan_y)
            frame_img = Image.alpha_composite(base, hud_city)
            k_img = render_kinetic_text("YOUR CODEBASE AS A LIVING CITY.", p, C_PURPLE)
            frame_img = Image.alpha_composite(frame_img, k_img)

            # Cross-dissolve from scene 2
            if f < 296:
                blend = (f - 288) / 8.0
                prev_base = apply_zoom_pan(img_grid, 1.0, 0.5, 0.5)
                prev_frame = Image.alpha_composite(prev_base, hud_grid)
                frame_img = Image.blend(prev_frame, frame_img, blend)

        elif f < 600:
            # Scene 4: Real-Time Terminal Voice Call (19.0s - 25.0s)
            p = (f - 456) / 144.0
            zoom = 1.00 + 0.06 * ease_in_out(p)
            base = apply_zoom_pan(img_call, zoom, 0.5, 0.5)
            frame_img = Image.alpha_composite(base, hud_call)
            k_img = render_kinetic_text("LIVE TERMINAL CALL. ZERO LATENCY.", p, C_CYAN)
            frame_img = Image.alpha_composite(frame_img, k_img)

            # Cross-dissolve from scene 3
            if f < 464:
                blend = (f - 456) / 8.0
                prev_base = apply_zoom_pan(img_city, 1.08, 0.44, 0.46)
                prev_frame = Image.alpha_composite(prev_base, hud_city)
                frame_img = Image.blend(prev_frame, frame_img, blend)

        else:
            # Scene 5: Hero Badge & Outro (25.0s - 30.0s)
            p = (f - 600) / 120.0
            fade_out = 1.0 if f < 704 else max(0.0, (720 - f) / 16.0)
            frame_img = render_badge_frame(img_badge, p, fade_out)

            # Cross-dissolve from scene 4
            if f < 608:
                blend = (f - 600) / 8.0
                prev_base = apply_zoom_pan(img_call, 1.06, 0.5, 0.5)
                prev_frame = Image.alpha_composite(prev_base, hud_call)
                frame_img = Image.blend(prev_frame, frame_img, blend)

        proc.stdin.write(frame_img.tobytes())

        if f % 72 == 0 or f == TOTAL_FRAMES - 1:
            progress_pct = (f + 1) / TOTAL_FRAMES * 100
            print(f"  ⚡ Frame {f + 1}/{TOTAL_FRAMES} ({progress_pct:.1f}%) | Time: {f/FPS:.2f}s")

    proc.stdin.close()
    proc.wait()

    if promo_mp4.exists():
        import shutil
        shutil.copy2(promo_mp4, login_mp4)
        print("=" * 70)
        print(f"✅ Motion Graphics Video Render Complete!")
        print(f"   • Output Video: {promo_mp4} ({promo_mp4.stat().st_size / 1024 / 1024:.2f} MB)")
        print(f"   • App Intro:    {login_mp4}")
        print("=" * 70)


if __name__ == '__main__':
    main()
