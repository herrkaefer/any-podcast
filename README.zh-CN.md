# Any Podcast

<img src="public/logo.png" alt="Any Podcast" height="240" />

一个可配置的 AI 播客平台：自动聚合内容源，生成摘要并输出播客音频。你可以为不同主题配置独立的内容源，组合成自己的播客流。

## 理念

- 内容源可配置，主题与平台无关
- 自动化生成，降低内容生产门槛
- 让每个人都能拥有自己的播客管道

## 技术栈

- **运行时**: Next.js 15 (App Router) + Cloudflare Workers (通过 OpenNext 适配)
- **AI**: OpenAI / Gemini 内容生成
- **TTS**: Edge TTS / MiniMax / Murf / Gemini TTS
- **存储**: Cloudflare KV (元数据) + R2 (音频文件)
- **UI**: Tailwind CSS + shadcn/ui

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- [Cloudflare](https://dash.cloudflare.com/) 账号
- [Gemini API 密钥](https://aistudio.google.com/apikey)（或 OpenAI API 密钥）

### 第 1 步：创建你的仓库

在 GitHub 上点击 **"Use this template"** 创建你的仓库，然后克隆到本地：

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
pnpm install
```

### 第 2 步：创建 Cloudflare 资源

登录 Cloudflare 并创建所需资源：

```bash
wrangler login

# 创建 KV 命名空间
wrangler kv namespace create PODCAST_KV
# 记录返回的 namespace id

# 创建 R2 存储桶
wrangler r2 bucket create <你的播客名称>
```

### 第 3 步：配置 Wrangler

复制模板文件并填入资源 ID：

```bash
cp wrangler.template.jsonc wrangler.jsonc
cp worker/wrangler.template.jsonc worker/wrangler.jsonc
```

编辑 `wrangler.jsonc`：
- `name` — 播客应用名称（如 `"my-podcast"`）
- `vars.PODCAST_ID` — 播客唯一标识（如 `"my-podcast"`）
- `kv_namespaces[0].id` — 第 2 步创建的 KV namespace ID
- `r2_buckets[*].bucket_name` — 第 2 步创建的 R2 存储桶名称
- `services[0].service` — 必须与下面的 Worker 名称一致

编辑 `worker/wrangler.jsonc`：
- `name` — Worker 名称（如 `"my-podcast-worker"`）
- `vars.PODCAST_ID` — 与上面保持一致
- `kv_namespaces[0].id` — 同一个 KV namespace ID
- `r2_buckets[0].bucket_name` — 同一个 R2 存储桶名称
- `triggers.crons` — 自动生成播客的时间（默认 `"5 6 * * *"`，即每天 UTC 06:05）

> 这些文件已在 `.gitignore` 中，因为它们包含账号相关的资源 ID。

### 第 4 步：配置环境变量

复制示例文件：

```bash
cp .env.local.example .env.local
cp worker/.env.local.example worker/.env.local
```

编辑 `.env.local`（Next.js 应用）：

| 变量 | 必填 | 说明 |
|---|---|---|
| `PODCAST_ID` | 是 | 与 wrangler 配置中一致 |
| `ADMIN_TOKEN` | 是 | Admin 管理后台的登录密码（设置一个强密码） |
| `NEXT_STATIC_HOST` | 是 | 音频文件的基础 URL。本地开发：`http://localhost:3000/static`。生产环境：部署后在 wrangler `vars` 中设置（见第 7 步） |
| `NODE_ENV` | 否 | 本地默认为 `development`。生产环境在 wrangler `vars` 中设置为 `production` |

编辑 `worker/.env.local`（Worker）：

| 变量 | 必填 | 说明 |
|---|---|---|
| `PODCAST_ID` | 是 | 与上面一致 |
| `GEMINI_API_KEY` | 是 | Google Gemini API 密钥 |
| `ADMIN_TOKEN` | 是 | 与上面一致 |
| `PODCAST_WORKER_URL` | 是 | Worker URL。本地开发：`http://localhost:8787`。生产环境：部署后在 wrangler `vars` 中设置（见第 7 步） |
| `PODCAST_R2_BUCKET_URL` | 是 | R2 存储桶公开 URL。本地开发：`http://localhost:8787/static`。生产环境：你的 R2 自定义域名或公开 URL |
| `OPENAI_API_KEY` | 否 | OpenAI API 密钥（如使用 OpenAI） |
| `JINA_KEY` | 否 | Jina API 密钥（用于网页内容提取） |
| `TTS_API_ID` | 否 | TTS 服务 ID（MiniMax/Murf） |
| `TTS_API_KEY` | 否 | TTS 服务 API 密钥 |
| `TRIGGER_TOKEN` | 否 | 通过 curl 手动触发工作流的令牌 |
| `GMAIL_*` | 否 | Gmail OAuth 凭据（用于 Newsletter 内容源） |

### 第 5 步：配置你的播客

有**三种方式**配置播客的内容和行为：

#### 方式 A：Admin 管理后台（推荐）

Web 管理后台可以在运行时配置所有选项，无需修改代码：

1. 启动开发服务器（见第 6 步）或先完成部署
2. 访问 `/admin/login`，输入你的 `ADMIN_TOKEN`
3. 在管理界面中配置所有设置：
   - **站点信息**: 标题、描述、Logo、主题色、联系邮箱
   - **主播设置**: 每位主播的名称、性别、人设、说话人标记
   - **AI 配置**: 服务商（Gemini/OpenAI）、模型、API 地址
   - **TTS 配置**: 服务商（Gemini/Edge/MiniMax/Murf）、语言、每位主播的语音、音频质量、片头音乐
   - **内容源**: 添加 RSS 订阅、网页 URL 或 Gmail 标签
   - **Prompt**: 自定义所有 AI 提示词（文章摘要、播客对话、博客文章、简介、标题）
   - **语言和时区**: 语言、时区

所有更改保存到 KV，在下次工作流运行时立即生效。

#### 方式 B：内容源配置文件

内容源也可以通过代码文件定义（可与 Admin 后台互补使用）：

```bash
cp workflow/sources/config.example.ts workflow/sources/config.local.ts
```

编辑 `workflow/sources/config.local.ts`，添加你的 RSS 订阅、URL 或 Gmail 标签。此文件已在 gitignore 中，作为默认内容源配置。

#### 方式 C：代码中的静态默认值

`config.ts` 包含站点元数据的静态默认值（标题、描述、SEO、主题）。当 KV 中没有运行时配置时，这些值会作为兜底使用。大多数情况下，建议优先通过 Admin 后台配置。

### 第 6 步：本地开发

```bash
# 启动 Next.js 开发服务器（端口 3000）
pnpm dev

# 在另一个终端启动 Worker 开发服务器（端口 8787）
pnpm dev:worker

# 手动触发工作流
curl -X POST http://localhost:8787
```

### 第 7 步：部署

```bash
# 先部署 Worker
pnpm deploy:worker
# 命令行会输出 Worker URL，如 https://my-podcast-worker.<your-subdomain>.workers.dev

# 为 Worker 设置生产环境密钥
wrangler secret put GEMINI_API_KEY --cwd worker
wrangler secret put ADMIN_TOKEN --cwd worker
# 根据需要添加其他密钥（OPENAI_API_KEY、TTS_API_KEY 等）

# 部署 Next.js 应用
pnpm deploy
# 命令行会输出应用 URL，如 https://my-podcast.<your-subdomain>.workers.dev
```

首次部署后，需要设置之前未知的生产环境 URL。将它们添加到 wrangler 配置文件的 `vars` 部分，然后重新部署：

在 `wrangler.jsonc`（Next.js 应用）的 `vars` 中添加：
```jsonc
"NEXT_STATIC_HOST": "https://my-podcast.<your-subdomain>.workers.dev/static",
"PODCAST_WORKER_URL": "https://my-podcast-worker.<your-subdomain>.workers.dev"
```

在 `worker/wrangler.jsonc`（Worker）的 `vars` 中添加：
```jsonc
"PODCAST_WORKER_URL": "https://my-podcast-worker.<your-subdomain>.workers.dev",
"PODCAST_R2_BUCKET_URL": "https://<your-r2-public-url>"
```

然后重新部署：`pnpm deploy:worker && pnpm deploy`

> 你也可以在 Cloudflare 控制面板中为应用和 Worker 设置自定义域名，然后在上述 vars 中使用自定义域名。

部署完成后：

1. 应用 URL 会在部署命令的输出中显示，也可以在 [Cloudflare 控制面板](https://dash.cloudflare.com/) 的 Workers & Pages 中找到
2. 进入 `/admin`，通过 Admin 后台配置播客
3. 触发第一期播客生成：进入 `/admin`，切换到 **Testing** 标签页，点击 **Trigger Workflow** 即可——也可以用 curl：`curl -X POST <你的 Worker URL>`
4. Worker 的 Cron 定时任务会按计划自动生成新播客。默认为每天 UTC 06:05 触发——在 `worker/wrangler.jsonc` 的 `triggers.crons` 中配置，使用[标准 cron 语法](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

## 运行多个播客

你可以在同一个代码库中运行多个独立的播客。每个播客是一个独立的 Cloudflare 部署，拥有各自的配置。

### 设置方法

1. 为新播客创建额外的 Cloudflare 资源（KV 命名空间、R2 存储桶）

2. 创建专用的 wrangler 配置文件：

```bash
# 例如创建一个名为 "my-second-podcast" 的播客
cp wrangler.template.jsonc wrangler.my-second.jsonc
cp worker/wrangler.template.jsonc worker/wrangler.my-second.jsonc
```

3. 在两个文件中填入新的资源 ID 和播客名称

4. 将新配置文件添加到 `.gitignore`：

```
wrangler.my-second.jsonc
worker/wrangler.my-second.jsonc
```

5. 可选：在 `package.json` 中添加便捷脚本：

```json
{
  "scripts": {
    "dev:worker:second": "wrangler dev --cwd worker --config wrangler.my-second.jsonc --persist-to ../.wrangler/state-second",
    "deploy:worker:second": "wrangler deploy --cwd worker --config wrangler.my-second.jsonc",
    "logs:worker:second": "wrangler tail --cwd worker --config wrangler.my-second.jsonc"
  }
}
```

6. 部署后通过新实例的 Admin 后台进行配置 —— 每个部署拥有独立的管理页面、Prompt、TTS 设置、内容源和数据

> 无需修改任何代码。每个播客实例从各自的 wrangler 配置中读取 `PODCAST_ID`，KV/R2 中的数据按播客 ID 隔离。


## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动 Next.js 开发服务器（端口 3000） |
| `pnpm dev:worker` | 启动 Worker 开发服务器（端口 8787） |
| `pnpm build` | 构建 Next.js 应用 |
| `pnpm deploy` | 构建并部署 Next.js 应用 |
| `pnpm deploy:worker` | 部署 Worker |
| `pnpm logs:worker` | 查看 Worker 日志 |
| `pnpm lint:fix` | 自动修复 ESLint 问题 |
| `pnpm tests` | 运行集成测试（需要远程环境） |

## 来源

本项目演化自 [hacker-podcast](https://github.com/miantiao-me/hacker-podcast)，感谢原作者的开源分享。

