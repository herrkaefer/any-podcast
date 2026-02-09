# Admin 控制台重构计划（单播客可配置框架，全量一期）

## 摘要

- 目标：在现有双 Worker 架构上新增 `/admin`，实现节目管理 + 站点配置 + 内容源配置 + Prompt 配置 + TTS/音频配置 + 主持人配置，并通过"草稿-发布-回滚"机制将项目从代码静态配置重构为**完全内容无关的运行时可配置框架**。
- 范围：单播客实例；不在 Admin 管理 API 密钥；鉴权使用单一 `ADMIN_TOKEN` 登录并发放 `HttpOnly` 会话 Cookie。
- 结果：用户完成初始部署后，仅通过 `/admin` 页面即可配置并运营任意主题的播客，无需修改代码。

## 架构与职责

1. 保持双 Worker 不变

- 站点 Worker（根 `wrangler.jsonc`）继续负责 Next 页面和 Admin API。
- Workflow Worker（`worker/wrangler.jsonc`）继续负责定时触发与生成流程。
- 两者共享 KV/R2 中的配置数据。

2. 新增运行时配置层

- 新建 `lib/runtime-config.ts`（站点侧）和 `workflow/runtime-config.ts`（workflow 侧）。
- 读取顺序统一：`active version in KV` -> `fallback 到代码默认配置`。
- 所有页面展示、RSS 输出、workflow prompt/source/TTS 均通过该层获取。

## 数据模型与存储（决策落地）

### 1. KV Key 设计

- `admin:session:{sid}`: 管理员会话，TTL 7 天。
- `cfg:podcast:{podcastId}:draft`: 草稿配置（完整 bundle）。
- `cfg:podcast:{podcastId}:active`: 当前激活版本号（如 `v000012`）。
- `cfg:podcast:{podcastId}:version:{version}`: 发布快照（完整 bundle，不可变）。
- `cfg:podcast:{podcastId}:versions`: 版本索引（发布时间、发布人、备注、hash）。

### 2. 配置 Bundle 结构（Zod 严格校验）

#### `site` — 站点与展示配置

```typescript
site: {
  title: string                  // 播客名称
  description: string            // 播客描述
  coverLogoUrl: string           // logo URL
  contactEmail: string           // 联系邮箱
  themeColor: ThemeColor         // 主题色
  pageSize: number               // 每页节目数
  defaultDescriptionLength: number // 摘要截断长度
  keepDays: number               // 节目保留天数（当前硬编码 30）
  favicon: string                // favicon 路径
  seo: {
    locale: string               // 如 'zh_CN'、'en_US'
    defaultImage: string         // OG 图片路径
  }
  externalLinks: Array<{         // 平台与外部链接
    platform: string             // 如 'apple-podcasts'、'github'、'spotify'
    url: string
    icon?: string
  }>
  rss: {
    language: string             // RSS feed 语言，如 'zh-CN'、'en-US'
    categories: string[]         // 如 ['Health & Fitness', 'Education']
    itunesCategories: Array<{ text: string; subcategory?: string }>
    feedDays: number             // RSS 显示天数（当前硬编码 10）
    relatedLinksLabel: string    // 相关链接标签（当前硬编码 '相关链接：'）
  }
}
```

#### `hosts` — 主持人配置（新增）

```typescript
hosts: Array<{
  id: string // 唯一标识，如 'host1'、'host2'
  name: string // 角色名，如 '阿宁'、'周老师'
  speakerMarker: string // 对话行前缀标记，如 '男'、'女'、'A'、'B'
  gender?: 'male' | 'female' // 用于 TTS voice 选择
  persona?: string // 人设描述，可注入到 prompt 模板变量
  link?: string // 主持人主页链接
}>
```

> **关键改造**：当前代码中 `'男'`/`'女'` 作为 speaker marker 硬编码在 `tts.ts`、`workflow/index.ts` 的行解析逻辑中。改造后统一从 `hosts[n].speakerMarker` 读取，实现语言无关的说话人识别。

#### `tts` — TTS 与音频配置（新增）

```typescript
tts: {
  provider: string               // 'edge' | 'minimax' | 'murf' | 'gemini'
  language: string               // TTS 语言，如 'zh-CN'、'en-US'
  model?: string                 // TTS 模型（provider 相关）
  voices: {                      // 按 host id 映射 voice
    [hostId: string]: string     // 如 { host1: 'zh-CN-YunyangNeural', host2: 'zh-CN-XiaoxiaoNeural' }
  }
  speed?: string | number        // 语速
  geminiPrompt?: string          // Gemini TTS 播报指令（当前硬编码中文）
  introMusic: {
    url?: string                 // 主题音乐 URL（R2），留空则无 intro 音乐
    fadeOutStart: number         // 淡出起始秒数（当前硬编码 19）
    fadeOutDuration: number      // 淡出时长秒数（当前硬编码 3）
    podcastDelay: number         // 播客音频延迟毫秒（当前硬编码 19000）
  }
  audioQuality?: number          // MP3 编码质量（当前硬编码 -q:a 5）
}
```

#### `locale` — 全局语言与时区配置（新增）

```typescript
locale: {
  language: string               // UI 语言，如 'zh'、'en'
  timezone: string               // 时区（当前在 3 个文件硬编码 'America/Chicago'）
  dateFormat?: string            // 日期显示格式
}
```

> **改造点**：`workflow/index.ts`、`workflow/sources/rss.ts`、`workflow/sources/gmail.ts` 中硬编码的 `'America/Chicago'` 统一从 `locale.timezone` 读取。`i18n/config.ts` 中 `detectLocale()` 从 `locale.language` 读取。`app/rss.xml/route.ts` 中 `language` 从 `site.rss.language` 读取。

#### `sources` — 内容源配置

```typescript
sources: {
  lookbackDays: number           // 回溯天数
  items: SourceConfig[]          // 字段对齐 workflow/sources/types.ts
  newsletterHosts?: string[]     // Newsletter 识别主机列表（当前硬编码 ['kill-the-newsletter.com']）
  archiveLinkKeywords?: string[] // 归档链接关键词（当前仅英文 ['in your browser', ...]）
}
```

#### `prompts` — Prompt 配置（模板化增强）

```typescript
prompts: {
  summarizeStory: string // 文章摘要 prompt
  summarizePodcast: string // 播客对话生成 prompt
  summarizeBlog: string // 博客文章生成 prompt
  intro: string // 开场白 prompt
  title: string // 标题生成 prompt
  extractNewsletterLinks: string // Newsletter 链接提取 prompt
}
```

> **模板变量系统**：所有 prompt 支持以下插值变量，在运行时自动替换：
>
> | 变量                     | 说明              | 来源                     |
> | ------------------------ | ----------------- | ------------------------ |
> | `{{podcastTitle}}`       | 播客名称          | `site.title`             |
> | `{{podcastDescription}}` | 播客描述          | `site.description`       |
> | `{{host1Name}}`          | 主持人 1 名称     | `hosts[0].name`          |
> | `{{host1Persona}}`       | 主持人 1 人设     | `hosts[0].persona`       |
> | `{{host1Marker}}`        | 主持人 1 对话标记 | `hosts[0].speakerMarker` |
> | `{{host2Name}}`          | 主持人 2 名称     | `hosts[1].name`          |
> | `{{host2Persona}}`       | 主持人 2 人设     | `hosts[1].persona`       |
> | `{{host2Marker}}`        | 主持人 2 对话标记 | `hosts[1].speakerMarker` |
> | `{{language}}`           | 输出语言          | `locale.language`        |
> | `{{timezone}}`           | 时区              | `locale.timezone`        |
>
> 这样用户在 Admin 编辑 prompt 时可以引用变量，而不是每次都手动修改主持人名字等信息。Admin 前端应提供变量列表提示。

#### `meta` — 元数据

```typescript
meta: {
  podcastId: string
  updatedAt: string
  updatedBy: string
  version: string
  note: string
  checksum: string
}
```

### 3. 二进制资源

- logo 上传到 R2：`assets/{podcastId}/logo/{timestamp}.{ext}`。
- 主题音乐上传到 R2：`assets/{podcastId}/music/{timestamp}.{ext}`。
- 发布时仅在配置中写入 URL，不存二进制到 KV。

## Admin 页面与 API 设计

### 1. 页面路由

- `/admin/login`: token 登录页。
- `/admin`: 控制台首页（配置概览 + 快速操作）。
- `/admin/episodes`: 节目列表、编辑、删除。
- `/admin/site`: 站点元数据、logo、外部链接、RSS 设置。
- `/admin/hosts`: 主持人管理（名称、人设、对话标记、语音）。
- `/admin/sources`: source 列表与编辑。
- `/admin/prompts`: prompt 编辑器（带模板变量提示）。
- `/admin/tts`: TTS provider、语音、音频参数配置。
- `/admin/locale`: 语言、时区配置。
- `/admin/publish`: 配置 diff、发布、回滚。

### 2. 鉴权与安全

- `POST /api/admin/auth/login`: 校验 `ADMIN_TOKEN`，写 `HttpOnly + Secure + SameSite=Strict` Cookie。
- `POST /api/admin/auth/logout`: 清理会话。
- 所有 `/api/admin/*` 统一中间校验：会话存在 + `Origin/Host` 检查。
- 不返回任何敏感 env 值；日志中不打印 token 与 cookie。

### 3. 配置管理 API

- `GET /api/admin/config/draft`
- `PUT /api/admin/config/draft`（支持 partial update，按区块合并）
- `POST /api/admin/config/validate`
- `POST /api/admin/config/publish`（入参 `note`，生成版本并切换 active）
- `GET /api/admin/config/versions`
- `POST /api/admin/config/rollback`（入参 `version`）

### 4. 节目管理 API

- `GET /api/admin/episodes?cursor=&limit=`
- `GET /api/admin/episodes/{date}`
- `PATCH /api/admin/episodes/{date}`（可改 `title` `introContent` `blogContent` `podcastContent` `stories` `publishedAt`）
- `DELETE /api/admin/episodes/{date}`（默认同时删除关联 R2 音频对象）

### 5. 资源 API

- `POST /api/admin/assets/logo`（`multipart/form-data`，校验图片类型和大小上限）
- `POST /api/admin/assets/music`（`multipart/form-data`，校验音频类型和大小上限，用于主题音乐上传）

## 代码改造点（按模块）

### 1. 站点读取改造

- `app/page.tsx`、`app/episode/[date]/page.tsx`、`app/rss.xml/route.ts` 从运行时配置读取所有展示字段。
- `app/rss.xml/route.ts` 的 `language`、`categories`、`itunesCategory`、`feedDays`、`relatedLinksLabel` 全部从 `site.rss` 读取。
- `app/layout.tsx` 的 locale 从 `locale.language` 读取。
- 组件中日期格式化的 locale（`'zh-CN'`/`'en-US'`）从 `site.rss.language` 或 `locale.language` 派生。
- 保留 `config.ts` 作为 fallback 默认值。

### 2. Workflow 读取改造

- `workflow/index.ts` 在 `run()` 开始读取 active 配置快照。
- 来源配置不再只依赖 `workflow/sources/config.local.ts`，改为优先 runtime `sources`。
- prompt 引用从静态导入改为 runtime `prompts`，运行时执行模板变量替换。
- 将 `configVersion` 写入 episode（KV Article）用于追溯。
- **时区改造**：`workflow/index.ts`、`workflow/sources/rss.ts`、`workflow/sources/gmail.ts` 中的硬编码时区统一从 `locale.timezone` 读取。

### 3. TTS 改造（新增）

- `workflow/tts.ts` 的 provider、language、voice ID、speed、model 全部从 `tts` 配置读取。
- **Speaker marker 解耦**：将 `'男'`/`'女'` 硬编码替换为从 `hosts[n].speakerMarker` 动态读取。涉及文件：
  - `workflow/tts.ts`：行前缀匹配逻辑
  - `workflow/index.ts`：对话文本解析逻辑
- Gemini TTS 播报指令从 `tts.geminiPrompt` 读取。
- `worker/static/audio.html` 中的音频混合参数（淡出时序）从配置注入或改为参数化。

### 4. Newsletter 解析改造（新增）

- `workflow/sources/rss.ts` 中 `NEWSLETTER_HOSTS` 从 `sources.newsletterHosts` 读取。
- `workflow/sources/gmail.ts` 中 `archiveLinkKeywords` 从 `sources.archiveLinkKeywords` 读取。
- 保留代码中的默认值作为 fallback。

### 5. 类型与校验

- 新增 `types/runtime-config.d.ts`（完整 bundle 类型定义）。
- 新增 `lib/schemas/admin.ts`（Zod schema，含所有区块）。
- 新增 `lib/template.ts`（prompt 模板变量替换引擎）。
- API 入参全部 schema 校验，错误返回结构统一。

### 6. Admin 前端

- 组件目录建议：`components/admin/*`。
- 表单统一使用 schema 驱动，编辑器支持 prompt 长文本。
- **Prompt 编辑器**增加模板变量自动补全/提示功能。
- **TTS 配置页**根据所选 provider 动态显示对应参数字段。
- **主持人配置页**支持添加/删除/排序 host，编辑 persona 长文本。
- 发布页展示 `draft vs active` 字段级 diff 与变更摘要。

## 迁移与初始化

### 1. 引导脚本（非破坏）

- 新增 `scripts/bootstrap-runtime-config.ts`。
- 从现有 `config.ts`、`workflow/sources/config.local.ts`、`workflow/prompt.ts`、`workflow/tts.ts` 默认值组装初始 bundle（含新增的 `hosts`、`tts`、`locale`、`rss` 区块）。
- 写入 `draft` + `version:v000001` + `active=v000001`。

### 2. 兼容策略

- 若 KV 中无 active 配置，系统自动回退到现有代码配置，确保不中断。
- Admin 首次发布后，系统进入完全运行时配置模式。

## 测试与验收

### 1. 单元测试

- 配置 schema 校验、版本号生成、diff 逻辑、session 校验。
- episode patch 合并逻辑与 delete 行为。
- **prompt 模板变量替换逻辑**。
- **speaker marker 动态解析逻辑**。

### 2. 集成测试

- 登录/登出流程与未授权拦截。
- 草稿保存 -> 发布 -> 前台读取生效。
- 回滚后 workflow 与页面读取旧版本。
- source/prompt 改动后 workflow `test step` 可验证读取到新值。
- **TTS 配置变更后语音生成使用新 voice/provider**。
- **时区配置变更后 source 抓取使用新时区**。

### 3. 回归测试

- 首页、单集页、RSS 输出字段正确。
- `/static` 音频访问不受影响。
- 现有手动触发与 cron workflow 不回归。

### 4. 验收标准

- 不改代码即可在 Admin 完成：站点信息修改、logo 替换、source CRUD、prompt 修改（含模板变量）、TTS 配置、主持人配置、语言/时区设置、RSS 元数据修改、主题音乐替换、发布与回滚、节目编辑与删除。
- 未登录无法访问任何管理 API。
- 发布后 1 次 workflow 运行日志可见 `configVersion`。
- **验证内容无关性**：使用英文配置（英文 prompt、英文 TTS、英文 speaker marker）完成一次完整的播客生成流程。

## 风险与控制

- 风险：错误 prompt/source 导致空内容或质量下降。
- 控制：发布前 `validate` + `dry-run test`；支持一键回滚。
- 风险：误删节目。
- 控制：删除二次确认 + 可选保留音频开关（默认删除）。
- 风险：TTS speaker marker 与 prompt 输出格式不匹配导致音频生成失败。
- 控制：validate 时检查 `hosts[].speakerMarker` 与 prompt 中的 `{{hostNMarker}}` 一致性；发布前可选 dry-run TTS 测试。
- 风险：模板变量拼写错误导致 prompt 中出现未替换的 `{{xxx}}`。
- 控制：validate 时扫描 prompt 文本，检测未识别的模板变量并警告。

## 实施顺序（一期内部仍分里程碑）

1. **M1**：鉴权、配置存储（含完整 bundle schema：site + hosts + tts + locale + sources + prompts）、发布/回滚 API、runtime 读取层、模板变量引擎。
2. **M2**：站点页面接 runtime 配置 + Admin site/hosts/locale 页面 + RSS 改造。
3. **M3**：workflow 接 runtime 配置（sources + prompts + timezone）+ TTS 改造（speaker marker 解耦、voice/provider 配置化）+ `configVersion` 落库 + Admin sources/prompts/tts 页面。
4. **M4**：episode 管理（编辑/删除）+ logo/音乐上传 + Admin publish 页面（diff + 发布 + 回滚）+ 全链路测试（含英文配置端到端验证）。

## 重要接口/类型变更

- `Article` 新增可选字段：`configVersion?: string` `updatedBy?: string`。
- 新增 `RuntimeConfigBundle`（含 `site`、`hosts`、`tts`、`locale`、`sources`、`prompts`、`meta` 区块）。
- 新增 `RuntimeConfigVersionMeta`、`AdminSession` 类型。
- 新增 `/api/admin/*` 路由族（见上）。
- `workflow/tts.ts` 导出函数签名变更：接受 `hosts` 和 `tts` 配置参数而非读取硬编码值。

## 假设与默认值（已锁定）

- 单播客模型，`podcastId` 固定为当前实例，不做多租户。
- Admin 不管理任何 API 密钥，密钥仍在 Worker 环境变量。
- 鉴权采用 token 登录 + 会话 Cookie。
- 配置生效模式为"草稿-发布"，不是"保存即生效"。
- 第一期按"全量一次到位"交付，但按 M1-M4 顺序持续集成，避免大爆炸合并。
- 默认支持 2 个主持人（双人对话模式），`hosts` 数组长度暂定为 2。
- prompt 模板变量使用 `{{variableName}}` 语法，运行时做简单字符串替换，不引入复杂模板引擎。

## 硬编码清单（需改造项汇总）

以下是代码审计发现的所有需要配置化的硬编码项，供实施时逐项核对：

| 文件                        | 硬编码内容                                     | 目标配置字段                                        |
| --------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `config.ts`                 | `keepDays = 30`                                | `site.keepDays`                                     |
| `config.ts`                 | `hosts` 数组                                   | `hosts`                                             |
| `config.ts`                 | `platforms` Apple Podcasts 链接                | `site.externalLinks`                                |
| `config.ts`                 | `site.themeColor = 'orange'`                   | `site.themeColor`                                   |
| `config.ts`                 | `site.seo.locale = 'zh_CN'`                    | `site.seo.locale`                                   |
| `config.ts`                 | `externalLinks.github`                         | `site.externalLinks`                                |
| `workflow/prompt.ts`        | 全部 6 个 prompt（含领域知识、主持人名、语言） | `prompts.*`                                         |
| `workflow/tts.ts`           | TTS language `'zh-CN'`                         | `tts.language`                                      |
| `workflow/tts.ts`           | 各 provider 默认 voice ID                      | `tts.voices`                                        |
| `workflow/tts.ts`           | speaker marker `'男'`/`'女'`                   | `hosts[n].speakerMarker`                            |
| `workflow/tts.ts`           | Gemini 中文播报指令                            | `tts.geminiPrompt`                                  |
| `workflow/index.ts`         | `timeZone = 'America/Chicago'`                 | `locale.timezone`                                   |
| `workflow/index.ts`         | speaker marker `'男'`/`'女'` 行解析            | `hosts[n].speakerMarker`                            |
| `workflow/sources/rss.ts`   | `timeZone = 'America/Chicago'`                 | `locale.timezone`                                   |
| `workflow/sources/rss.ts`   | `NEWSLETTER_HOSTS`                             | `sources.newsletterHosts`                           |
| `workflow/sources/gmail.ts` | `CHICAGO_TIMEZONE`                             | `locale.timezone`                                   |
| `workflow/sources/gmail.ts` | `archiveLinkKeywords`（英文）                  | `sources.archiveLinkKeywords`                       |
| `app/rss.xml/route.ts`      | `language: 'zh-CN'`                            | `site.rss.language`                                 |
| `app/rss.xml/route.ts`      | `categories` / `itunesCategory`                | `site.rss.categories` / `site.rss.itunesCategories` |
| `app/rss.xml/route.ts`      | `getPastDays(10)`                              | `site.rss.feedDays`                                 |
| `app/rss.xml/route.ts`      | `'相关链接：'`                                 | `site.rss.relatedLinksLabel`                        |
| `i18n/config.ts`            | `detectLocale()` 固定返回 `'zh'`               | `locale.language`                                   |
| `worker/static/audio.html`  | `lang="zh"`                                    | `locale.language`                                   |
| `worker/static/audio.html`  | 音频混合时序参数                               | `tts.introMusic.*`                                  |
