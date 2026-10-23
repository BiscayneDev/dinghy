#!/usr/bin/env bash
# Build-only: fixed branded panel over a moving coast, using owned artwork.
# Production needs neither ffmpeg nor per-file encoding.
set -euo pipefail
cd "$(dirname "$0")/.."
panel=$(mktemp --suffix=.png)
trap 'rm -f "$panel"' EXIT
npx tsx scripts/render-link-preview.tsx "$panel"
ffmpeg -hide_banner -loglevel error -y -i public/hero-coast.jpg -i "$panel" \
  -filter_complex "[0:v]scale=2400:1260:force_original_aspect_ratio=increase,crop=2400:1260,zoompan=z='1.025+0.045*(1-cos(2*PI*on/96))':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=96:s=1200x630:fps=24[coast];[coast][1:v]overlay=0:0,format=yuv420p[out]" \
  -map '[out]' -frames:v 96 -c:v libx264 -profile:v main -level 3.1 -crf 25 -preset slow \
  -an -movflags +faststart public/dinghy-link-preview-v1.mp4
