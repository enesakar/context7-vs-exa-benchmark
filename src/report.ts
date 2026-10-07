// Builds results/report.md from the jsonl files.
// Labels are recomputed from the saved payloads and answers with the current questions.json
// (rows without a payload keep their saved labels),
// so a pattern fix applies to every setup without re-running any API calls.
// If docs-check.json exists, every table is printed for the full set and for the cleaned set.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { readJsonl, median, RESULTS, ROOT, loadQuestions, classify, codeOnly, resultTexts, type Label } from './lib.ts'

const pct = (a: number, b: number) => (b ? `${a} / ${b} (${((100 * a) / b).toFixed(1)}%)` : '–')
const count = (xs: Label[], l: Label) => xs.filter((x) => x === l).length
const four = (xs: Label[]) => (['current', 'mixed', 'stale', 'neither'] as Label[]).map((l) => count(xs, l)).join(' / ')
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

const questions = new Map(loadQuestions().map((q) => [q.id, q]))
const ret = readJsonl<any>('retrieval.jsonl')
  .filter((r) => questions.has(r.qid))
  .map((r) => {
    if (!r.payload) return r // published results keep labels only; rerun to regenerate payloads
    const q = questions.get(r.qid)!
    return { ...r, payloadLabel: classify(r.payload, q), resultLabels: resultTexts(r.setup, r.payload).map((t) => classify(t, q)) }
  })
const ag = readJsonl<any>('agent.jsonl')
  .filter((r) => questions.has(r.qid))
  .map((r) => {
    const q = questions.get(r.qid)!
    return { ...r, variant: r.variant ?? 'plain', answerLabel: classify(r.answer, q), codeLabel: classify(codeOnly(r.answer), q) }
  })

const docsCheckPath = `${ROOT}docs-check.json`
const docsCheck: { id: string; verdict: string }[] = existsSync(docsCheckPath) ? JSON.parse(readFileSync(docsCheckPath, 'utf8')) : []
const excluded = new Set(docsCheck.filter((d) => d.verdict === 'stale').map((d) => d.id))

function sections(keep: (qid: string) => boolean, title: string): string[] {
  const out = [`# ${title} (${[...questions.keys()].filter(keep).length} questions)`, '']
  const R = ret.filter((r) => keep(r.qid))
  const A = ag.filter((r) => keep(r.qid))
  for (const variant of ['plain', 'versioned']) {
    const setups = [...new Set(R.filter((r) => r.variant === variant).map((r) => r.setup))].sort()
    if (!setups.length) continue
    out.push(
      `## Retrieval — ${variant === 'plain' ? 'questions without a version' : 'questions with the major version'}`,
      '',
      table(
        ['Setup', 'Searches', 'Current-only payloads', 'Mixed', 'Stale-only', 'Neither', 'Stale-only results', 'Results with any old name', 'Top result current / stale', 'Median tokens', 'Median latency'],
        setups.map((setup) => {
          const rs = R.filter((r) => r.setup === setup && r.variant === variant)
          const payloads = rs.map((r) => r.payloadLabel as Label)
          const results = rs.flatMap((r) => r.resultLabels as Label[])
          const tops = rs.map((r) => (r.resultLabels[0] ?? 'neither') as Label)
          return [
            setup, rs.length, pct(count(payloads, 'current'), rs.length), count(payloads, 'mixed'), count(payloads, 'stale'), count(payloads, 'neither'),
            pct(count(results, 'stale'), results.length), pct(count(results, 'stale') + count(results, 'mixed'), results.length),
            `${count(tops, 'current')} / ${count(tops, 'stale')}`,
            Math.round(median(rs.map((r) => r.tokens))).toLocaleString('en-US'), `${(median(rs.map((r) => r.ms)) / 1000).toFixed(1)} s`,
          ]
        }),
      ),
      '',
    )
  }
  const keys = [...new Set(A.map((r) => `${r.variant}|${r.model}|${r.condition}`))].sort()
  if (keys.length) {
    out.push(
      '## Agent answers (questions without a version; variant ctx = one line of project context with library and version)',
      '',
      table(
        ['Variant', 'Model', 'Tool', 'Runs', 'Code current / mixed / stale / neither', 'Answer current / mixed / stale / neither', 'Input tokens (total)', 'Median input tokens', 'Tool calls'],
        keys.map((k) => {
          const [variant, model, condition] = k.split('|')
          const rs = A.filter((r) => r.variant === variant && r.model === model && r.condition === condition)
          return [
            variant, model, condition, rs.length, four(rs.map((r) => r.codeLabel)), four(rs.map((r) => r.answerLabel)),
            rs.reduce((s, r) => s + (r.inputTokens ?? 0), 0).toLocaleString('en-US'),
            Math.round(median(rs.map((r) => r.inputTokens ?? 0))).toLocaleString('en-US'),
            rs.reduce((s, r) => s + r.toolCalls.length, 0),
          ]
        }),
      ),
      '',
    )
  }
  return out
}

const out = sections(() => true, 'All questions')
if (docsCheck.length) {
  out.push(...sections((qid) => !excluded.has(qid), 'Cleaned set: excluding questions whose official docs page still uses the old API'))
  out.push(`Excluded: ${[...excluded].join(', ') || 'none'}`, '')
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(`${RESULTS}/report.md`, out.join('\n'))
console.log(out.join('\n'))
