// Phase 2: give each question (no version in it) to an AI SDK agent with no tool, Context7, or Exa, and label the answer.
// Resumable like retrieval.ts.
import { generateText, isStepCount } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { loadQuestions, classify, codeOnly, pool, appendJsonl, readJsonl, requireEnv } from './lib.ts'
import { context7Tool, exaTool } from './tools.ts'

requireEnv('ANTHROPIC_API_KEY', 'CONTEXT7_API_KEY', 'EXA_API_KEY')

const MODELS = (process.env.MODELS ?? 'claude-sonnet-5-5').split(',')
const CONDITIONS = ['none', 'context7', 'exa'] as const
const RUNS = Number(process.env.RUNS ?? 1)
const FILE = 'agent.jsonl'
// 'ctx' adds the same one-line project context to every condition, like an agent that read package.json
const VARIANT = process.env.VARIANT ?? 'plain'
const context = (q: { hint_library: string; hint_version: string }) =>
  VARIANT === 'ctx' ? ` This project uses ${q.hint_library} ${q.hint_version}.` : ''

const TOOLS = { context7: { searchDocs: context7Tool }, exa: { webSearch: exaTool } } as const
const INSTRUCTIONS = {
  none: 'Answer with a short code example using the current API.',
  context7: 'Use searchDocs before answering. Answer with a short code example using the current API.',
  exa: 'Use webSearch before answering. Answer with a short code example using the current API.',
}

const done = new Set(readJsonl<any>(FILE).map((r) => `${r.qid}|${r.model}|${r.condition}|${r.run}|${r.variant ?? 'plain'}`))
const jobs = loadQuestions().flatMap((q) =>
  MODELS.flatMap((model) =>
    CONDITIONS.flatMap((condition) => Array.from({ length: RUNS }, (_, run) => ({ q, model, condition, run }))),
  ),
).filter((j) => !done.has(`${j.q.id}|${j.model}|${j.condition}|${j.run}|${VARIANT}`))

console.log(`${jobs.length} agent runs to do`)
let n = 0
let failed = 0
await pool(jobs, Number(process.env.CONCURRENCY ?? 3), async ({ q, model, condition, run }) => {
  const start = performance.now()
  try {
    const result = await generateText({
      model: anthropic(model),
      instructions: INSTRUCTIONS[condition] + context(q),
      prompt: q.question,
      tools: condition === 'none' ? undefined : (TOOLS[condition] as any),
      stopWhen: isStepCount(5),
      maxOutputTokens: 1500,
      maxRetries: 2,
    })
    const answer = result.finalStep.text || result.text
    appendJsonl(FILE, {
      qid: q.id,
      variant: VARIANT,
      model,
      condition,
      run,
      ms: Math.round(performance.now() - start),
      finishReason: result.finishReason,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      toolCalls: result.toolCalls.map((c: any) => ({ tool: c.toolName, input: c.input })),
      answerLabel: classify(answer, q),
      codeLabel: classify(codeOnly(answer), q),
      answer,
    })
    n++
    console.log(`[${n}/${jobs.length}] ${model} ${condition} ${q.id} → answer ${classify(answer, q)}, code ${classify(codeOnly(answer), q)}`)
  } catch (e) {
    n++
    failed++
    console.log(`[${n}/${jobs.length}] ${model} ${condition} ${q.id} ERROR ${String(e).slice(0, 200)}`)
  }
})
console.log(failed ? `Done with ${failed} errors. Rerun to retry them.` : 'Done.')
