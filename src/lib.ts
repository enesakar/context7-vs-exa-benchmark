import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'

export type Question = {
  id: string
  library: string
  version: string
  release_date: string
  old_api: string
  new_api: string
  old_patterns: string[]
  new_patterns: string[]
  question: string
  question_with_version: string
  source_url: string
  hint_library: string
  hint_version: string
}

export type Label = 'current' | 'mixed' | 'stale' | 'neither'

export const ROOT = new URL('..', import.meta.url).pathname
export const RESULTS = `${ROOT}results`

export function loadQuestions(): Question[] {
  const qs: Question[] = JSON.parse(readFileSync(`${ROOT}questions.json`, 'utf8'))
  for (const q of qs) {
    for (const p of [...q.old_patterns, ...q.new_patterns]) new RegExp(p, 'm') // fail fast on a bad pattern
  }
  const only = process.env.ONLY?.split(',')
  return only ? qs.filter((q) => only.includes(q.id)) : qs
}

// A text is "current" when it has the new API and none of the old one.
export function classify(text: string, q: Question): Label {
  const hasNew = q.new_patterns.some((p) => new RegExp(p, 'm').test(text))
  const hasOld = q.old_patterns.some((p) => new RegExp(p, 'm').test(text))
  if (hasNew && hasOld) return 'mixed'
  if (hasNew) return 'current'
  if (hasOld) return 'stale'
  return 'neither'
}

export const tokens = (text: string) => encode(text).length

// Fenced code blocks only; falls back to the whole answer when there are none.
export function codeOnly(text: string): string {
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1])
  return blocks.length ? blocks.join('\n') : text
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export function appendJsonl(file: string, row: unknown) {
  if (!existsSync(RESULTS)) mkdirSync(RESULTS, { recursive: true })
  appendFileSync(`${RESULTS}/${file}`, JSON.stringify(row) + '\n')
}

export function readJsonl<T>(file: string): T[] {
  const path = `${RESULTS}/${file}`
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

export function requireEnv(...keys: string[]) {
  const missing = keys.filter((k) => !process.env[k])
  if (missing.length) {
    console.error(`Missing in exa-bench/.env: ${missing.join(', ')}`)
    process.exit(1)
  }
}

// Each snippet starts with a "### " heading (outside code fences); "Library:" and "---" lines carry over to the next one.
export function splitContext7(payload: string): string[] {
  const chunks: string[] = []
  let cur: string[] = []
  let fence = false
  for (const line of payload.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && line.startsWith('### ') && cur.some((l) => l.startsWith('### '))) {
      chunks.push(cur.join('\n'))
      cur = []
    }
    cur.push(line)
  }
  if (cur.some((l) => l.trim())) chunks.push(cur.join('\n'))
  return chunks
}

export function exaResults(data: any) {
  return (data.results ?? []).map((r: any) => ({
    url: r.url,
    text: [r.title, r.url, r.text, ...(r.highlights ?? []), r.summary].filter(Boolean).join('\n'),
  }))
}

// Result texts for a saved retrieval row, split the same way as at run time.
export const resultTexts = (setup: string, payload: string): string[] =>
  setup.startsWith('context7') ? splitContext7(payload) : exaResults(JSON.parse(payload)).map((r: { text: string }) => r.text)
