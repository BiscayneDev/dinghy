/** Validates a post-sign-in redirect target: same-origin paths only, never protocol-relative or absolute. */
export function safeNextPath(input: unknown): string | null {
    if (typeof input !== 'string') return null
    const v = input.trim()
    if (!v || v.length > 200) return null
    if (!v.startsWith('/') || v.startsWith('//')) return null
    if (v.includes('\\') || v.includes('://')) return null
    return v
}
