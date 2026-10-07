# Context7 vs Exa: freshness benchmark

Does a search tool give a coding agent the current API? This benchmark sends questions about 2026 API renames and removals to [Context7](https://context7.com) and [Exa](https://exa.ai), and checks every result for the old and the new API name.

Blog post: [Context7 vs Exa: Fresher Docs in a Tenth of the Tokens](https://upstash.com/blog/context7-vs-exa). We build Context7, which is why the questions, code and results are public.

## Results

44 questions (cleaned set), each naming the library and its version, 2 runs per setup:

| Setup | Responses with only the current API | Results with only the old API | First result with only the old API | Median tokens | Median latency |
| --- | --- | --- | --- | --- | --- |
| Context7 Search | 52 / 88 (59.1%) | 42 / 377 (11.1%) | 10 / 88 | 828 | 4.3 s |
| Exa, fast search with highlights | 22 / 88 (25.0%) | 166 / 880 (18.9%) | 6 / 88 | 7,609 | 0.3 s |
| Exa, AI SDK tool defaults | 16 / 88 (18.2%) | 184 / 880 (20.9%) | 4 / 88 | 8,629 | 3.8 s |

`npm run report` prints every table: all 47 questions and the cleaned 44, questions with and without a version, Context7 with library and version hints, and the agent runs.

## What's in this repo

| Path | What it is |
| --- | --- |
| `questions.json` | 47 questions: library, version, old and new API, the question with and without a version, regexes for the old and new API, official source |
| `docs-check.json` | For each question, the library's current official docs page for that feature, and whether its code examples use the old API |
| `src/retrieval.ts` | Sends every question to every search setup and labels the results |
| `src/agent.ts` | Gives every question to a Claude Sonnet 5.5 agent (AI SDK 7) with no tool, Context7 or Exa |
| `src/report.ts` | Builds the tables in `results/report.md` |
| `results/retrieval.jsonl` | One row per search: setup, query, latency, tokens, labels for the response and for each result, result URLs |
| `results/agent.jsonl` | One row per agent run: tool calls, input tokens, labels, and the final answer |

The raw search responses are not included, because they contain other sites' content. Run the benchmark to regenerate them.

## Method

### Questions
1. 47 API renames and removals from 2026 releases of 34 libraries (31 JS, 16 Python), each confirmed in the library's migration guide, changelog or release notes.
2. The old API is deprecated or removed in the latest version, and the old and new names are distinct code tokens.
3. Every question has two forms: without a version, and with the library's version.

### Setups
1. `context7`: Context7 Search API (`@upstash/context7-sdk`, plain text), question only.
2. `context7-hints`: the same, plus `library` and `version` hints taken from the question's metadata.
3. `exa-default`: `webSearch()` from `@exalabs/ai-sdk` with its defaults (10 results, up to 3,000 characters of text each).
4. `exa-fast-highlights`: Exa search with `type: "fast"` and highlights, the setup Exa's docs recommend for coding questions.

### Labels
Every response, and every result inside it, is labeled with regexes: **current** (new API only), **mixed** (both), **stale** (old API only) or **neither**. Tokens are counted with o200k on the exact text each tool passes to the model.

### Cleaned set
Rule, written before checking: drop a question if the library's current official docs page for that feature uses the old API in any code example (migration guides, changelogs and release notes don't count). This removed `stripe-node-sdk`, `pnpm` and `astro-2`. The check was done on the official sites directly, never through Context7 or Exa.

### Pattern corrections
The docs check found three places where the official docs use a newer API than our patterns expected (`createMcpHandler`, `client.interactions.create`, and `ThemeProvider` imported from `expo-router`). They were added to `new_patterns` and apply to every setup.

### Agent
`claude-sonnet-5-5` with AI SDK 7, `stopWhen: isStepCount(5)`, 2 runs per question and condition. Variant `plain` gets the question without a version. Variant `ctx` adds one line of project context, such as "This project uses TanStack Table 9.0.0". The code blocks and the whole answer are labeled separately.

## Run it

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY, CONTEXT7_API_KEY, EXA_API_KEY
npm run retrieval
npm run agent           # VARIANT=ctx for the project-context variant
npm run report          # writes results/report.md
```

Options (env vars): `RUNS`, `CONCURRENCY`, `ONLY=id1,id2` for a subset, `MODELS=a,b`. Both runners resume where they stopped. Move the published `results/` aside first if you want a clean run.

Run on 2026-10-07 with `ai` 7.0.130, `@upstash/context7-sdk` 0.5.0, `@exalabs/ai-sdk` 2.1.0 and `exa-js` 2.25.0.
