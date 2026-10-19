/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createResponseText, getMaxTokens, getPrimaryModel } from '../workflow/ai'
import { buildRichSummaryInput, composeReviewedScript, generateRichSummary, parseRichSummary, parseScriptReview } from '../workflow/editorial-pipeline'

const article = { source: 'Publisher', title: 'Funding', content: 'Thomas Insel, former director of the National Institute of Mental Health, discussed the research. About $300 million was announced since June.' }
const summary = { relevant: true, reason: 'Research funding', overview: 'A new research investment.', people: [{ text: 'Thomas Insel is a former NIMH director.', evidence: [0] }], findings: [{ text: 'About $300 million was announced since June.', evidence: [0] }], context: [], examples: [], limitations: [] }
const draft = 'Aaron: Thomas Insel used to lead the NIH.\nJamie: The investment includes several research hubs.'
const checks = (script: string) => script.split('\n').filter(Boolean).map((_, index) => ({ line: index + 1, assessment: 'Compared this turn with the source.', evidence: [{ articleIndex: 0, paragraphs: [0] }] }))
const correction = { checks: checks(draft), approved: false, issues: [{ line: 1, original: draft.split('\n')[0], replacement: 'Aaron: Thomas Insel is a former NIMH director.', category: 'fact', explanation: 'NIMH is not NIH.', evidence: [{ articleIndex: 0, paragraphs: summary.people[0].evidence }] }], warnings: [] }

test('rich summaries preserve attributed identities and numerical context, rejecting invented evidence or incomplete article coverage', () => {
  assert.deepEqual(parseRichSummary(JSON.stringify(summary), article), summary)
  assert.throws(() => parseRichSummary(JSON.stringify({ ...summary, people: [{ ...summary.people[0], evidence: [99] }] }), article), /paragraph IDs/)
  const input = buildRichSummaryInput([article], [{ articleIndex: 0, summary }])!
  assert.match(input, /former NIMH director/)
  assert.match(input, /300 million was announced since June/)
  assert.doesNotMatch(input, /evidence|https?:/)
  assert.throws(() => buildRichSummaryInput([article, article], [{ articleIndex: 0, summary }]), /Every collected/)
  const irrelevant = { relevant: false, reason: 'Off topic', overview: '', people: [], findings: [], context: [], examples: [], limitations: [] }
  assert.equal(buildRichSummaryInput([article], [{ articleIndex: 0, summary: irrelevant }]), null)
})

test('invalid evidence gets one automatic correction request without accepting invented details', async () => {
  let calls = 0
  const result = await generateRichSummary(article, 'Preserve article details.', async (instructions) => {
    calls++
    if (calls === 1)
      return JSON.stringify({ ...summary, people: [{ ...summary.people[0], evidence: [99] }] })
    assert.match(instructions, /Use only the paragraph IDs/)
    return JSON.stringify(summary)
  })
  assert.equal(calls, 2)
  assert.deepEqual(result, summary)
})

test('review rejects fabricated citations, stale line edits, unchanged edits and inconsistent approval', () => {
  assert.deepEqual(parseScriptReview(JSON.stringify(correction), draft, [article]), correction)
  assert.throws(() => parseScriptReview(JSON.stringify({ ...correction, checks: [] }), draft, [article]), /every script turn/)
  assert.throws(() => parseScriptReview(JSON.stringify({ ...correction, checks: [correction.checks[0], correction.checks[0]] }), draft, [article]), /exactly once/)
  assert.throws(() => parseScriptReview(JSON.stringify({ ...correction, approved: true }), draft, [article]), /Approval/)
  assert.throws(() => parseScriptReview(JSON.stringify({ ...correction, issues: [{ ...correction.issues[0], original: 'Wrong turn' }] }), draft, [article]), /exact existing line/)
  assert.throws(() => parseScriptReview(JSON.stringify({ ...correction, issues: [{ ...correction.issues[0], replacement: correction.issues[0].original }] }), draft, [article]), /real, single-turn/)
  assert.throws(() => parseScriptReview(JSON.stringify({ ...correction, issues: [{ ...correction.issues[0], evidence: [{ articleIndex: 0, paragraphs: [99] }] }] }), draft, [article]), /paragraph IDs/)
})

test('automatic review corrects only the evidenced turn and checks the result against originals in a fresh request', async () => {
  const checkpoints: unknown[] = []
  let passes = 0
  const script = await composeReviewedScript({
    articles: [article],
    markers: ['Aaron', 'Jamie'],
    draft: async () => draft,
    review: async (pass, input, current) => {
      passes++
      const packet = JSON.parse(input)
      assert.deepEqual(packet.articles[0].content, [{ paragraph: 0, text: article.content }])
      assert.equal(packet.script[0].line, 1)
      assert.equal(pass, passes - 1)
      if (pass === 0)
        return parseScriptReview(JSON.stringify(correction), current, [article])
      assert.equal(current.split('\n')[1], draft.split('\n')[1])
      assert.match(current, /former NIMH director/)
      return { checks: checks(current), approved: true, issues: [], warnings: [] }
    },
    checkpoint: async (state) => { checkpoints.push(state) },
  })
  assert.equal(passes, 2)
  assert.equal(checkpoints.length, 4)
  assert.equal(script, `${correction.issues[0].replacement}\n${draft.split('\n')[1]}`)
})

test('two repair rounds continue with the last usable script even when review notes remain', async () => {
  let calls = 0
  const statuses: string[] = []
  const result = await composeReviewedScript({
    articles: [article],
    markers: ['Aaron', 'Jamie'],
    draft: async () => draft,
    review: async (_pass, _input, current) => {
      calls++
      return parseScriptReview(JSON.stringify({ ...correction, issues: [{ ...correction.issues[0], original: current.split('\n')[0], replacement: `Aaron: Unresolved claim ${calls}.` }] }), current, [article])
    },
    checkpoint: async (state) => { statuses.push(state.status) },
  })
  assert.match(result, /Unresolved claim 2/)
  assert.equal(calls, 3)
  assert.equal(statuses.at(-1), 'fallback')
})

test('a reviewer cannot approve broken formatting or inject a different speaker', async () => {
  await assert.rejects(composeReviewedScript({
    articles: [article],
    markers: ['Aaron', 'Jamie'],
    draft: async () => `${draft}\nhttps://example.com`,
    review: async (_pass, _input, current) => ({ checks: checks(current), approved: true, issues: [], warnings: [] }),
    checkpoint: async () => {},
  }), /No usable spoken script/)
  const fallback = await composeReviewedScript({
    articles: [article],
    markers: ['Aaron', 'Jamie'],
    draft: async () => draft,
    review: async () => ({ ...correction, issues: [{ ...correction.issues[0], category: 'fact', replacement: 'Unknown: A different person.' }] }),
    checkpoint: async () => {},
  })
  assert.equal(fallback, draft)
})

test('a failed review service keeps the last usable draft and records the reason', async () => {
  const states: { status: string, reason?: string }[] = []
  const result = await composeReviewedScript({
    articles: [article],
    markers: ['Aaron', 'Jamie'],
    draft: async () => draft,
    review: async () => { throw new Error('Temporary review outage') },
    checkpoint: async (state) => { states.push(state) },
  })
  assert.equal(result, draft)
  assert.equal(states.at(-1)?.status, 'fallback')
  assert.match(states.at(-1)?.reason || '', /Temporary review outage/)
})

test('the reviewer model can differ from the writing override without replacing it', async () => {
  const env = { OPENCODE_API_KEY: 'test', OPENCODE_MODEL: 'writer', OPENCODE_REVIEW_MODEL: 'deepseek-reviewer' }
  const runtimeAi = { provider: 'opencode' as const, model: 'admin', modelOverride: env.OPENCODE_REVIEW_MODEL, reasoning: true }
  assert.equal(getPrimaryModel(env, 'opencode', runtimeAi), 'deepseek-reviewer')
  assert.equal(getMaxTokens(env, 'opencode', runtimeAi), 32768)
  const previous = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(init?.body as string).model, 'deepseek-reviewer')
    assert.deepEqual(JSON.parse(init?.body as string).thinking, { type: 'enabled' })
    assert.equal(JSON.parse(init?.body as string).reasoning_effort, 'high')
    return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })
  }
  try {
    await createResponseText({ env, runtimeAi, model: 'deepseek-reviewer', instructions: 'Review', input: 'Article' })
  }
  finally { globalThis.fetch = previous }
})
