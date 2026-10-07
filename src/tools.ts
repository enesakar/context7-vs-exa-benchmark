import { tool } from 'ai'
import { z } from 'zod'
import { Context7, Context7Error } from '@upstash/context7-sdk'
import { webSearch } from '@exalabs/ai-sdk'
import { splitContext7, exaResults, type Question } from './lib.ts'

export type SearchResult = {
  payload: string // exactly what the model would read
  results: { text: string; url?: string }[]
  ms: number
  error?: string
}

let client: Context7 | undefined
const context7 = () => (client ??= new Context7({ apiKey: process.env.CONTEXT7_API_KEY, retry: false, timeout: 60_000 }))

async function timed(fn: () => Promise<Omit<SearchResult, 'ms'>>): Promise<SearchResult> {
  const start = performance.now()
  try {
    const r = await fn()
    return { ...r, ms: Math.round(performance.now() - start) }
  } catch (e) {
    return { payload: '', results: [], ms: Math.round(performance.now() - start), error: String(e) }
  }
}

// Context7 Search, plain text, query only (no library or version hint unless given).
export async function context7Raw(query: string, library?: string, version?: string): Promise<string> {
  try {
    return await context7().search(query, {
      libraries: library ? [library] : undefined,
      version: library ? version : undefined,
      type: 'txt',
    })
  } catch (e) {
    if (e instanceof Context7Error && e.status === 404) return 'No documentation found.'
    throw e
  }
}

export const searchContext7 = (query: string, library?: string, version?: string) =>
  timed(async () => {
    const payload = await context7Raw(query, library, version)
    const results = splitContext7(payload).map((text) => ({ text, url: text.match(/^Source: (\S+)/m)?.[1] }))
    return { payload, results }
  })

// Exa through the official AI SDK tool with its defaults (auto, 10 results, 3,000 chars of text, live crawl as fallback).
const exaDefaultTool = webSearch()
export const searchExaDefault = (query: string) =>
  timed(async () => {
    const data = await (exaDefaultTool as any).execute({ query }, { toolCallId: 'bench', messages: [] })
    return { payload: JSON.stringify(data), results: exaResults(data) }
  })

// Exa's recommended setup for coding questions (exa.ai/docs/reference/context): fast search with highlights.
export const searchExaFast = (query: string) =>
  timed(async () => {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.EXA_API_KEY! },
      body: JSON.stringify({ query, type: 'fast', numResults: 10, contents: { highlights: true } }),
    })
    if (!res.ok) throw new Error(`Exa ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return { payload: JSON.stringify(data), results: exaResults(data) }
  })

export const SETUPS: Record<string, (query: string, q: Question) => Promise<SearchResult>> = {
  context7: (query) => searchContext7(query),
  'context7-hints': (query, q) => searchContext7(query, q.hint_library, q.hint_version),
  'exa-default': (query) => searchExaDefault(query),
  'exa-fast-highlights': (query) => searchExaFast(query),
}

// Agent tools
export const context7Tool = tool({
  description: 'Search library documentation. Library and version hints are optional.',
  inputSchema: z.object({
    query: z.string(),
    library: z.string().optional(),
    version: z.string().describe('Requires a library hint').optional(),
  }),
  execute: ({ query, library, version }) => context7Raw(query, library, version),
})

export const exaTool = exaDefaultTool
