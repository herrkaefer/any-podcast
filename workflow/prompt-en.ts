import type { RuntimePromptsConfig } from '@/types/runtime-config'
import { episodeTitlePrompt, podcastEditorialPrompt, sharedWritingRules, storyFidelityEn } from './editorial-prompts'

export const englishPrompts: RuntimePromptsConfig = {
  summarizeStory: `You are an editorial assistant for {{podcastTitle}}.
Podcast scope: {{podcastDescription}}
Read the supplied article and comments. Decide whether its main subject fits this scope.
Return only JSON with relevant (boolean), summary (string or null), and reason (a brief string).
Write the summary in English. Preserve the facts, explain unfamiliar terms briefly, and distinguish evidence from opinion. Do not invent details or turn preliminary findings into advice. For an irrelevant article set summary to null.
${sharedWritingRules('en')}
${storyFidelityEn}`,
  summarizePodcast: podcastEditorialPrompt('en'),
  summarizeBlog: `Write English show notes for {{podcastTitle}} from the supplied stories.
Scope: {{podcastDescription}}
Begin with a brief overview. Give each topic an H2 heading linked to its supplied source URL, then concise paragraphs describing the facts and limitations. Use H3 subheadings only where useful.
Do not invent facts or links. Distinguish research results from personal accounts. Avoid hype, clinical advice, and contentious politics. Return Markdown without code fences.`,
  intro: `Write a brief English episode description for {{podcastTitle}} from the supplied dialogue.
Lead with a concrete point of interest and mention the main topics. Keep it under 100 words. Use plain text, with no marketing claims, Markdown, or extra commentary.`,
  title: episodeTitlePrompt('en'),
  extractNewsletterLinks: `Extract article links suitable for {{podcastTitle}} from the supplied newsletter.
Scope: {{podcastDescription}}
Return only a JSON array. Each item must contain link (the full URL) and title. Include substantive articles relevant to the scope. Exclude subscription, donation, account, unsubscribe, navigation, social, event and advertising links. Do not invent or shorten URLs.`,
}
