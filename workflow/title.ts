export interface TitleCandidate {
  title: string
  scores: {
    relevance: number
    search: number
    appeal: number
  }
  reason: string
}

export interface TitleGenerationResult {
  coreAngle: string
  candidates: TitleCandidate[]
  recommendedIndex: number
  recommendedTitle: string
}

export class InvalidEpisodeTitleOutputError extends Error {
  rawOutput?: string

  constructor(message: string, rawOutput?: string) {
    super(message)
    this.name = 'InvalidEpisodeTitleOutputError'
    this.rawOutput = rawOutput
  }
}

export const titleGenerationSchema = {
  type: 'OBJECT',
  properties: {
    coreAngle: { type: 'STRING' },
    candidates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          scores: {
            type: 'OBJECT',
            properties: {
              relevance: { type: 'INTEGER' },
              search: { type: 'INTEGER' },
              appeal: { type: 'INTEGER' },
            },
            required: ['relevance', 'search', 'appeal'],
          },
          reason: { type: 'STRING' },
        },
        required: ['title', 'scores', 'reason'],
      },
    },
    recommendedIndex: { type: 'INTEGER' },
    recommendedTitle: { type: 'STRING' },
  },
  required: ['coreAngle', 'candidates', 'recommendedIndex', 'recommendedTitle'],
} as const

function stripCodeFences(text: string) {
  return text.replace(/```(?:json)?/gi, '').trim()
}

function extractJsonObject(text: string) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
  }
  const match = trimmed.match(/\{[\s\S]*\}/)
  return match ? match[0] : ''
}

function trimWrappingQuotes(value: string) {
  return value.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '').trim()
}

function normalizeTitle(value: string) {
  return trimWrappingQuotes(value).replace(/\s+/g, ' ')
}

function parseScore(value: unknown): number | null {
  if (!Number.isInteger(value)) {
    return null
  }
  const score = Number(value)
  if (score < 1 || score > 10) {
    return null
  }
  return score
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (!Number.isInteger(value)) {
    return null
  }
  const integer = Number(value)
  if (integer < 0) {
    return null
  }
  return integer
}

export function parseTitleGenerationResult(text: string): TitleGenerationResult | null {
  const cleaned = stripCodeFences(text)
  const json = extractJsonObject(cleaned)
  if (!json) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  }
  catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const record = parsed as Record<string, unknown>
  const coreAngle = typeof record.coreAngle === 'string' ? record.coreAngle.trim() : ''
  const recommendedTitle = typeof record.recommendedTitle === 'string' ? normalizeTitle(record.recommendedTitle) : ''
  const recommendedIndex = parseNonNegativeInteger(record.recommendedIndex)

  if (!coreAngle || !recommendedTitle || recommendedIndex === null) {
    return null
  }

  if (!Array.isArray(record.candidates) || record.candidates.length < 3 || record.candidates.length > 5) {
    return null
  }

  const candidates: TitleCandidate[] = []
  for (const candidate of record.candidates) {
    if (!candidate || typeof candidate !== 'object') {
      return null
    }
    const candidateRecord = candidate as Record<string, unknown>
    const title = typeof candidateRecord.title === 'string' ? normalizeTitle(candidateRecord.title) : ''
    const reason = typeof candidateRecord.reason === 'string' ? candidateRecord.reason.trim() : ''
    const scoresRecord = candidateRecord.scores && typeof candidateRecord.scores === 'object'
      ? candidateRecord.scores as Record<string, unknown>
      : null
    const relevance = parseScore(scoresRecord?.relevance)
    const search = parseScore(scoresRecord?.search)
    const appeal = parseScore(scoresRecord?.appeal)

    if (!title || !reason || relevance === null || search === null || appeal === null) {
      return null
    }

    candidates.push({
      title,
      scores: {
        relevance,
        search,
        appeal,
      },
      reason,
    })
  }

  if (recommendedIndex < 0 || recommendedIndex >= candidates.length) {
    return null
  }

  if (candidates[recommendedIndex].title !== recommendedTitle) {
    return null
  }

  return {
    coreAngle,
    candidates,
    recommendedIndex,
    recommendedTitle,
  }
}

export function getRecommendedTitle(result: TitleGenerationResult): string {
  return result.candidates[result.recommendedIndex].title
}
