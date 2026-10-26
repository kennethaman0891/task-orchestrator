#!/usr/bin/env python3
"""
TTO Motion Graphics Video Generator
Renders a 10-second (240-frame @ 24fps) broadcast-quality 1080p motion graphics promo
from project assets, with dynamic camera zooms, glassmorphic HUD overlays, typography animations,
and synchronized audio.
"""

import os
import sys
import math
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

W, H = 1920, 1080
FPS = 24
TOTAL_FRAMES = 240  # 10.0 seconds

PROMO_DIR = 'frontend/public/videos/promo'
OUTPUT_DIR = 'frontend/public/videos'
AUDIO_PATH = '/tmp/tto_promo_audio.aac'

FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
FONT_REG = '/System/Library/Fonts/Supplemental/Arial.ttf'
FONT_MONO = '/System/Library/Fonts/SFNSMono.ttf'

font_hud_title = ImageFont.truetype(FONT_BOLD, 22)
font_hud_sub = ImageFont.truetype(FONT_MONO, 16)
font_caption = ImageFont.truetype(FONT_BOLD, 34)
font_title = ImageFont.truetype(FONT_BOLD, 74)
font_sub = ImageFont.truetype(FONT_REG, 34)


def ease_in_out(t: float) -> float:
    return t * t * (3.0 - 2.0 * t)


def render_hud_overlay(pill_text, pill_color, sub_text, caption_text, alpha=1.0):
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Top Left HUD Pill
    bx, by = 64, 54
    tb = draw.textbbox((0, 0), pill_text, font=font_hud_title)
    text_w = tb[2] - tb[0]
    pill_w = max(520, text_w + 80)
    pill_h = 48

    a_bg = int(210 * alpha)
    a_outline = int(220 * alpha)
    a_dot = int(255 * alpha)
    a_text = int(255 * alpha)
    a_sub = int(180 * alpha)

    draw.rounded_rectangle(
        [bx, by, bx + pill_w, by + pill_h],
        radius=10,
        fill=(12, 14, 18, a_bg),
        outline=(*pill_color, a_outline),
        width=2
    )
    # Glowing dot
    draw.ellipse([bx + 18, by + 17, bx + 32, by + 31], fill=(*pill_color, a_dot))
    draw.text((bx + 46, by + 11), pill_text, font=font_hud_title, fill=(245, 247, 250, a_text))

    # Sub-HUD line
    draw.text((bx + 8, by + 58), sub_text, font=font_hud_sub, fill=(160, 165, 175, a_sub))

    # Bottom Center Caption Pill
    cb = draw.textbbox((0, 0), caption_text, font=font_caption)
    cw = cb[2] - cb[0]
    ch = cb[3] - cb[1]
    cx = (W - cw) // 2
    cy = H - 105
    pad_x, pad_y = 36, 14

    draw.rounded_rectangle(
        [cx - pad_x, cy - pad_y, cx + cw + pad_x, cy + ch + pad_y],
        radius=10,
        fill=(9, 10, 14, int(220 * alpha)),
        outline=(59, 130, 246, int(150 * alpha)),
        width=1
    )
    draw.text((cx, cy), caption_text, font=font_caption, fill=(255, 255, 255, a_text))

    return overlay


def apply_zoom_pan(img: Image.Image, zoom: float, pan_x_ratio: float = 0.5, pan_y_ratio: float = 0.5) -> Image.Image:
    """Subpixel crop and resize for Ken Burns effect."""
    src_w, src_h = img.size
    crop_w = src_w / zoom
    crop_h = src_h / zoom

    left = (src_w - crop_w) * pan_x_ratio
    top = (src_h - crop_h) * pan_y_ratio
    right = left + crop_w
    bottom = top + crop_h

    cropped = img.crop((left, top, right, bottom))
    return cropped.resize((W, H), Image.Resampling.LANCZOS)


def render_badge_frame(badge_img: Image.Image, progress: float, fade_out: float = 1.0) -> Image.Image:
    """Render Scene 5: Badge reveal + animated typography."""
    canvas = Image.new('RGBA', (W, H), (9, 10, 12, 255))

    # Badge floating animation (slight breathing scale)
    scale = 0.68 + 0.04 * math.sin(progress * math.pi * 0.8)
    bw = int(W * scale)
    bh = int(H * scale)
    b_scaled = badge_img.resize((bw, bh), Image.Resampling.LANCZOS)

    bx = (W - bw) // 2
    by = int(50 - 15 * (1.0 - ease_in_out(min(1.0, progress * 2.0))))
    canvas.paste(b_scaled, (bx, by), b_scaled)

    draw = ImageDraw.Draw(canvas)

    # Title animation: "TASK ORCHESTRATOR"
    # Appears at progress > 0.20
    t_prog = ease_in_out(max(0.0, min(1.0, (progress - 0.20) / 0.35)))
    if t_prog > 0.01:
        title_text = "TASK ORCHESTRATOR"
        tb = draw.textbbox((0, 0), title_text, font=font_title)
        tw = tb[2] - tb[0]
        tx = (W - tw) // 2
        ty = by + bh + 15

        # Glow / bloom shadow
        draw.text((tx, ty), title_text, font=font_title, fill=(59, 130, 246, int(120 * t_prog * fade_out)))
        draw.text((tx, ty), title_text, font=font_title, fill=(255, 255, 255, int(255 * t_prog * fade_out)))

    # Subtitle animation: "One Command. Multiple Agents. Complete Control."
    # Appears at progress > 0.50
    s_prog = ease_in_out(max(0.0, min(1.0, (progress - 0.50) / 0.35)))
    if s_prog > 0.01:
        prefix = "One Command. Multiple Agents. Complete "
        accent = "Control."
        pb = draw.textbbox((0, 0), prefix, font=font_sub)
        ab = draw.textbbox((0, 0), accent, font=font_sub)
        total_w = (pb[2] - pb[0]) + (ab[2] - ab[0])
        sx = (W - total_w) // 2
        sy = by + bh + 100

        draw.text((sx, sy), prefix, font=font_sub, fill=(230, 235, 245, int(240 * s_prog * fade_out)))
        draw.text((sx + (pb[2] - pb[0]), sy), accent, font=font_sub, fill=(0, 210, 255, int(255 * s_prog * fade_out)))

    # Fade out to black in the final moments
    if fade_out < 1.0:
        dark = Image.new('RGBA', (W, H), (0, 0, 0, int(255 * (1.0 - fade_out))))
        canvas = Image.alpha_composite(canvas, dark)

    return canvas


def main():
    print("▶ Initializing TTO Motion Graphics Renderer...")
    os.makedirs(PROMO_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 1. Extract audio from existing login.mp4 if not already cached
    src_video = os.path.join(OUTPUT_DIR, 'login.mp4')
    if os.path.exists(src_video):
        print(f"▶ Extracting reference audio track from {src_video}...")
        subprocess.run([
            'ffmpeg', '-y', '-i', src_video, '-vn', '-c:a', 'copy', AUDIO_PATH
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        print("Notice: No audio source found. Video will be rendered silent.")

    # 2. Load and prepare source images
    print("▶ Loading promo scene assets...")
    img_chaos = Image.open(f'{PROMO_DIR}/01-chaos.jpg').convert('RGBA')
    img_grid = Image.open(f'{PROMO_DIR}/02-grid.jpg').convert('RGBA')
    img_city = Image.open(f'{PROMO_DIR}/05-city.jpg').convert('RGBA')
    img_phone = Image.open(f'{PROMO_DIR}/06-phone.jpg').convert('RGBA')
    img_badge = Image.open(f'{PROMO_DIR}/07-badge.png').convert('RGBA')

    # Pre-render HUD overlays with clean ASCII tech tags
    hud_chaos = render_hud_overlay(
        pill_text="SESSION CHAOS // 30+ DISCONNECTED CLIs",
        pill_color=(239, 68, 68),
        sub_text="CLAUDE CODE • OPENCODE • CODEX • GEMINI CLI",
        caption_text="CHAOS OF UNMANAGED SESSIONS"
    )

    hud_grid = render_hud_overlay(
        pill_text="COMMAND CENTER // DYNAMIC GRID (36+ PANES)",
        pill_color=(34, 197, 94),
        sub_text="AUTONOMOUS NOTCH CONTROLLER • PERSISTENT PTY",
        caption_text="ONE NATIVE DESKTOP COMMAND CENTER"
    )

    hud_city = render_hud_overlay(
        pill_text="CITY VIEW // 3D WORKSPACE ENGINE (R3F)",
        pill_color=(139, 92, 246),
        sub_text="LIVE THREE.JS METROPOLIS • REAL-TIME AGENT TELEMETRY",
        caption_text="VISUALIZE EVERY WORKSPACE IN REAL TIME"
    )

    hud_phone = render_hud_overlay(
        pill_text="REMOTE GATEWAY // JARVIS VOICE AI",
        pill_color=(0, 210, 255),
        sub_text="WEBRTC AUDIO • WHATSAPP & TELEGRAM BOT INGRESS",
        caption_text="CONTROL TERMINALS FROM ANYWHERE"
    )

    # Output file paths
    promo_mp4 = os.path.join(OUTPUT_DIR, 'promo.mp4')
    login_mp4 = os.path.join(OUTPUT_DIR, 'login.mp4')

    # Setup ffmpeg pipe for video encoding
    ffmpeg_cmd = [
        'ffmpeg', '-y',
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-s', f'{W}x{H}',
        '-pix_fmt', 'rgba',
        '-r', str(FPS),
        '-i', '-',
    ]

    has_audio = os.path.exists(AUDIO_PATH)
    if has_audio:
        ffmpeg_cmd.extend(['-i', AUDIO_PATH, '-c:a', 'aac', '-b:a', '192k'])

    ffmpeg_cmd.extend([
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-shortest',
        promo_mp4
    ])

    print("▶ Spawning FFmpeg video pipeline (1080p @ 24fps)...")
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)

    # Frame generation loop
    for frame_idx in range(TOTAL_FRAMES):
        # Progress across scenes
        # Scene 1: 0 - 47 (0.0s - 2.0s)
        # Scene 2: 48 - 95 (2.0s - 4.0s)
        # Scene 3: 96 - 143 (4.0s - 6.0s)
        # Scene 4: 144 - 185 (6.0s - 7.7s)
        # Scene 5: 186 - 239 (7.7s - 10.0s)

        if frame_idx < 48:
            # Scene 1: Chaos
            p = frame_idx / 48.0
            zoom = 1.00 + 0.08 * ease_in_out(p)
            base = apply_zoom_pan(img_chaos, zoom, 0.5, 0.5)
            # Fade in from black in first 8 frames
            fade_in = min(1.0, frame_idx / 8.0)
            frame_img = Image.alpha_composite(base, hud_chaos)
            if fade_in < 1.0:
                dark = Image.new('RGBA', (W, H), (0, 0, 0, int(255 * (1.0 - fade_in))))
                frame_img = Image.alpha_composite(frame_img, dark)

        elif frame_idx < 96:
            # Scene 2: Grid
            p = (frame_idx - 48) / 48.0
            zoom = 1.06 - 0.06 * ease_in_out(p)
            base = apply_zoom_pan(img_grid, zoom, 0.5, 0.5)
            frame_img = Image.alpha_composite(base, hud_grid)

            # Cross-dissolve from scene 1
            if frame_idx < 56:
                blend = (frame_idx - 48) / 8.0
                p_prev = (frame_idx) / 48.0
                prev_base = apply_zoom_pan(img_chaos, 1.00 + 0.08 * p_prev, 0.5, 0.5)
                prev_frame = Image.alpha_composite(prev_base, hud_chaos)
                frame_img = Image.blend(prev_frame, frame_img, blend)

        elif frame_idx < 144:
            # Scene 3: 3D City
            p = (frame_idx - 96) / 48.0
            zoom = 1.01 + 0.08 * ease_in_out(p)
            pan_x = 0.5 - 0.08 * p
            pan_y = 0.5 - 0.05 * p
            base = apply_zoom_pan(img_city, zoom, pan_x, pan_y)
            frame_img = Image.alpha_composite(base, hud_city)

            # Cross-dissolve from scene 2
            if frame_idx < 104:
                blend = (frame_idx - 96) / 8.0
                prev_base = apply_zoom_pan(img_grid, 1.0, 0.5, 0.5)
                prev_frame = Image.alpha_composite(prev_base, hud_grid)
                frame_img = Image.blend(prev_frame, frame_img, blend)

        elif frame_idx < 186:
            # Scene 4: Phone & Voice AI
            p = (frame_idx - 144) / 42.0
            zoom = 1.00 + 0.07 * ease_in_out(p)
            base = apply_zoom_pan(img_phone, zoom, 0.45, 0.5)
            frame_img = Image.alpha_composite(base, hud_phone)

            # Cross-dissolve from scene 3
            if frame_idx < 152:
                blend = (frame_idx - 144) / 8.0
                prev_base = apply_zoom_pan(img_city, 1.09, 0.42, 0.45)
                prev_frame = Image.alpha_composite(prev_base, hud_city)
                frame_img = Image.blend(prev_frame, frame_img, blend)

        else:
            # Scene 5: Badge & Brand Reveal
            p = (frame_idx - 186) / 54.0
            fade_out = 1.0 if frame_idx < 230 else max(0.0, (240 - frame_idx) / 10.0)
            frame_img = render_badge_frame(img_badge, p, fade_out)

            # Cross-dissolve from scene 4
            if frame_idx < 192:
                blend = (frame_idx - 186) / 6.0
                prev_base = apply_zoom_pan(img_phone, 1.07, 0.45, 0.5)
                prev_frame = Image.alpha_composite(prev_base, hud_phone)
                frame_img = Image.blend(prev_frame, frame_img, blend)

        # Pipe raw bytes to ffmpeg
        proc.stdin.write(frame_img.tobytes())

        if frame_idx % 48 == 0 or frame_idx == TOTAL_FRAMES - 1:
            print(f"  ⚡ Rendered frame {frame_idx + 1}/{TOTAL_FRAMES} ({(frame_idx+1)/TOTAL_FRAMES*100:.1f}%)")

    proc.stdin.close()
    proc.wait()

    # Also update login.mp4 so the desktop app's IntroVideo plays the new motion graphics video!
    if os.path.exists(promo_mp4):
        import shutil
        shutil.copy2(promo_mp4, login_mp4)
        print(f"✅ Video successfully created and synced:")
        print(f"   • Promo Video: {promo_mp4} ({os.path.getsize(promo_mp4)/1024/1024:.2f} MB)")
        print(f"   • App Intro:   {login_mp4}")


if __name__ == '__main__':
    main()
