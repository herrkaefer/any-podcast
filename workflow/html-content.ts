import * as cheerio from 'cheerio'

/** Extract public, static article/newsletter content while retaining source links. */
export function extractStaticHtmlContent(html: string, sourceUrl: string): string {
  const $ = cheerio.load(html)
  const title = $('head > title').first().text().trim()
  if (/just a moment|access denied|captcha|verify (?:you are|you're) human|attention required/i.test(title)) {
    return ''
  }
  $('script, style, noscript, nav, header, footer, aside, form, button, svg, iframe, img').remove()
  let root: ReturnType<typeof $> = $('body')
  for (const selector of ['[itemprop="articleBody"]', '.entry-content', '.post-content', 'article', 'main']) {
    const candidate = $(selector).first()
    if (candidate.length && candidate.text().trim().length >= 300) {
      root = candidate
      break
    }
  }
  // A page of navigation or a short access prompt is not an article body.
  const plainText = root.text().replace(/\s+/g, ' ').trim()
  if (plainText.length < 300 || /^(?:access denied|please enable javascript|verify you are human)/i.test(plainText)) {
    return ''
  }
  root.find('a[href]').each((_, element) => {
    const anchor = $(element)
    const text = anchor.text().replace(/\s+/g, ' ').trim()
    try {
      const href = new URL(anchor.attr('href') || '', sourceUrl)
      if (text && ['http:', 'https:'].includes(href.protocol)) {
        anchor.replaceWith($('<span>').text(`[${text}](${href.href})`))
      }
    }
    catch {}
  })
  root.find('br').replaceWith('\n')
  root.find('p, div, section, h1, h2, h3, h4, li, tr').append('\n\n')
  const text = root.text()
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\u034F/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return title ? `# ${title}\n\n${text}` : text
}
