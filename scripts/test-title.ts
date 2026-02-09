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
Host1：大家好，欢迎收听本期播客，我是 Host1。

Host2：大家好，我是 Host2。

Host1：今天我们来聊一个跟开发者工作流相关的话题。最近有一个新的开源工具引起了不少关注，它号称能把日常的重复工作减少一半以上。

Host2：对，这个工具最大的亮点是它的自动化能力。它能自动识别项目中的重复模式，然后帮你生成对应的脚手架代码。

Host1：听起来确实挺实用。但我有个疑问，这跟之前的代码生成器有什么本质区别？

Host2：区别在于上下文感知。之前的工具大多是基于模板的，你得手动选模板、填参数。而这个工具会分析你现有的代码风格和项目结构，生成的代码和你的项目高度一致。

Host1：那安全性怎么样？自动生成的代码会不会引入漏洞？

Host2：这是个好问题。它内置了一些基本的安全检查，但不能完全替代代码审查。官方建议是把它当作"初稿生成器"，最终还是需要人工确认。

Host1：嗯，这个定位很务实。好了，今天就聊到这里。

Host2：感谢收听，我们下期再见。

Host1：再见。
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
