import type { EditorialArticle } from './editorial-input'
import { z } from 'zod'
import { buildPodcastStoryInput } from './editorial-input'

const paragraphIds = z.array(z.number().int().min(0)).min(1).describe('Array of paragraph ID integers from the article, for example [3,4].')
const detailSchema = z.object({ text: z.string().min(1), evidence: paragraphIds }).strict()
export const richSummarySchema = z.object({
  relevant: z.boolean(),
  reason: z.string(),
  overview: z.string(),
  people: z.array(detailSchema),
  findings: z.array(detailSchema),
  context: z.array(detailSchema),
  examples: z.array(detailSchema),
  limitations: z.array(detailSchema),
}).strict()
export type RichSummary = z.infer<typeof richSummarySchema>
export interface ArticleSummary { articleIndex: number, summary: RichSummary }
export const richSummaryJsonSchema = z.toJSONSchema(richSummarySchema)

export function articleParagraphs(article: EditorialArticle) {
  return article.content.split(/\n\s*\n/u).map(text => text.trim()).filter(Boolean)
}

export function articleEvidence(article: EditorialArticle | undefined, paragraphs: number[]) {
  if (!article)
    throw new Error('Evidence refers to an unknown article')
  const source = articleParagraphs(article)
  return paragraphs.map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= source.length)
      throw new Error('Evidence must refer to paragraph IDs present in the original article')
    return source[index]
  })
}

/** Paragraph IDs locate the original text without asking the model to recopy quotations. */
export function buildArticleEvidenceInput(articles: EditorialArticle[]) {
  const packet = JSON.parse(buildPodcastStoryInput(articles)) as { articles: EditorialArticle[] }
  return JSON.stringify({ articles: packet.articles.map(article => ({ source: article.source, title: article.title, content: articleParagraphs(article).map((text, paragraph) => ({ paragraph, text })) })) })
}

export function parseRichSummary(text: string, article: EditorialArticle): RichSummary {
  const summary = richSummarySchema.parse(JSON.parse(text))
  const details = [...summary.people, ...summary.findings, ...summary.context, ...summary.examples, ...summary.limitations]
  if (summary.relevant && (!summary.overview.trim() || !details.length))
    throw new Error('A relevant article needs a substantial summary with supporting details')
  if (!summary.relevant && (summary.overview.trim() || details.length))
    throw new Error('An irrelevant article must have empty overview and detail arrays')
  for (const item of details)
    articleEvidence(article, item.evidence)
  if (/https?:\/\//i.test(JSON.stringify(summary)))
    throw new Error('Article summaries must not contain URLs')
  return summary
}

export async function generateRichSummary(article: EditorialArticle, instructions: string, ask: (instructions: string, content: string, schema: object) => Promise<string>) {
  let validationMessage = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await ask(`${instructions}${validationMessage}`, buildArticleEvidenceInput([article]), richSummaryJsonSchema)
    try {
      return parseRichSummary(text, article)
    }
    catch (error) {
      if (attempt === 1)
        throw error
      validationMessage = `\nCorrect the response contract before returning. ${error instanceof Error ? error.message : 'Invalid summary'}. Use only the paragraph IDs printed in article content for evidence references.`
    }
  }
  throw new Error('Detailed article summary could not be validated')
}

/** Editorial prose and evidence stay separate; the writer gets all relevant detailed summaries together. */
export function buildRichSummaryInput(articles: EditorialArticle[], summaries: ArticleSummary[]) {
  const seen = new Set<number>()
  const selected: EditorialArticle[] = []
  for (const item of summaries) {
    const article = articles[item.articleIndex]
    if (!article || seen.has(item.articleIndex))
      throw new Error('Summary article references must be valid and unique')
    seen.add(item.articleIndex)
    const summary = parseRichSummary(JSON.stringify(item.summary), article)
    if (!summary.relevant)
      continue
    selected.push({ source: article.source, title: article.title, content: [summary.overview, ...summary.people.map(d => d.text), ...summary.context.map(d => d.text), ...summary.findings.map(d => d.text), ...summary.examples.map(d => d.text), ...summary.limitations.map(d => d.text)].join('\n\n') })
  }
  if (seen.size !== articles.length)
    throw new Error('Every collected article must be summarized before composing the episode')
  return selected.length ? buildPodcastStoryInput(selected) : null
}

const reviewEvidence = z.array(z.object({ articleIndex: z.number().int().min(0), paragraphs: paragraphIds }).strict())
const reviewSchema = z.object({
  checks: z.array(z.object({ line: z.number().int().min(1), assessment: z.string().min(1), evidence: reviewEvidence }).strict()),
  approved: z.boolean(),
  issues: z.array(z.object({
    line: z.number().int().min(1),
    original: z.string().min(1),
    replacement: z.string(),
    category: z.enum(['fact', 'unsupported', 'respect', 'delivery', 'format']),
    explanation: z.string().min(1),
    evidence: reviewEvidence,
  }).strict()),
  warnings: z.array(z.string()),
}).strict()
export type ScriptReview = z.infer<typeof reviewSchema>
export const scriptReviewJsonSchema = z.toJSONSchema(reviewSchema)

export const scriptReviewPrompt = `You edit a two-host podcast for accuracy, respect and spoken clarity. Compare the actual script with the complete original articles, ignoring navigation, ads, related-story cards and footers.
Return one checks entry for EVERY numbered turn. For substantive claims and advice, assessment must state what the cited passage actually means and whether the script preserves it, not merely say "accurate". Check three dimensions explicitly where applicable:
- Scope and logic: preserve conditions, populations, degree and comparison direction. "Less likely than" never establishes "does not happen in the other group". Identify what each number measures, its denominator and comparison object; distinguish genetic variants from variance and fractions of variance from fractions of people. Do not let shorthand introduce a stronger or ambiguous claim.
- Attribution: a report's silence is not an explicit finding of absence. Flag claims that an author "explicitly says" something unless a passage actually says it. Hosts may draw a clearly signaled interpretation, but cannot put it in an author's mouth. Verify identities, roles, institutions, dates and quotations.
- Attitude and force: preserve an author's acceptance, reassurance, humor and optionality in context. "It may happen, and that's okay" must not become "don't do it". Even a host's casual aside can reverse that message. A reassuring closing does not repair a coercive or judgmental turn earlier.
Flag material errors in these dimensions, invented facts or experiences, association changed to causation, animal or preliminary findings presented as clinical conclusions, adults changed to children, disrespectful language, or broken script formatting. Cite paragraphs that substantiate factual claims; for an unsupported addition cite the relevant context and identify what was added. A paragraph ID alone is not proof.
Also flag concrete delivery problems that impair listening: unexplained specialist terms, avoidable untranslated phrases, dense written clauses or lists that need a brief plain-language explanation. Use category delivery and a minimal spoken rewrite; keep essential facts and add no speculative explanations. Put merely optional stylistic or pacing preferences in warnings.
Respect the hosts' roles. Clear, confident expert explanations are welcome. The nonexpert may ask, interpret and make everyday connections; do not reduce that host to questions or rewrite all advice into hedging. Faithful paraphrases, selective coverage, ordinary opinions and clearly hypothetical illustrations are allowed. Correct text must pass unchanged.
For each issue return the exact numbered line and original text, a minimal replacement for that same turn (or empty to remove it), an explanation, and zero-based articleIndex/paragraph references from the articles. Preserve the original speaker and unaffected turns. Repairs should discuss the stories naturally, without discussing missing briefing material or how the script was produced.
Return JSON only. approved is true exactly when issues is empty. Do not include "no change needed" entries in issues.`

export function parseScriptReview(text: string, script: string, articles: EditorialArticle[]): ScriptReview {
  const review = reviewSchema.parse(JSON.parse(text))
  if (review.approved !== (review.issues.length === 0))
    throw new Error('Approval must agree with the material issue list')
  const lines = script.split('\n').map(line => line.trim()).filter(Boolean)
  const checked = new Set<number>()
  for (const check of review.checks) {
    if (!lines[check.line - 1] || checked.has(check.line))
      throw new Error('Review checks must cover each existing script turn exactly once')
    checked.add(check.line)
    for (const citation of check.evidence)
      articleEvidence(articles[citation.articleIndex], citation.paragraphs)
  }
  if (checked.size !== lines.length || !review.checks.some(check => check.evidence.length))
    throw new Error('Review must check every script turn and cite original articles')
  const edited = new Set<number>()
  for (const issue of review.issues) {
    if (lines[issue.line - 1] !== issue.original || edited.has(issue.line))
      throw new Error('An edit must identify one exact existing line, without duplicate edits')
    const speaker = /^([^：:]+)[：:]/u.exec(issue.original)?.[1]
    if (speaker && issue.replacement && ![':', '：'].some(colon => issue.replacement.startsWith(`${speaker}${colon}`)))
      throw new Error('A correction must preserve the original speaker')
    if (issue.replacement.trim() === issue.original || issue.replacement.includes('\n'))
      throw new Error('An issue must propose a real, single-turn correction')
    edited.add(issue.line)
    if (['fact', 'unsupported'].includes(issue.category) && !issue.evidence.length)
      throw new Error('Factual edits need original-article evidence')
    for (const citation of issue.evidence)
      articleEvidence(articles[citation.articleIndex], citation.paragraphs)
  }
  return review
}

export function scriptFormatProblems(script: string, markers: string[]) {
  const lines = script.split('\n').map(line => line.trim()).filter(Boolean)
  const hasMarker = (line: string, marker: string) => [':', '：'].some(colon => line.startsWith(`${marker}${colon}`))
  const problems: string[] = []
  if (!lines.length || lines.some(line => !markers.some(marker => hasMarker(line, marker))))
    problems.push('Every nonblank line must be a spoken turn starting with an allowed speaker marker')
  if (markers.some(marker => !lines.some(line => hasMarker(line, marker))))
    problems.push('Both hosts must take part')
  if (/https?:\/\/|www\.|\{\{|输入[里中]|提示词|the (?:input|prompt) (?:says|does|contains)/i.test(script))
    problems.push('Remove URLs, unfilled variables and production-process commentary')
  return problems
}

export interface ReviewCheckpoint { pass: number, script: string, review?: ScriptReview, status: 'pending' | 'approved' | 'changes' | 'fallback', reason?: string }

/** Best-effort review: at most two repairs, then continue with the last usable script. */
export async function composeReviewedScript(options: {
  articles: EditorialArticle[]
  markers: string[]
  draft: () => Promise<string>
  review: (pass: number, input: string, script: string) => Promise<ScriptReview>
  checkpoint: (state: ReviewCheckpoint) => Promise<void>
}) {
  let script = await options.draft()
  let lastUsable = scriptFormatProblems(script, options.markers).length ? undefined : script
  const fallback = async (pass: number, reason: string, review?: ScriptReview) => {
    if (!lastUsable)
      throw new Error('No usable spoken script: invalid speaker structure or production-process text')
    await options.checkpoint({ pass, script: lastUsable, review, status: 'fallback', reason })
    return lastUsable
  }
  for (let pass = 0; pass <= 2; pass++) {
    await options.checkpoint({ pass, script, status: 'pending' })
    const problems = scriptFormatProblems(script, options.markers)
    const input = JSON.stringify({ ...JSON.parse(buildArticleEvidenceInput(options.articles)), speakerMarkers: options.markers, formatProblems: problems, script: script.split('\n').map(line => line.trim()).filter(Boolean).map((text, index) => ({ line: index + 1, text })) })
    let review: ScriptReview
    try {
      review = await options.review(pass, input, script)
      parseScriptReview(JSON.stringify(review), script, options.articles)
    }
    catch (error) {
      return fallback(pass, `Review unavailable or invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (review.approved && !problems.length) {
      await options.checkpoint({ pass, script, review, status: 'approved' })
      return script
    }
    if (pass === 2 || review.approved)
      return fallback(pass, 'Review ended; continuing with the last usable version and remaining review notes', review)
    await options.checkpoint({ pass, script, review, status: 'changes' })
    const patches = new Map(review.issues.map(issue => [issue.line, issue.replacement.trim()]))
    const lines = script.split('\n').map(line => line.trim()).filter(Boolean)
    script = lines.map((line, index) => patches.get(index + 1) ?? line).filter(Boolean).join('\n')
    if (scriptFormatProblems(script, options.markers).length)
      return fallback(pass, 'Proposed corrections broke the spoken-script format', review)
    lastUsable = script
  }
  return fallback(2, 'Review ended')
}
