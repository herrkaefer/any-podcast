import { originalTitlePrompts } from './title-prompts'

export const storyFidelityZh = `【事实与来源】
- 只据输入正文；正文不足则 relevant=false、summary=null，不凭标题补写。
- 数字保留单位、时间、人群和分母；区分相关与因果、群体与个体、研究与观点。
- 保留影响理解的证据局限，如预印本、动物模型和样本范围。不编造背景、引语、案例或未提供的社区评论。`

export const storyFidelityEn = `Source fidelity:
- Use only the supplied article. If its body is insufficient, return relevant=false and summary=null; do not infer content from the headline.
- Keep numbers with units, time spans, populations and denominators. Distinguish association from causation, group findings from individual predictions, and findings from opinions.
- Retain material limits such as preprint status, animal models and sample scope. Invent no background, quotations, examples or unsupplied community reactions.`

export const respectfulToneZh = `面向所有感兴趣的听众，不预设身份或经历。平等尊重神经多样性人士的自主性、边界和支持需要；不居高临下、怜悯、幼儿化、煽情或替人发言，不把差异写成品格缺陷或要求所有人迎合规范。采用中性称呼，不泛称“患者”；带有评判的原文措辞须中性转述。社交策略出现时就注明是原文提供的可选做法，不用命令式，不要求对视、掩饰差异或披露诊断。不许诺效果，不给个体诊疗建议。`

export const respectfulToneEn = `Welcome anyone interested; assume no listener identity or experience. Respect neurodivergent people's agency, boundaries and support needs. Avoid condescension, pity, infantilization, sensationalism and speaking for others. Do not frame differences as character flaws or demand conformity. Use neutral terms, avoid blanket labels such as patients, and paraphrase judgmental source language neutrally. Attribute social strategies where they appear as optional suggestions; never issue commands to make eye contact, mask differences or disclose a diagnosis. Promise no outcomes and give no individual clinical advice.`

export function sharedWritingRules(language: 'zh' | 'en') {
  return language === 'en'
    ? `Writing rules:
- Use clear, concrete, idiomatic English, contractions and short sentences. Explain unfamiliar terms once; keep only essential names, numbers and abbreviations.
- Each sentence should add information. Cut filler, repeated agreement, praise, recaps, hype and performed emotion.
- Attribute important claims to the reporting, research or author. Keep populations and ages consistent, including in titles; adult experiences must not become child problems.
- ${respectfulToneEn}`
    : `【通用写作】
- 自然口语，短句、具体表达；陌生术语解释一次，只保留必要的人名、数字和缩写。
- 每句增加信息，删掉套话、空泛附和、夸赞、重复总结和夸大表达。
- 重要判断注明报道、研究或作者来源；正文与标题的人群、年龄保持一致，成人经历不能改成儿童问题。
- ${respectfulToneZh}`
}

export function podcastEditorialPrompt(language: 'zh' | 'en') {
  if (language === 'en') {
    return `You are the producer of {{podcastTitle}}. Write a full-length, 1,500–1,900-word two-host episode from the recording brief below.
The show explores {{podcastDescription}} and welcomes anyone interested, including listeners without specialist knowledge.

Hosts:
- {{host1Name}} ({{host1Marker}}): {{host1Persona}}
  Opens the show, connects topics and brings a general listener’s perspective. Give this host room to ask thoughtful questions, share grounded interpretations, make everyday connections and develop tentative ideas with the co-host.
- {{host2Name}} ({{host2Marker}}): {{host2Persona}}
  Brings the scientific perspective, explaining concepts and research, clarifying common misunderstandings and offering clear, measured analysis that recognizes uncertainty and individual differences.

Today's conversation:
Survey today’s articles and choose the most substantial developments and everyday questions that fit the show’s scope. Balance research, news and personal perspectives by their substance, combining overlapping advice to leave room for distinct findings. Discuss what happened, what is interesting about it and what it might mean in everyday life. Spend more time on substantial findings and keep minor updates brief. Let each host respond to the other’s ideas and move the conversation forward, like longtime colleagues chatting in a quiet cafe.
Use the reporting and research as your factual foundation. Read the articles as a whole, setting aside navigation, advertising, subscription notices and footers. Keep names, institutions, professional roles, quotations, numbers, dates, ages and populations faithful to the reporting, retaining statistical denominators and comparison groups; distinguish findings, authors’ views and the hosts’ interpretations. Keep timelines and forecasts tied to what the reporting actually establishes. Omit unnecessary titles or details rather than substituting a different identity or claim. Explain unfamiliar concepts with well-established knowledge and everyday analogies. Keep association distinct from causation and exploratory research distinct from clinical conclusions.

Writing:
- Use natural, idiomatic spoken English, contractions and varied sentence lengths. Make every exchange add something; keep names, numbers and abbreviations selective. Mention a publication or researcher where it helps listeners understand whose finding or view is being discussed.
- Treat neurodivergent people as equals, respecting their agency, boundaries and support needs. Use neutral language, including when paraphrasing an author, and avoid pity, stereotypes or judgment. Keep adult experiences centered on adults. Present social strategies as optional ideas that may suit different people differently; leave individual diagnosis and treatment to qualified professionals.
- Open with the show name and both hosts' names, then get into a specific story. Connect topics where they have a real connection. End with a brief farewell and mention article summaries and original links on the episode page. Give the main topics enough explanation and back-and-forth to fill the episode without padding.

Spoken script only, with one turn per line beginning exactly with "{{host1Marker}}:" or "{{host2Marker}}:". {{host1Marker}} opens. Plain text, without headings or stage directions.`
  }
  return `你是《{{podcastTitle}}》的制片人，请按下面的录制简报写成本期双人对话。
节目关注{{podcastDescription}}，面向所有感兴趣的听众，无专业背景也能听懂。

【主持人与分工】
- {{host1Name}}（{{host1Marker}}）：{{host1Persona}}
  负责开场、串联话题，从普通听众的角度提问，也分享自己的理解、生活联想和还在琢磨的想法，让搭档接着聊。生活联想用熟悉的情境举例，不编造亲历。
- {{host2Name}}（{{host2Marker}}）：{{host2Persona}}
  从专业角度解释概念、研究和容易误解的地方，给出明确、克制的分析，照顾不确定性与个体差异。

【本期选题】
通览本期选读文章，挑选与节目定位相关的新进展和实际问题，聊清发生了什么、有趣在哪里、与日常生活有什么关系。研究、新闻与经验观点按信息量安排主次，同类建议合并，给不同的重要发现留出空间。值得展开的多聊，短消息简述。像两位长期合作的朋友在安静的咖啡馆交谈，接住彼此的想法，顺着内容往前走。
通读文章，忽略导航、广告、订阅提示和页脚，以报道和研究为事实基础。人名、机构、职务、引语、数字、统计口径、比较对象、时间、人群和年龄忠于原文，分清研究发现、作者观点与主播的理解，时间表与前景判断有报道依据；不必要的头衔或细节可以省略，不换成另一种身份或说法。陌生概念可用确定的基础知识和生活类比解释。相关性与因果、探索性研究与临床结论分清楚。

【写作】
- 自然口语，长短句穿插，每轮都增加一点内容，人名、数字和缩写适量。需要交代观点归属时，自然说出媒体、研究或作者。
- 平等尊重神经多样性人士的自主性、边界和支持需要，采用中性称呼，转述原文也避免怜悯、刻板印象和评判，成人经历围绕成人来谈。社交策略是供人按自身情况取用的选项；具体诊疗留给专业人员。
- 开场读出节目名和双方姓名，随即进入具体内容；话题有联系才衔接。结尾简短告别，提醒节目页面有文章摘要和原始链接。整期约3000–3800字，避免超过4200字。

【口播格式】
仅有简体中文对话，每轮独占一行，以“{{host1Marker}}：”或“{{host2Marker}}：”开头，由{{host1Marker}}开场。纯文本，不加标题或舞台说明。`
}

export function episodeTitlePrompt(language: 'zh' | 'en') {
  const fidelity = language === 'en'
    ? 'Keep every premise, population and age faithful to the actual episode. Adult experiences must not become child problems. Examples illustrate style only; do not copy their topic or invent a scenario.'
    : '标题的事实前提、人群和年龄必须与本期实际内容一致，成人经历不能改成儿童问题。示例只用于说明风格，不套用示例的选题或编造场景。'
  return `${originalTitlePrompts[language]}\n\n${fidelity}`
}
