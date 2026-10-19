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
    category: z.enum(['fact', 'unsupported', 'respect', 'format']),
    explanation: z.string().min(1),
    evidence: reviewEvidence,
  }).strict()),
  warnings: z.array(z.string()),
}).strict()
export type ScriptReview = z.infer<typeof reviewSchema>
export const scriptReviewJsonSchema = z.toJSONSchema(reviewSchema)

export const scriptReviewPrompt = `You are the final editorial reviewer of a two-host podcast. Check the spoken script against the complete original articles. Ignore page navigation, ads, related-story cards and footers.
First return one checks entry for EVERY numbered script turn, including greetings and transitions. In assessment, compare that turn's factual claims with cited article paragraphs; explicitly identify the measured quantity, denominator and comparison object for percentages, fractions and budget comparisons. Distinguish genetic variants from variance in susceptibility and fractions of variance from fractions of people. Check professional roles, institutions and attributed claims rather than relying on how plausible they sound. Cite paragraphs that actually support the claims; evidence may be empty only for a turn with no source-based factual claims. A fluent but ambiguous or misleading numerical paraphrase needs a minimal clarification. Assess the script itself, not the summaries. An unsubstantiated approval is invalid.
Only flag material errors: changed identities or institutions; wrong quantities, denominators or comparison groups; unsupported factual claims, timelines, quotes or personal experiences; association rewritten as causation; animal or preliminary findings presented as clinical conclusions; adults rewritten as children; disrespectful or coercive language; or broken spoken-script formatting.
Hosts may interpret, question and use clearly hypothetical everyday illustrations. Accurate paraphrases, selective coverage, omitted nonessential details and ordinary opinions are not errors. Put optional style and pacing suggestions only in warnings. Do not invent findings to justify an edit. Correct text must pass unchanged.
For each actual issue, provide its exact numbered line and original text, a minimal replacement for that same turn (or an empty replacement to remove it), a clear explanation and references to the numbered original article paragraphs. For an unsupported addition, reference the relevant article context and explain what was added. Evidence uses zero-based articleIndex and arrays of paragraph IDs printed in article content. Refer to existing IDs; the program retrieves the original text. Keep speaker markers and the hosts' roles; do not rewrite unaffected turns. The final script should discuss the stories, without discussing how it was written or what briefing material was missing.
Return the review JSON. approved must be true exactly when issues is empty. Do not put correct statements or 'no change needed' entries in issues.`

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
