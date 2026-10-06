"""Turns demo-video.spec.ts's raw.webm + timeline.json into the finished MP4.

Everything before the first scene is cut; every wait the recorder marked "fast" plays at up to
12x, marked "sped up" on screen, and never lasts more than about four seconds. Usage:

    python demo-cut.py <DEMO_OUT> [output.mp4]

Needs a full ffmpeg (imageio-ffmpeg's, or one on PATH).
"""

import json
import os
import shutil
import subprocess
import sys

out_dir = sys.argv[1]
target = sys.argv[2] if len(sys.argv) > 2 else os.path.join(out_dir, 'thesis-copilot-demo.mp4')
try:
    import imageio_ffmpeg

    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FFMPEG = shutil.which('ffmpeg') or 'ffmpeg'

timeline = json.load(open(os.path.join(out_dir, 'timeline.json'), encoding='utf-8'))
marks = timeline['marks']
raw = os.path.join(out_dir, 'raw.webm')

probe = subprocess.run([FFMPEG, '-i', raw], capture_output=True, text=True).stderr
duration = None
for line in probe.splitlines():
    if 'Duration:' in line:
        h, m, s = line.split('Duration:')[1].split(',')[0].strip().split(':')
        duration = int(h) * 3600 + int(m) * 60 + float(s)
if duration is None:
    sys.exit('could not read the video length')

start = next(m['t'] for m in marks if m['kind'] == 'scene') / 1000
fast = []
open_at = None
for m in marks:
    if m['kind'] == 'fast-start':
        open_at = m['t'] / 1000
    elif m['kind'] == 'fast-end' and open_at is not None:
        fast.append((open_at, m['t'] / 1000))
        open_at = None

segments = []  # (from, to, speed)
cursor = start
for a, b in fast:
    if b - a < 1.5:
        continue
    if a > cursor:
        segments.append((cursor, a, 1.0))
    segments.append((a, b, max(1.0, min(12.0, (b - a) / 4.0))))
    cursor = b
segments.append((cursor, duration, 1.0))

font = 'C\\:/Windows/Fonts/segoeuib.ttf' if os.name == 'nt' else 'DejaVuSans-Bold.ttf'
parts = []
labels = []
for i, (a, b, speed) in enumerate(segments):
    chain = f'[0:v]trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)/{speed:.3f}'
    if speed > 1.01:
        chain += (
            f",drawtext=fontfile='{font}':text='» sped up':x=w-tw-28:y=24:fontsize=22:"
            'fontcolor=white:box=1:boxcolor=0x111827CC:boxborderw=10'
        )
    chain += ',fps=30,format=yuv420p'
    parts.append(f'{chain}[v{i}]')
    labels.append(f'[v{i}]')
graph = ';'.join(parts) + f";{''.join(labels)}concat=n={len(labels)}:v=1:a=0[out]"

cmd = [
    FFMPEG, '-y', '-i', raw, '-filter_complex', graph, '-map', '[out]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', target,
]
subprocess.run(cmd, check=True)
played = sum((b - a) / s for a, b, s in segments)
print(f'wrote {target}: {played:.0f} s from {duration - start:.0f} s recorded, {len(fast)} waits sped up')
