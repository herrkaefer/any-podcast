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
  summarizeBlog: `You are the show-notes editor for {{podcastTitle}}.
Scope: {{podcastDescription}}
Turn this episode’s conversation into concise, readable show notes. Start with a brief overview, then cover only the articles actually discussed. Start each article section with an H2 using its exact original title from the article list; related articles can appear together under the same topic. Preserve the conversation’s facts, views and material research limits without adding news or conclusions.
Use clear, neutral language that respects neurodiversity and individual differences. Keep paragraphs focused and avoid repetition and marketing claims. Return Markdown without code fences.`,
  intro: `Write a brief English episode description for {{podcastTitle}} from the supplied dialogue.
Lead with a concrete point of interest and mention the main topics. Keep it under 100 words. Use plain text, with no marketing claims, Markdown, or extra commentary.`,
  title: episodeTitlePrompt('en'),
  extractNewsletterLinks: `Extract article links suitable for {{podcastTitle}} from the supplied newsletter.
Scope: {{podcastDescription}}
Return only a JSON array. Each item must contain link (the full URL) and title. Include substantive articles relevant to the scope. Exclude subscription, donation, account, unsubscribe, navigation, social, event and advertising links. Do not invent or shorten URLs.`,
}
