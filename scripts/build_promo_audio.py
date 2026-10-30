#!/usr/bin/env python3
"""
Generates synchronized voiceover narration and cinematic soundbed for Task Orchestrator promo video.
"""

import os
import subprocess
from pathlib import Path

AUDIO_DIR = Path('/tmp/to_audio')
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

VOICE = 'Samantha'

lines = [
    # (filename, delay_seconds, text)
    ('vo1.aiff', 0.5, "Managing dozens of autonomous AI terminals shouldn't feel like drowning in chaos."),
    ('vo2.aiff', 5.5, "Meet Task Orchestrator. One native desktop command center that organizes every terminal into a responsive dynamic grid."),
    ('vo3.aiff', 12.5, "Switch to the 3D Developer City view to monitor your entire software ecosystem at a single glance."),
    ('vo4.aiff', 19.5, "Hop on a real-time voice call directly with your terminal. Speak your commands, and your agent responds and codes with you live."),
    ('vo5.aiff', 25.5, "Task Orchestrator. One command. Multiple agents. Complete control.")
]

print("▶ Generating narration voiceover clips using macOS speech engine...")
for fname, delay, text in lines:
    out_path = AUDIO_DIR / fname
    subprocess.run(['say', '-v', VOICE, '-r', '175', text, '-o', str(out_path)], check=True)
    print(f"  ✓ Generated {fname} (scheduled at {delay}s)")

# Now assemble into a single 30-second narration track using ffmpeg adelay and amix
print("▶ Assembling multi-track audio with timing offsets...")

# Adelay in milliseconds (delay * 1000)
filter_complex = (
    f"[0:a]adelay=500|500[a0]; "
    f"[1:a]adelay=5500|5500[a1]; "
    f"[2:a]adelay=12500|12500[a2]; "
    f"[3:a]adelay=19500|19500[a3]; "
    f"[4:a]adelay=25500|25500[a4]; "
    f"[a0][a1][a2][a3][a4]amix=inputs=5:duration=longest:dropout_transition=2[vo]; "
    f"[vo]volume=1.8[vo_boost]"
)

vo_master = AUDIO_DIR / 'vo_master.wav'
subprocess.run([
    'ffmpeg', '-y',
    '-i', str(AUDIO_DIR / 'vo1.aiff'),
    '-i', str(AUDIO_DIR / 'vo2.aiff'),
    '-i', str(AUDIO_DIR / 'vo3.aiff'),
    '-i', str(AUDIO_DIR / 'vo4.aiff'),
    '-i', str(AUDIO_DIR / 'vo5.aiff'),
    '-filter_complex', filter_complex,
    '-map', '[vo_boost]',
    str(vo_master)
], check=True)

print("▶ Generating cinematic cybernetic synth pad / bassline...")
# Generate a lush, dark sci-fi ambient synth drone + bass drop at 5s + riser
music_track = AUDIO_DIR / 'music_bed.wav'

# Synth drone with 55Hz sub-bass, 110Hz pad, high shimmer, and drop at 5s
synth_cmd = (
    "ffmpeg -y -f lavfi -i "
    "\"anoisesrc=d=30:c=pink:r=48000:a=0.015[noise]; "
    "sine=f=55:d=30[sub]; "
    "sine=f=110:d=30[low]; "
    "sine=f=220:d=30[mid]; "
    "sine=f=440:d=30[high]; "
    "[sub][low][mid][high][noise]amix=inputs=5:weights=3 2 1 0.5 0.3[bed]; "
    "[bed]volume=0.35, lowpass=f=800, highpass=f=40[synth_bed]; "
    "[synth_bed]afade=t=in:ss=0:d=2, afade=t=out:st=28:d=2[final_music]\" "
    f"-map \"[final_music]\" {music_track}"
)
subprocess.run(synth_cmd, shell=True, check=True)

# Combine music bed + voiceover into final 30.0s soundtrack
final_audio = Path('/tmp/tto_promo_audio.aac')
mix_cmd = (
    f"ffmpeg -y -i {vo_master} -i {music_track} -filter_complex "
    "\"[0:a]volume=1.6[vo]; [1:a]volume=0.6[bg]; [vo][bg]amix=inputs=2:duration=first:dropout_transition=2[out]\" "
    f"-map \"[out]\" -t 30.0 -c:a aac -b:a 192k {final_audio}"
)
subprocess.run(mix_cmd, shell=True, check=True)

print(f"✅ Final Master Audio Track Created: {final_audio} ({final_audio.stat().st_size / 1024:.1f} KB)")
