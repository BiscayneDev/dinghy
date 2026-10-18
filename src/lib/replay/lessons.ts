/**
 * The persistent improvement harness: an append-only lessons file. Each
 * accepted probe writes one generalized lesson with its evidence, so the
 * same failure class gets fixed once instead of rediscovered. Lessons are
 * review artifacts, not live config - production never reads this file, and
 * every lesson lands as needs_review (voice edits especially: Halsey gates
 * those). The file is committable, so the writer hard-refuses anything that
 * carries the user's words.
 */

import { randomUUID } from 'crypto'
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { Lesson } from './types'

const MAX_LESSON_CHARS = 400
const MAX_OVERLAY_CHARS = 800

/** True when text carries a verbatim run of words from the ask (4+ words in a row). */
export function quotesUserText(text: string, ask: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 0)
    const askWords = norm(ask)
    const textWords = new Set(norm(text).join(' ').split(' '))
    const joined = ' ' + norm(text).join(' ') + ' '
    for (let i = 0; i + 4 <= askWords.length; i++) {
        const phrase = ' ' + askWords.slice(i, i + 4).join(' ') + ' '
        if (joined.includes(phrase)) return true
    }
    // a distinctive long token (name, place, handle) appearing at all is enough
    for (const w of askWords) if (w.length >= 12 && textWords.has(w)) return true
    return false
}

export function makeLesson(
    draft: Omit<Lesson, 'id' | 'createdAt' | 'status'>,
    ask: string
): Lesson {
    if (!draft.lesson.trim()) throw new Error('lesson text is empty')
    if (draft.lesson.length > MAX_LESSON_CHARS) throw new Error(`lesson over ${MAX_LESSON_CHARS} chars`)
    if (draft.overlay.length > MAX_OVERLAY_CHARS) throw new Error(`overlay over ${MAX_OVERLAY_CHARS} chars`)
    if (quotesUserText(draft.lesson, ask) || quotesUserText(draft.overlay, ask)) {
        throw new Error('lesson or overlay quotes the user\'s message; generalize it first')
    }
    return { ...draft, id: randomUUID(), createdAt: new Date().toISOString(), status: 'needs_review' }
}

export function appendLesson(path: string, lesson: Lesson): void {
    const dir = dirname(path)
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(path, JSON.stringify(lesson) + '\n')
}

export function loadLessons(path: string): Lesson[] {
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Lesson)
}

/** Accepted overlays only; the loop applies these before proposing new candidates so wins compound. */
export function acceptedOverlays(lessons: Lesson[]): string[] {
    return lessons.filter((l) => l.status === 'accepted').map((l) => l.overlay)
}
