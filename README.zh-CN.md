# Any Podcast

<img src="public/logo.png" alt="Any Podcast" height="240" />

一个可配置的 AI 播客平台：自动聚合内容源，从丰富文章摘要撰写对话并输出播客音频。你可以为不同主题配置独立的内容源，组合成自己的播客流。

## 理念

- 内容源可配置，主题与平台无关
- 自动化生成，降低内容生产门槛
- 让每个人都能拥有自己的播客管道

## 技术栈

- **运行时**: Next.js 15 (App Router) + Cloudflare Workers (通过 OpenNext 适配)
- **AI**: OpenCode Go（DeepSeek Flash）/ OpenAI / Gemini / MiniMax 内容生成
- **TTS**: Edge TTS / MiniMax / Murf / Gemini TTS
- **存储**: Cloudflare KV (元数据) + R2 (音频文件)
- **UI**: Tailwind CSS + shadcn/ui

## Workflow 续跑机制（Subrequest 预算保护）

为了解决 Cloudflare Workflow 在单次运行中可能触发 `Too many subrequests` 的问题（尤其在内容源、文章数、TTS 行数增多时），当前实现采用了**单主 workflow + 多实例接力续跑**方案，而不是拆成多种不同 workflow。

核心思路：

- 主流程仍然是一个 `PodcastWorkflow`，按阶段执行：`collect_candidates -> expand_gmail -> collect_articles -> summarize_articles -> compose_text -> tts_render -> done`
- 在运行中维护 subrequest 预算（软上限 `45`，保留 `6`）
- 每次进入高成本步骤前，先估算下一步成本；若预算即将超限，则先做 checkpoint，再创建下一个 continuation 实例继续
- continuation 仍是同一个主流程，继承相同 `jobId`，并通过 `continuationSeq` 递增（实例 ID 形如 `<jobId>-c<seq>`）

状态与快照存储：

- **KV**：保存轻量工作状态（当前阶段、游标、进度、快照 key 等），key 形如 `workflow:job:<jobId>:state`
- **R2**：保存较大的阶段快照数据，key 形如 `workflow/jobs/<jobId>/*.json`
  - `candidates.json`：候选文章与 Gmail 待展开消息
  - `articles.json`：完整文章正文和内部来源元数据
  - `summaries.json`：丰富摘要及原文段落证据
  - `editorial-*.json`：发布前的草稿、审稿及决策
  - `compose.json`：播客/博客生成结果与 TTS 输入

这样做的结果是：单次运行接近上限时会自动“换实例继续”，而不丢失进度，最终仍产出同一集 podcast/blog/audio。

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) >= 22.15
- [pnpm](https://pnpm.io/)
- [Cloudflare](https://dash.cloudflare.com/) 账号
- [OpenCode Go API 密钥](https://opencode.ai/docs/go/)（也可使用其他已支持的文本服务）

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

| 变量                 | 必填 | 说明                                                                                                                 |
| -------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `PODCAST_ID`         | 是   | 与 wrangler 配置中一致                                                                                               |
| `ADMIN_TOKEN`        | 是   | Admin 管理后台的登录密码（设置一个强密码）                                                                           |
| `NEXT_STATIC_HOST`   | 是   | 音频文件的基础 URL。本地开发：`http://localhost:3000/static`。生产环境：部署后在 wrangler `vars` 中设置（见第 7 步） |
| `NODE_ENV`           | 否   | 本地默认为 `development`。生产环境在 wrangler `vars` 中设置为 `production`                                           |
| `PODCAST_WORKER_URL` | 否   | 生产环境中，当 Admin 通过 HTTP 调用 Worker 触发 workflow 且未使用 service binding 时使用的 Worker URL                |
| `TRIGGER_TOKEN`      | 否   | 生产环境中，Admin 通过 HTTP 调用 Worker 触发 workflow 时使用的令牌                                                   |

编辑 `worker/.env.local`（Worker）：

| 变量                               | 必填 | 说明                                                                                                  |
| ---------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| `PODCAST_ID`                       | 是   | 与上面一致                                                                                            |
| `OPENCODE_API_KEY`                 | 是   | OpenCode Go API 密钥（默认 `ai.provider=opencode`，模型为 `deepseek-v4.1-flash`）                     |
| `OPENCODE_MODEL`                   | 否   | 填写时覆盖 Admin 的 OpenCode 模型，例如 `deepseek-v4.1-flash`。                                       |
| `GEMINI_API_KEY`                   | 否   | Google Gemini API 密钥                                                                                |
| `MINIMAX_API_KEY`                  | 否   | MiniMax API 密钥（如使用 MiniMax 进行文本生成）                                                       |
| `ADMIN_TOKEN`                      | 是   | 与上面一致                                                                                            |
| `PODCAST_WORKER_URL`               | 是   | Worker URL。本地开发：`http://localhost:8787`。生产环境：部署后在 wrangler `vars` 中设置（见第 7 步） |
| `PODCAST_R2_BUCKET_URL`            | 是   | R2 存储桶公开 URL。本地开发：`http://localhost:8787/static`。生产环境：你的 R2 自定义域名或公开 URL   |
| `OPENAI_API_KEY`                   | 否   | OpenAI API 密钥（如使用 OpenAI）                                                                      |
| `CLOUDFLARE_ANYPODCAST_ACCOUNT_ID` | 否   | 用于 Markdown 抽取的 Cloudflare Account ID。配置后会优先使用 Cloudflare，再回退到 Jina                |
| `CLOUDFLARE_ANYPODCAST_API_TOKEN`  | 否   | 用于 Markdown 抽取的 Cloudflare API Token。需要 `Workers AI: Read` 和 `Browser Rendering: Edit` 权限  |
| `JINA_KEY`                         | 否   | Jina API 密钥（用于网页内容提取）                                                                     |
| `MINIMAX_TTS_GROUP_ID`             | 否   | MiniMax TTS 的 Group ID（`tts.provider=minimax` 时必需）                                              |
| `MINIMAX_TTS_API_KEY`              | 否   | MiniMax TTS 的 API 密钥（`tts.provider=minimax` 时必需）                                              |
| `MURF_API_KEY`                     | 否   | Murf 的 API 密钥（`tts.provider=murf` 时必需）                                                        |
| `TRIGGER_TOKEN`                    | 否   | 通过 curl 手动触发工作流的令牌                                                                        |
| `GMAIL_*`                          | 否   | Gmail OAuth 凭据（用于 Newsletter 内容源）                                                            |

AI provider/model、workflow 测试项、sources、prompts、TTS 等业务配置通过 Admin 保存到 runtime config。`OPENCODE_MODEL` 是可选的 Worker 环境变量，用于覆盖 OpenCode 的模型设置。

为了兼容现有部署，Worker 仍接受旧的 `TTS_API_ID` / `TTS_API_KEY`，但新配置建议改用上面的 provider-specific 命名。

### 第 5 步：配置你的播客

有**三种方式**配置播客的内容和行为：

#### 方式 A：Admin 管理后台（推荐）

Web 管理后台可以在运行时配置所有选项，无需修改代码：

1. 启动开发服务器（见第 6 步）或先完成部署
2. 访问 `/admin/login`，输入你的 `ADMIN_TOKEN`
3. 在管理界面中配置所有设置：
   - **站点信息**: 标题、描述、Logo、主题色、联系邮箱
   - **主播设置**: 每位主播的名称、性别、人设、说话人标记
   - **AI 配置**: 服务商（OpenCode/Gemini/OpenAI/MiniMax）和模型
   - **TTS 配置**: 服务商（Gemini/Edge/MiniMax/Murf）、语言、每位主播的语音、音频质量、片头音乐
   - **内容源**: 添加 RSS 订阅、网页 URL 或 Gmail 标签
   - **Prompt**: 自定义所有 AI 提示词（丰富文章摘要、播客对话、节目笔记、简介、标题）
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

文章正文优先使用 Cloudflare 渲染。中英文 Worker 共用由中文 Worker 托管的 Durable Object 串行队列，两次渲染开始时间至少相隔 11 秒；这是根据该账户实测的 `429`、`Retry-After: 10` 设置的，重试也会遵循服务返回的等待时间。公开静态 HTML 和 Jina 为备用通道。正文为空的文章直接跳过，对话保持事实与来源一致。

Edge 合成使用原版朗读端点及其 2026 年 10 月升级的 v2 签名，适配代码和 LGPL 许可保存在 `workflow/edge-drm/`。音频分段串行生成，段间等待三秒，失败时按指数退避重试。续跑以 R2 检查点为准，KV 保留 Admin 进度视图。发布后等待 KV 同步再清除 RSS 快照，临时音频使用一次批量删除。

将 Worker 变量 `PODCAST_PUBLISH_MODE` 设为 `preview`，会把音频和节目资料保存在 `previews/<jobId>/`，不写入公开节目列表或 RSS；定时任务也遵循该设置。试听任务跨续跑仍保留试听状态。确认可以发布后，将变量改为 `publish` 供后续新任务使用；未设置该变量时保留原来的自动发布行为。

每篇完整文章先生成丰富的结构化摘要，再将全部相关摘要一起交给模型写整期双人稿。摘要按信息量展开，保留人物机构身份、发现与统计口径、定义方法、具体案例、各方观点及必要局限，不设很短的固定字数上限。证据通过原文段落编号定位，原文保存在 R2，便于核查。

独立审稿节点逐轮台词对照完整原文，记录核查依据并明确统计分母和比较对象，检查比较强度、观点归属、作者接纳态度是否反转等实质性的事实和尊重表达问题，提出有出处的单轮台词修改；程序最多自动修订两轮，每轮重新审核。审核不作为发布门槛：修订两轮后仍有意见，或审核服务不可用、修改无效时，保留记录并使用最后一版可用稿继续合成和发布；空稿、说话人格式损坏仍属于技术失败。所有 DeepSeek 文本调用均启用 high 级别思考，包括摘要、写稿、审核、标题、简介和节目笔记。妨碍听懂的术语和密集书面句会做局部口语修订，纯风格和节奏偏好仅作建议。草稿、审稿及最终采用结果保存在 R2。可用 `OPENCODE_REVIEW_MODEL` 单独选择审核模型；不填时使用写稿模型。`pnpm deploy:providers` 会部署两个模型变量。

文章元数据只包含 `source`、`title`、`content`，去掉网址目标。导航页脚保留给模型自行辨识，不增加站点裁剪规则。原文及摘要均支持续跑恢复；`replayMaterialJobId` 复用原文并重新生成摘要。失败重试不截断文章、不悄悄减少为六篇。原文链接仅留在内部元数据，节目笔记完成后再补出处。

仅生成文字、全程自动审核，不合成或发布：

```bash
OPENCODE_REVIEW_MODEL=deepseek-v4-pro pnpm podcast:script-preview existing-config.json articles.json tmp/script-preview
```

`articles.json` 可以是 `{source,title,content}` 数组，或包含 `articles` 数组的对象。测试保留丰富摘要、模型草稿和每次审核，将最终可用稿保存为 `dialogue.txt`。可加 `--draft existing-draft.txt` 对已有模型稿件执行同样的自动审核与修订。导出的 `prompts.json` 仅包含需要合并到现有 Admin 配置的三项提示词；主持人、来源、标题风格等保持由原配置管理。已有节目部署时，需将这些提示词与代码一起更新。

### 使用 OpenCode Go 与 Edge TTS 生成本地试听

在 `worker/.env.local` 中添加 `OPENCODE_API_KEY=你的密钥` 和 `OPENCODE_MODEL=deepseek-v4.1-flash`。`OPENCODE_MODEL` 对 OpenCode 的优先级高于 Admin 模型设置；不填时使用 Admin 的配置，可切换到该服务支持 Chat Completions 的其他模型。Edge TTS 不需要密钥。默认文本模型为 `deepseek-v4.1-flash`，使用 [OpenCode Go Chat Completions 接口](https://opencode.ai/docs/go/#endpoints)。

两个语言预设均使用对应语言的单语言音色和正常语速：

| 语言 | 第一位／男主播              | 第二位／女主播                 |
| ---- | --------------------------- | ------------------------------ |
| 中文 | `zh-CN-YunxiNeural`（云希） | `zh-CN-XiaoxiaoNeural`（晓晓） |
| 英文 | `en-US-GuyNeural`           | `en-US-JennyNeural`            |

已有播客可先将登录后的 Admin `GET /api/admin/config/draft` 响应保存为本地文件，再准备新配置。该操作保留主持人、内容源、提示词和片头音乐。切换到 Edge 时会清理旧 TTS 模型、接口和语速；Edge 使用百分比语速（`+0%` 为正常），不是 MiniMax 的倍数。

```bash
pnpm podcast:configure existing-config.json tmp/preview/config.json
pnpm test:providers
pnpm tts:smoke

# 在另一个终端启动本地 Cloudflare Worker，验证实际运行环境：
pnpm tts:worker
pnpm tts:smoke http://localhost:8799

# articles.json 为数组，每项包含 title、link、content（文章正文）
pnpm podcast:preview tmp/preview/config.json articles.json tmp/preview/episode http://localhost:8799 https://your-podcast-worker.example.workers.dev
```

试听流程先生成丰富摘要，统一写双人稿并自动审核，再生成标题、简介和节目笔记，逐段合成语音、合并 MP3 并混入片头。结果包含 `podcast.mp3`、`dialogue.txt`、`show-notes.md` 和 `manifest.json`；完整音频解码成功才算完成。不传本地 Worker URL 时在 Node 中合成语音。最后一个 URL 用于解析片头音乐的相对路径，默认读取 `worker/.env.local` 中的 `PODCAST_WORKER_URL`。

对于本项目的中英文 Spectrum 部署，`pnpm deploy:providers` 会将 `worker/.env.local` 中的 `OPENCODE_API_KEY` 和 `OPENCODE_MODEL` 安全上传到两个已有 Worker；也可传 `cn` 或 `en` 只更新一套。以后修改本地密钥或模型后，再运行该命令即可。模型留空时恢复使用 Admin 的设置。

上述命令只生成本地文件。现有 KV 配置优先于代码默认值，部署代码本身不会迁移已有播客。试听验收后，部署时再更新对应 Worker 的密钥和 Admin AI/TTS 配置。

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
wrangler secret put OPENCODE_API_KEY --cwd worker
wrangler secret put ADMIN_TOKEN --cwd worker
# 根据需要添加其他密钥（OPENAI_API_KEY、MINIMAX_TTS_API_KEY、MURF_API_KEY 等）

# 部署 Next.js 应用
pnpm run deploy
# 命令行会输出应用 URL，如 https://my-podcast.<your-subdomain>.workers.dev
```

首次部署后，需要设置之前未知的生产环境 URL。将它们添加到 wrangler 配置文件的 `vars` 部分，然后重新部署：

在 `wrangler.jsonc`（Next.js 应用）的 `vars` 中添加：

```jsonc
{
  "NEXT_STATIC_HOST": "https://my-podcast.<your-subdomain>.workers.dev/static",
  "PODCAST_WORKER_URL": "https://my-podcast-worker.<your-subdomain>.workers.dev"
}
```

在 `worker/wrangler.jsonc`（Worker）的 `vars` 中添加：

```jsonc
{
  "PODCAST_WORKER_URL": "https://my-podcast-worker.<your-subdomain>.workers.dev",
  "PODCAST_R2_BUCKET_URL": "https://<your-r2-public-url>",
  "PODCAST_SITE_URL": "https://my-podcast.<your-subdomain>.workers.dev"
}
```

将 Worker 的 `services` 中的 `PODCAST_SITE_SERVICE` 指向前端 Worker 名称。前端配置保留 `PUBLIC_PAGE_RENDERER` 及其迁移；模板已包含这些绑定。

然后重新部署：`pnpm deploy:worker && pnpm run deploy`

> 你也可以在 Cloudflare 控制面板中为应用和 Worker 设置自定义域名，然后在上述 vars 中使用自定义域名。

部署完成后：

1. 应用 URL 会在部署命令的输出中显示，也可以在 [Cloudflare 控制面板](https://dash.cloudflare.com/) 的 Workers & Pages 中找到
2. 进入 `/admin`，通过 Admin 后台配置播客
3. 触发第一期播客生成：进入 `/admin`，切换到 **Testing** 标签页，点击 **Trigger Workflow** 即可——也可以用 curl：`curl -X POST <你的 Worker URL>`
4. Worker 的 Cron 定时任务会按计划自动生成新播客。默认为每天 UTC 06:05 触发——在 `worker/wrangler.jsonc` 的 `triggers.crons` 中配置，使用[标准 cron 语法](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

### 公开页面与缓存更新

公开网页和 RSS 先经过轻量入口 `site-entry.mjs`，缓存命中时不加载 Next.js。公开页面缓存在 R2；管理端修改会使缓存失效，正式发布后会清理并预热节目页、首页和 RSS。部署时保留 Wrangler 的这一入口配置。回归测试：`pnpm test:unit`。

缓存未命中（包括首次访问和客户端导航）由 SQLite Durable Object `PublicPageRenderer` 渲染，不在普通边缘 Worker 中执行。正式发布后，工作流等待 KV 同步，清理所有域名的页面/RSS 缓存，再通过 `PODCAST_SITE_SERVICE` 和 `PODCAST_SITE_URL` 预热并核实节目页、首页和 RSS。配置缺失或未命中新缓存时，该步骤报错并重试，不会静默跳过。

## 运行多个播客

你可以在同一个代码库中运行多个独立的播客。每个播客是一个独立的 Cloudflare 部署，拥有各自的配置。无需修改任何代码。

### 设置方法

1. 为新播客创建额外的 Cloudflare 资源（KV 命名空间、R2 存储桶）

2. 为每个播客创建命名的 wrangler 配置文件：

```bash
# 例如创建一个名为 "my-second" 的播客
cp wrangler.template.jsonc wrangler.my-second.jsonc
cp worker/wrangler.template.jsonc worker/wrangler.my-second.jsonc
```

3. 在两个文件中填入新的资源 ID 和播客名称

4. 将新配置文件添加到 `.gitignore`（包含账号相关的 ID）

### 切换播客

Next.js 开发服务器（`pnpm dev`）固定读取 `wrangler.jsonc`。通过在 `package.json` 中添加切换脚本来选择当前激活的播客：

```json
{
  "scripts": {
    "use:first": "cp wrangler.my-first.jsonc wrangler.jsonc && cp worker/wrangler.my-first.jsonc worker/wrangler.jsonc && echo 'Switched to my-first'",
    "use:second": "cp wrangler.my-second.jsonc wrangler.jsonc && cp worker/wrangler.my-second.jsonc worker/wrangler.jsonc && echo 'Switched to my-second'"
  }
}
```

然后切换并正常开发：

```bash
pnpm use:second      # 切换到第二个播客
pnpm dev:worker      # 启动 Worker 开发服务器
pnpm dev             # 启动 Next.js 开发服务器
```

### 部署

部署前切换到目标播客：

```bash
pnpm use:second      # 切换配置
pnpm deploy:worker   # 部署该播客的 Worker
pnpm run deploy      # 部署该播客的 Next.js 应用
```

每个部署拥有独立的管理页面、Prompt、TTS 设置、内容源和数据。部署后通过各自的 Admin 后台进行配置。

> 每个播客实例从各自的 wrangler 配置中读取 `PODCAST_ID`，KV/R2 中的数据按播客 ID 隔离。

## 常用命令

| 命令                 | 说明                                                      |
| -------------------- | --------------------------------------------------------- |
| `pnpm dev`           | 启动 Next.js 开发服务器（端口 3000）                      |
| `pnpm dev:worker`    | 启动 Worker 开发服务器（端口 8787）                       |
| `pnpm build`         | 构建 Next.js 应用                                         |
| `pnpm run deploy`    | 构建并部署 Next.js 应用                                   |
| `pnpm deploy:worker` | 部署 Worker                                               |
| `pnpm logs:worker`   | 查看 Worker 日志                                          |
| `pnpm use:<name>`    | 切换当前激活的播客配置（见[运行多个播客](#运行多个播客)） |
| `pnpm lint:fix`      | 自动修复 ESLint 问题                                      |
| `pnpm tests`         | 运行集成测试（需要远程环境）                              |

## 来源

本项目演化自 [hacker-podcast](https://github.com/miantiao-me/hacker-podcast)，感谢原作者的开源分享。
