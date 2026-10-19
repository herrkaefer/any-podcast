import type { AiEnv } from '../workflow/ai'
import type { EditorialArticle } from '../workflow/editorial-input'
import type { ArticleSummary } from '../workflow/editorial-pipeline'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseEnv } from 'node:util'
import { runtimeConfigBundleSchema } from '../lib/schemas/admin'
import { getTemplateVariables, renderTemplate } from '../lib/template'
import { createResponseText, getAiProvider, getMaxTokens, getPrimaryModel } from '../workflow/ai'
import { getSpeakerMarkers } from '../workflow/dialogue'
import { createEditorialArticle } from '../workflow/editorial-input'
import { buildRichSummaryInput, composeReviewedScript, generateRichSummary, parseRichSummary, parseScriptReview, scriptReviewJsonSchema, scriptReviewPrompt } from '../workflow/editorial-pipeline'
import { podcastEditorialPrompt, richStorySummaryPrompt } from '../workflow/editorial-prompts'
import { summarizeBlogPrompt } from '../workflow/prompt'
import { englishPrompts } from '../workflow/prompt-en'

async function main() {
  const [configPath, articlePath, directory, draftFlag, draftPath] = process.argv.slice(2)
  if (!configPath || !articlePath || !directory)
    throw new Error('Usage: pnpm podcast:script-preview <config.json> <articles.json> <output-directory>')
  if (draftFlag && (draftFlag !== '--draft' || !draftPath))
    throw new Error('Optional --draft <file> reviews and automatically repairs an existing model draft')
  const env: AiEnv & Record<string, string | undefined> = { ...parseEnv(await readFile('worker/.env.local', 'utf8')), ...process.env }
  const inputConfig = JSON.parse(await readFile(configPath, 'utf8'))
  const config = runtimeConfigBundleSchema.parse(inputConfig.draft || inputConfig)
  const language = config.locale.language.startsWith('zh') ? 'zh' : 'en'
  const variables = getTemplateVariables(config)
  const prompts = { summarizeStory: richStorySummaryPrompt(language), summarizePodcast: podcastEditorialPrompt(language), summarizeBlog: language === 'zh' ? summarizeBlogPrompt : englishPrompts.summarizeBlog }
  const summaryPrompt = renderTemplate(prompts.summarizeStory, variables)
  const scriptPrompt = renderTemplate(prompts.summarizePodcast, variables)
  const raw = JSON.parse(await readFile(articlePath, 'utf8'))
  const articles: EditorialArticle[] = (Array.isArray(raw) ? raw : raw.articles).map((article: EditorialArticle) => createEditorialArticle({ title: article.title, sourceName: article.source }, article.content))
  const output = resolve(directory)
  await mkdir(output, { recursive: true })
  const save = (name: string, value: unknown) => writeFile(resolve(output, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await save('result.json', { status: 'running', startedAt: new Date().toISOString() })
  // A failed rerun must not leave an older approved script looking current.
  for (const file of await readdir(output)) {
    if (file === 'dialogue.txt' || /^editorial-\d+-(?:pending|approved|changes|rejected|fallback)\.json$/.test(file))
      await rm(resolve(output, file))
  }
  const runtimeAi = { ...config.ai, sessionId: crypto.randomUUID(), reasoning: true }
  const provider = getAiProvider(env, runtimeAi)
  const model = getPrimaryModel(env, provider, runtimeAi)
  const reviewAi = { ...runtimeAi, reasoning: true, modelOverride: provider === 'opencode' ? env.OPENCODE_REVIEW_MODEL?.trim() : undefined }
  const reviewModel = getPrimaryModel(env, provider, reviewAi)
  const usage: unknown[] = []
  const ask = async (stage: string, instructions: string, input: string, schema?: object, reviewing = false) => {
    const result = await createResponseText({ env, runtimeAi: reviewing ? reviewAi : runtimeAi, model: reviewing ? reviewModel : model, instructions, input, maxOutputTokens: getMaxTokens(env, provider, runtimeAi), ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}) })
    await save(`model-${usage.length}-${stage}.json`, result.text)
    usage.push({ stage, model: reviewing ? reviewModel : model, usage: result.usage })
    await save('usage.json', usage)
    console.info({ stage, model: reviewing ? reviewModel : model, usage: result.usage })
    return result.text
  }
  await save('prompts.json', prompts)
  await save('articles.json', articles)
  const summaries: ArticleSummary[] = []
  for (const [index, article] of articles.entries()) {
    const fingerprint = createHash('sha256').update(JSON.stringify({ version: 'paragraph-evidence-high-v2', article, summaryPrompt, model })).digest('hex')
    let summary
    try {
      const cached = JSON.parse(await readFile(resolve(output, `summary-${index}.json`), 'utf8'))
      if (cached.fingerprint === fingerprint)
        summary = parseRichSummary(JSON.stringify(cached.summary), article)
    }
    catch {}
    if (!summary) {
      summary = await generateRichSummary(article, summaryPrompt, (instructions, input, schema) => ask(`summary-${index}`, instructions, input, schema))
      await save(`summary-${index}.json`, { fingerprint, summary })
    }
    summaries.push({ articleIndex: index, summary })
    await save('summaries.json', summaries)
  }
  await save('summaries.txt', summaries.map(({ articleIndex, summary }) => {
    const article = articles[articleIndex]
    const sections = [['people', '人物与机构 / People'], ['context', '背景与方法 / Context'], ['findings', '发现与数据 / Findings'], ['examples', '案例与观点 / Examples'], ['limitations', '局限与分歧 / Limits']] as const
    return `${articleIndex + 1}. ${article.title} — ${article.source}\n\n${summary.overview}\n\n${sections.filter(([key]) => summary[key].length).map(([key, label]) => `${label}\n${summary[key].map(item => `- ${item.text}`).join('\n')}`).join('\n\n')}`
  }).join('\n\n────────────────────\n\n'))
  const summaryInput = buildRichSummaryInput(articles, summaries)
  if (!summaryInput) {
    await save('result.json', { status: 'no-relevant-articles' })
    return
  }
  let reviewStatus = 'approved'
  const script = await composeReviewedScript({
    articles,
    markers: getSpeakerMarkers(config),
    draft: async () => {
      const text = draftPath ? await readFile(draftPath, 'utf8') : await ask('draft', scriptPrompt, summaryInput)
      await save('draft.txt', `${text}\n`)
      return text
    },
    review: async (pass, input, draft) => {
      let feedback = ''
      for (let attempt = 0; attempt < 2; attempt++) {
        const text = await ask(`review-${pass}-${attempt}`, `${scriptReviewPrompt}${feedback}`, input, scriptReviewJsonSchema, true)
        await save(`review-${pass}-${attempt}-raw.json`, text)
        try {
          return parseScriptReview(text, draft, articles)
        }
        catch (error) {
          if (attempt === 1)
            throw error
          feedback = `\nCorrect the review contract: ${error instanceof Error ? error.message : 'Invalid response'}. Use existing article and paragraph IDs, and copy numbered script lines exactly.`
        }
      }
      throw new Error('Invalid review')
    },
    checkpoint: async (state) => {
      if (state.status === 'approved' || state.status === 'fallback')
        reviewStatus = state.status
      await save(`editorial-${state.pass}-${state.status}.json`, state)
    },
  })
  await save('dialogue.txt', `${script}\n`)
  const result = { status: reviewStatus === 'approved' ? 'approved' : 'ready-with-review-notes', language, articles: articles.length, relevantArticles: summaries.filter(item => item.summary.relevant).length, summaryCharacters: summaryInput.length, scriptCharacters: script.length, hanCharacters: (script.match(/[\u4E00-\u9FFF]/gu) || []).length, words: script.split(/\s+/).length, model, reviewModel, thinkingEffort: 'high', existingDraft: Boolean(draftPath), automatedEditsOnly: true }
  await save('result.json', result)
  console.info(result)
}
main().catch(async (error) => {
  if (process.argv[4]) {
    await writeFile(resolve(process.argv[4], 'result.json'), `${JSON.stringify({ status: 'failed', error: error.message }, null, 2)}\n`, { mode: 0o600 }).catch(() => {})
  }
  console.error(error.message)
  process.exitCode = 1
})
