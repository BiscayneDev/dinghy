# Messages video previews

Dinghy's public site metadata and clean hosted file links reference a small,
silent, direct MP4. `og:image` and Twitter's image card remain in place for
clients that do not support video. The original link still opens the file.

- Asset: `public/dinghy-link-preview-v1.mp4`, 1200x630, 4 seconds, H.264 Main,
  yuv420p, no audio, faststart, about 314 KB.
- Artwork: the existing `public/hero-coast.jpg`. No new service or runtime encoder.
- Rebuild: `scripts/build-link-preview.sh` (requires ffmpeg locally).
- Version the filename on visual changes to avoid stale cached previews.
- File metadata includes the video in the FIRST publish. Image/photo enrichment
  does not remove it. No waiting for post-send enrichment to get video metadata.
- Existing private/external-imagery gate also gates video; private file renders
  do not gain a new public media request. The generic asset URL has no user data.
- Root metadata applies to website links. Routes with their own Open Graph
  metadata keep their existing overrides.

## Why a direct MP4

Apple documents `og:video` pointing to a downloadable native video file for
inline playback. HTML embed players are not equivalent. Keep the main HTML
under 1 MB and all preview resources together under 10 MB (Apple's guidelines).
The video is a fixed cream brand panel with the Dinghy mark and existing
headline over a looping move through the coast artwork. Text stays still and
readable while the artwork moves. It is not generated from a private document.

Reference supplied by the user: https://x.com/tolimarchuk/status/2113381475991080986
This quotes https://x.com/pfista/status/2113288415546638515 . The attached phone
recording shows a branded promo playing inside a normal Messages link card,
with the title/domain below. Our path uses that same native inline video
mechanism, with Dinghy artwork rather than copying the other product's clip.

Sources checked October 23, 2026:
- https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages
- https://developer.apple.com/videos/play/tech-talks/205/
- https://ogp.me/

## Verify before release

Tests cover first-publish metadata, image fallback, private gate, enrichment,
escaping, MP4 signature, size and faststart. `ffprobe` confirms codec, dimensions,
pixel format, duration and absence of audio. Visually inspect the actual clip.
After deployment, check the public asset has `video/mp4`, is downloadable without
login and supports byte ranges. Check the served page source, not client-side
DOM only. Send a fresh generated file link in iPhone Messages to check the real
unfurl, loop, muted playback and tap-through. Do not reuse an old cached URL.

A browser video check is not an iPhone Messages check. Playback may vary with
client version, preview cache, user/device settings and network conditions.
