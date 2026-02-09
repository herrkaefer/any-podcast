import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { GoogleGenAI } from '@google/genai'
import { titlePrompt } from '../workflow/prompt'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load env from worker/.env.local
const envPath = path.resolve(__dirname, '../worker/.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1)
      continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (!process.env[key])
      process.env[key] = value
  }
}

const apiKey = process.env.GEMINI_API_KEY
const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'

if (!apiKey) {
  console.error('GEMINI_API_KEY is required. Set it in worker/.env.local or as an environment variable.')
  process.exit(1)
}

// Read dialogue content
const inputFile = process.argv[2]
let dialogueContent: string

if (inputFile) {
  const filePath = path.resolve(process.cwd(), inputFile)
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }
  dialogueContent = fs.readFileSync(filePath, 'utf-8')
}
else {
  dialogueContent = `
女：大家好，欢迎收听谱系之间，我是阿宁。

男：大家好，我是老周。

女：这一期我们想聊聊一个几乎困扰着所有人的话题——拖延。不过，我们今天重点看的不是普通的“想偷懒”，而是针对ADHD，也就是注意缺陷多动障碍群体，他们的大脑在面对任务时，到底在经历些什么。

男：对，很多人会把拖延简单归结为“不自律”或者“懒”，但如果你去看一些神经科学的研究，或者听听ADHD群体的真实反馈，你会发现这其实是一场大脑内部的执行功能博弈。

女：我看到一个很有意思的说法，叫“大脑陷阱”。比如，ADHD大脑特别擅长给自己找一些听起来非常乐观的理由。最常见的就是“我明天肯定会有状态做的”。老周，你从研究角度看，这种“明天的幻觉”是怎么产生的？

男：这其实涉及到一个概念叫“时间贴现”（Temporal Discounting）。简单说，ADHD的大脑对于遥远的、未来的奖励或者后果，感知力是非常弱的。对它来说，只有“现在”和“非现在”。所以，“明天”在它看来是一个虚无缥缈的真空地带，它会本能地觉得明天的自己会比今天更有动力，但实际上，明天的动机并不会凭空增强。

女：这真的太写实了。还有那种“我就看一分钟手机”或者“我就回个邮件”，结果一抬头两小时过去了。

男：这种现象被形象地称为任务的“粘性”。有些活动一旦陷进去，大脑的执行功能很难把它拔出来。所以现在很多建议是，不要去挑战自己的意志力，而是要在进入这些“高粘性”活动之前，先核对自己的日程表，甚至把执行的具体时间记录下来，给大脑一个清晰的物理坐标。

女：说到这个，我发现很多ADHD朋友还有一种“代偿性”的拖延，叫Procrastivity，翻译过来大概是“拖延性生产”。就是为了躲避那个最难的、核心的任务，他们会突然变得非常勤快，去洗碗、去整理书架、去回那些无关紧要的邮件。

男：这个点特别有意思。虽然看起来也是在拖延，但它其实产生了一定的产出。有些专家甚至建议“逆向利用”这个特性，既然你要逃避，那就把核心任务拆解得非常小、非常琐碎，甚至看起来像是在做杂活。比如不要求自己写完整份报告，只要求自己打开文档，写个标题。

女：这其实是在降低那种“启动门槛”对吧？我看到很多人提到，之所以迟迟不开始，是因为内心有一种对失败或被批评的恐惧，也就是“不合理的规避”。总觉得那个任务像座大山，还没碰就开始累了。

男：没错。所以有一种方法是给大脑“失败的许可”。先接受自己可能做不到完美，甚至允许自己只做五分钟。很多时候，只要那个五分钟计时器一响，大脑最难的那个“启动阶段”也就过去了。

女：但是老周，我发现即使开始了，情绪这一关也很难过。很多人会觉得，我必须得“有心情”才能做事，如果现在心里很烦、很焦虑，那我就没法专注。

男：这可能又是一个陷阱。其实我们不一定非要等到心情好了才开始。专家建议的是“明确标注”。比如你现在觉得报税压力很大，你就对自己说，这是我的“报税焦虑”在起作用。把它当成一个客观存在的背景噪音，而不是行动的阻碍。

女：你这么一说，我就想到生活里那些琐碎的事。对于ADHD朋友来说，忘带钥匙、找不到手机这种小事，往往会演变成一整天的执行功能危机。

男：是的，因为这些琐事会不断消耗原本就不多的认知资源。所以，建立一套固定的“例行程序”（Daily Routine）非常关键。比如出门前必念的口诀“钥匙、钱包、手机”。

女：我也听过一些社区里的讨论，有人觉得每天重复这些流程很枯燥，觉得生活失去了新鲜感。

男：确实会有这种感觉。但换个角度想，把这些低级的、容易出错的杂事“程序化”，其实是为了腾出更多的精力和脑力，去处理那些真正需要创造力和新鲜感的大事。这更像是一种对大脑资源的战略性分配。

女：听下来我觉得，对抗拖延或者管理ADHD，并不是要变成一个冷冰冰的机器人，而是要学会和自己这个有点“调皮”的大脑合作。

男：对，不要去硬刚，而是通过一些小工具，比如刚才提到的Forest或者Freedom之类的专注应用，或者是向朋友公开目标来增加一点“社会压力”。这些都是在给大脑提供外部的支持结构。

女：嗯，这让我觉得宽慰了很多。不管是普通人还是ADHD朋友，理解了这些机制，至少在下次想拖延的时候，我们可以少一点自我责备，多一点具体的办法。

男：没错。承认差异，尊重不确定性，这可能比单纯追求效率更重要。

女：好，今天我们就聊到这里。感谢大家收听这一期的谱系之间。

男：如果你喜欢我们的节目，欢迎在小宇宙、喜马拉雅或者其他泛用型播客客户端订阅我们，我们下期再见。

女：再见。
`.trim()
}

console.info('--- 对话内容（前 200 字）---')
console.info(dialogueContent.slice(0, 200))
console.info('...\n')
console.info(`模型: ${model}\n`)

async function main() {
  const ai = new GoogleGenAI({ apiKey })
  const response = await ai.models.generateContent({
    model,
    contents: dialogueContent,
    config: {
      systemInstruction: titlePrompt,
    },
  })

  const text = response.text || ''

  console.info('--- AI 完整输出 ---')
  console.info(text)
  console.info('')

  // Extract recommended title
  const match = text.match(/推荐标题[：:]\s*(.+)/)
  if (match?.[1]) {
    console.info(`✅ 推荐标题: ${match[1].trim()}`)
  }
  else {
    console.info('⚠️ 未能提取推荐标题，请检查 AI 输出格式')
  }
}

main()
