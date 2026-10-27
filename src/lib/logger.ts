// Structured logger that never logs sensitive data (tokens, keys).
// Uses console methods which Vercel captures automatically.

type LogLevel = 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  context?: Record<string, unknown>
  timestamp: string
}

function formatEntry(entry: LogEntry): string {
  const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : ''
  return `[${entry.level.toUpperCase()}] ${entry.message}${ctx}`
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    message,
    context: sanitizeContext(context),
    timestamp: new Date().toISOString(),
  }

  const formatted = formatEntry(entry)

  switch (level) {
    case 'error':
      console.error(formatted)
      break
    case 'warn':
      console.warn(formatted)
      break
    default:
      console.log(formatted)
  }
}

// Normalize separators and casing before comparing, including nested objects.
const SENSITIVE_KEYS = new Set([
  'accesstoken', 'refreshtoken', 'token', 'secret', 'password', 'key',
  'authorization', 'apikey', 'hash', 'signingkey', 'clientsecret',
  'cookie', 'setcookie', 'privatekey',
])

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  if (depth >= 20) return '[Truncated]'
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map(item => sanitizeValue(item, seen, depth + 1))
    const sanitized: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, '')
      Object.defineProperty(sanitized, key, {
        value: SENSITIVE_KEYS.has(normalized) ? '[REDACTED]' : sanitizeValue(item, seen, depth + 1),
        enumerable: true,
      })
    }
    return sanitized
  } finally {
    seen.delete(value)
  }
}

function sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!context) return undefined
  return sanitizeValue(context, new WeakSet(), 0) as Record<string, unknown>
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
}
