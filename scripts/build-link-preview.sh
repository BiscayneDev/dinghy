#!/usr/bin/env bash
# Rebuild the small, silent Messages loop from Dinghy's existing owned artwork.
# Build-time only. Production needs no ffmpeg and performs no per-file encoding.
set -euo pipefail
cd "$(dirname "$0")/.."
ffmpeg -hide_banner -loglevel error -y -i public/hero-coast.jpg \
  -vf "scale=2400:1260:force_original_aspect_ratio=increase,crop=2400:1260,zoompan=z='1.025+0.0125*(1-cos(2*PI*on/96))':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=96:s=1200x630:fps=24,format=yuv420p" \
  -frames:v 96 -c:v libx264 -profile:v main -level 3.1 -crf 25 -preset slow \
  -an -movflags +faststart public/dinghy-link-preview-v1.mp4
