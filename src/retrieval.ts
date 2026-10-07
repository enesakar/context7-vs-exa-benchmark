// Phase 1: send every question to every search setup and label what comes back.
// Resumable: rows already in results/retrieval.jsonl are skipped. Errors are not saved, so a rerun retries them.
import { loadQuestions, classify, tokens, pool, appendJsonl, readJsonl, requireEnv } from './lib.ts'
import { SETUPS } from './tools.ts'

requireEnv('CONTEXT7_API_KEY', 'EXA_API_KEY')

const RUNS = Number(process.env.RUNS ?? 2)
const VARIANTS = ['plain', 'versioned'] as const
const FILE = 'retrieval.jsonl'

const done = new Set(readJsonl<any>(FILE).map((r) => `${r.qid}|${r.variant}|${r.run}|${r.setup}`))
const jobs = loadQuestions().flatMap((q) =>
  VARIANTS.flatMap((variant) =>
    Array.from({ length: RUNS }, (_, run) =>
      Object.keys(SETUPS).map((setup) => ({ q, variant, run, setup })),
    ).flat(),
  ),
)
  // the hinted setup already carries the version, so it only runs on the questions without one
  .filter((j) => !(j.setup === 'context7-hints' && j.variant === 'versioned'))
  .filter((j) => !done.has(`${j.q.id}|${j.variant}|${j.run}|${j.setup}`))

console.log(`${jobs.length} searches to run`)
let n = 0
let failed = 0
await pool(jobs, Number(process.env.CONCURRENCY ?? 4), async ({ q, variant, run, setup }) => {
  const query = variant === 'plain' ? q.question : q.question_with_version
  const r = await SETUPS[setup](query, q)
  n++
  if (r.error) {
    failed++
    console.log(`[${n}/${jobs.length}] ${setup} ${q.id} ERROR ${r.error.slice(0, 160)}`)
    return
  }
  const labels = r.results.map((x) => classify(x.text, q))
  appendJsonl(FILE, {
    qid: q.id,
    variant,
    run,
    setup,
    query,
    ms: r.ms,
    tokens: tokens(r.payload),
    payloadLabel: classify(r.payload, q),
    resultLabels: labels,
    urls: r.results.map((x) => x.url ?? null),
    payload: r.payload,
  })
  console.log(`[${n}/${jobs.length}] ${setup} ${q.id} ${variant} → ${classify(r.payload, q)} (${r.ms} ms)`)
})
console.log(failed ? `Done with ${failed} errors. Rerun to retry them.` : 'Done.')
