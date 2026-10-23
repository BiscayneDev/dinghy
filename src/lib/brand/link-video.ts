/** Versioned, public, downloadable MP4. No private title, body, or account data
 * is ever sent to this URL. Keep 1200x630 in step with our image fallback.
 * Rebuild with scripts/build-link-preview.sh, not in a request handler. */
export const LINK_VIDEO = {
    url: 'https://www.getdinghy.sh/dinghy-link-preview-v1.mp4',
    type: 'video/mp4',
    width: 1200,
    height: 630,
} as const
