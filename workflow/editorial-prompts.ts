import { originalTitlePrompts } from './title-prompts'

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

export function richStorySummaryPrompt(language: 'zh' | 'en') {
  const task = language === 'en'
    ? `You prepare detailed article briefs for {{podcastTitle}}. Scope: {{podcastDescription}}.
Decide whether the article’s main subject fits the show, including research reliability, funding and policy directly concerning the show's topics. Read the complete article, setting aside navigation, ads, subscription notices and related-story teasers. Preserve its substantive content, useful detail and author’s reasoning rather than compressing it into a short abstract. Let the amount of information determine the length; keep distinct findings, definitions, methods, examples, opposing views and limitations. Combine repetition without dropping information needed to understand a claim.
Write in English. Reuse faithful source wording where helpful. Preserve names, institutions, exact professional roles, numbers with units, dates, populations, denominators and comparison groups. Distinguish findings, hypotheses, opinions and anecdotes. Preserve the direction and strength of comparisons, conditions and uncertainty; a lower likelihood does not mean absence. Do not turn an unmentioned result into a finding about its absence. Keep the author's acceptance, humor and optionality with advice and examples. Record concrete cases and attributed quotations, without creating new ones or filling gaps from memory.
Return the summary JSON: overview introduces the article; people records identities and institutions; findings records all substantive findings, numbers and reasoning; context records background, definitions and methods; examples records cases, quotations and attributed viewpoints; limitations records qualifications and disagreements. Each detail has text and evidence, an array of the paragraph IDs shown with the article. Cite the paragraphs that establish the detail; the original wording is preserved through these references. Put each detail in its most useful section, without repeating it across sections. Sections without relevant content stay empty; do not write explanations about missing material. For an irrelevant article use relevant=false, a brief reason, an empty overview and empty arrays.`
    : `你为《{{podcastTitle}}》整理详细文章摘要。节目关注{{podcastDescription}}。
判断文章的主要内容是否与节目相关，直接涉及节目主题的研究可靠性、经费和政策也属于相关内容。通读全文，忽略导航、广告、订阅提示和相关推荐，尽量保留原文的实质内容、细节和论述脉络，不压缩成几句概述。篇幅随信息量展开，保留不同发现、概念定义、研究方法、具体案例、不同观点和必要限定；合并重复，不省掉理解事实所需的信息。
摘要用简体中文，尽量沿用忠实的原文表述。人名、机构、具体职务、数字及单位、时间、人群、统计分母和比较对象保持准确。分清研究发现、假说、作者观点和个人经验，保留比较的方向与程度、条件和不确定性，较少不等于没有。未提到的结果不补作“没有结果”的结论；建议和案例保留作者的接纳、幽默与可选性。案例、引语和观点保留归属，不编造、不凭记忆补充。
返回摘要JSON：overview概括文章；people记录人物与机构身份；findings充分记录实质发现、数字和论述；context记录背景、定义与方法；examples记录案例、引语及各方观点；limitations记录限定条件与分歧。每条细节包含text和evidence；evidence是支撑该细节的原文段落编号数组，使用文章中标出的paragraph编号，原句由这些编号保留。每条信息放在最合适的一栏，不跨栏重复。没有相应内容的栏留空，不写资料缺失的说明。不相关时relevant=false，reason简述原因，overview为空字符串，各栏为空数组。`
  return task
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
Use the reporting and research as your factual foundation. Keep identities, quotations, numbers, dates, populations, statistical denominators and comparison groups accurate. Preserve conditions and degrees: lower likelihood is not absence, and an unreported result is not an explicit statement that no result exists. Attribute only what an author actually states; make the hosts' interpretations recognizable as their own. Keep timelines and forecasts grounded. Omit unnecessary details rather than inventing substitutes. Keep association distinct from causation and exploratory research distinct from clinical conclusions.

Writing:
- Use natural spoken English, contractions and manageable sentences. Explain unfamiliar terms briefly with established knowledge or everyday analogies; unpack dense lists rather than reading an abstract aloud. Make every exchange add something; keep names and numbers selective and attribute findings naturally.
- Treat neurodivergent people as equals, respecting their agency, boundaries and support needs. Avoid pity, stereotypes or judgment, and keep adult experiences centered on adults. Preserve an author's acceptance or reassurance instead of reversing it into a prohibition. Present social strategies as optional where they arise; a closing disclaimer cannot undo commands earlier in the conversation. The expert may speak clearly and confidently; the listener-perspective host may interpret and reflect without policing listeners. Leave individual diagnosis and treatment to qualified professionals.
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
以报道和研究为事实基础，充分利用具体发现、案例和细节。身份、引语、数字、统计口径、比较对象、时间和人群忠于原文，保留条件与程度：较少不等于没有，未报道结果不等于明确宣告没有结果。作者明确说了什么、主播如何理解要分清；时间表与前景判断有依据，不必要的细节可省略，不编替代说法。相关性与因果、探索性研究与临床结论分清楚。

【写作】
- 自然口语，长短句穿插，每轮都增加内容；人名、数字和缩写适量，自然交代观点归属。陌生术语用确定的基础知识或生活类比简要解释，拆开密集的概念和长句，不照读论文摘要。
- 平等尊重神经多样性人士的自主性、边界和支持需要，避免怜悯、刻板印象和评判，成人经历围绕成人来谈。保留作者的接纳与宽慰，不改成禁令；社交策略在提到时就是可选项，不靠结尾声明抵消前面的命令。{{host2Name}}可明确、专业地解释，{{host1Name}}可发挥理解和联想，不替听众立规矩；具体诊疗留给专业人员。
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
