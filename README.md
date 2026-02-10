# Any Podcast

<img src="public/logo.png" alt="Any Podcast" height="240" />

An AI-powered, configurable podcast platform that aggregates content sources, generates summaries, and produces podcast audio. You can define different sources per topic and build your own podcast flow.

## Philosophy

- Source-configurable, topic-agnostic
- Automation lowers the barrier to content creation
- Everyone should be able to run their own podcast pipeline

## Tech Stack

- **Runtime**: Next.js 15 (App Router) + Cloudflare Workers (via OpenNext)
- **AI**: OpenAI / Gemini for content generation
- **TTS**: Edge TTS / MiniMax / Murf / Gemini TTS
- **Storage**: Cloudflare KV (metadata) + R2 (audio files)
- **UI**: Tailwind CSS + shadcn/ui

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- A [Cloudflare](https://dash.cloudflare.com/) account
- A [Gemini API key](https://aistudio.google.com/apikey) (or OpenAI API key)

### Step 1: Create Your Repository

Click **"Use this template"** on GitHub to create your own repository, then clone it locally:

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
pnpm install
```

### Step 2: Create Cloudflare Resources

Log in to Cloudflare and create the required resources:

```bash
wrangler login

# Create a KV namespace
wrangler kv namespace create PODCAST_KV
# Note the returned namespace id

# Create an R2 bucket
wrangler r2 bucket create <your-podcast-name>
```

### Step 3: Configure Wrangler

Copy the template files and fill in your resource IDs:

```bash
cp wrangler.template.jsonc wrangler.jsonc
cp worker/wrangler.template.jsonc worker/wrangler.jsonc
```

Edit `wrangler.jsonc`:
- `name` — your podcast app name (e.g. `"my-podcast"`)
- `vars.PODCAST_ID` — your podcast identifier (e.g. `"my-podcast"`)
- `kv_namespaces[0].id` — the KV namespace ID from Step 2
- `r2_buckets[*].bucket_name` — the R2 bucket name from Step 2
- `services[0].service` — must match the worker name below

Edit `worker/wrangler.jsonc`:
- `name` — your worker name (e.g. `"my-podcast-worker"`)
- `vars.PODCAST_ID` — same as above
- `kv_namespaces[0].id` — same KV namespace ID
- `r2_buckets[0].bucket_name` — same R2 bucket name
- `triggers.crons` — when to auto-generate episodes (default: `"5 6 * * *"`, daily at 06:05 UTC)

> These files are listed in `.gitignore` because they contain account-specific resource IDs.

### Step 4: Configure Environment Variables

Copy the example files:

```bash
cp .env.local.example .env.local
cp worker/.env.local.example worker/.env.local
```

Edit `.env.local` (Next.js app):

| Variable | Required | Description |
|---|---|---|
| `PODCAST_ID` | Yes | Same as in wrangler config |
| `ADMIN_TOKEN` | Yes | Password for the Admin console (choose a strong value) |
| `NEXT_STATIC_HOST` | Yes | Base URL for audio files. Local dev: `http://localhost:3000/static`. Production: set in wrangler `vars` after deployment (see Step 7) |
| `NODE_ENV` | No | Defaults to `development` locally. Set to `production` in wrangler `vars` |

Edit `worker/.env.local` (Worker):

| Variable | Required | Description |
|---|---|---|
| `PODCAST_ID` | Yes | Same as above |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `ADMIN_TOKEN` | Yes | Same as above |
| `PODCAST_WORKER_URL` | Yes | Worker URL. Local dev: `http://localhost:8787`. Production: set in wrangler `vars` after deployment (see Step 7) |
| `PODCAST_R2_BUCKET_URL` | Yes | R2 bucket public URL. Local dev: `http://localhost:8787/static`. Production: your R2 custom domain or public URL |
| `OPENAI_API_KEY` | No | OpenAI API key (if using OpenAI) |
| `JINA_KEY` | No | Jina API key (for web content extraction) |
| `TTS_API_ID` | No | TTS provider ID (MiniMax/Murf) |
| `TTS_API_KEY` | No | TTS provider API key |
| `TRIGGER_TOKEN` | No | Token for manually triggering the workflow via curl |
| `GMAIL_*` | No | Gmail OAuth credentials (for newsletter sources) |

### Step 5: Configure Your Podcast

There are **three ways** to configure your podcast content and behavior:

#### Option A: Admin Console (Recommended)

The web-based Admin console lets you configure everything at runtime without touching code:

1. Start the dev servers (see Step 6) or deploy first
2. Visit `/admin/login` and enter your `ADMIN_TOKEN`
3. Configure all settings in the UI:
   - **Site**: title, description, logo, theme color, contact email
   - **Hosts**: name, gender, persona, speaker marker for each host
   - **AI**: provider (Gemini/OpenAI), model, API base URL
   - **TTS**: provider (Gemini/Edge/MiniMax/Murf), language, voice for each host, audio quality, intro music
   - **Sources**: add RSS feeds, URLs, or Gmail labels
   - **Prompts**: customize all AI prompts (story summary, podcast dialogue, blog post, intro, title)
   - **Locale**: language, timezone

All changes are saved to KV and take effect immediately on the next workflow run.

#### Option B: Source Config File

For content sources, you can define them in code instead of (or in addition to) the Admin console:

```bash
cp workflow/sources/config.example.ts workflow/sources/config.local.ts
```

Edit `workflow/sources/config.local.ts` to add your RSS feeds, URLs, or Gmail labels. This file is gitignored and takes priority as the default source configuration.

#### Option C: Static Defaults in Code

The file `config.ts` contains static defaults for site metadata (title, description, SEO, theme). These are used as fallbacks when no runtime config exists in KV. For most cases, prefer configuring via the Admin console instead.

### Step 6: Local Development

```bash
# Start the Next.js dev server (port 3000)
pnpm dev

# Start the Worker dev server (port 8787) in another terminal
pnpm dev:worker

# Trigger the workflow manually
curl -X POST http://localhost:8787
```

### Step 7: Deploy

```bash
# Deploy the Worker first
pnpm deploy:worker
# The CLI will print the Worker URL, e.g. https://my-podcast-worker.<your-subdomain>.workers.dev

# Set production secrets for the Worker
wrangler secret put GEMINI_API_KEY --cwd worker
wrangler secret put ADMIN_TOKEN --cwd worker
# Add other secrets as needed (OPENAI_API_KEY, TTS_API_KEY, etc.)

# Deploy the Next.js app
pnpm deploy
# The CLI will print the app URL, e.g. https://my-podcast.<your-subdomain>.workers.dev
```

After the first deploy, you need to set the production URLs that weren't known beforehand. Add them to the `vars` section of your wrangler config files, then redeploy:

In `wrangler.jsonc` (Next.js app), add to `vars`:
```jsonc
"NEXT_STATIC_HOST": "https://my-podcast.<your-subdomain>.workers.dev/static",
"PODCAST_WORKER_URL": "https://my-podcast-worker.<your-subdomain>.workers.dev"
```

In `worker/wrangler.jsonc` (Worker), add to `vars`:
```jsonc
"PODCAST_WORKER_URL": "https://my-podcast-worker.<your-subdomain>.workers.dev",
"PODCAST_R2_BUCKET_URL": "https://<your-r2-public-url>"
```

Then redeploy both: `pnpm deploy:worker && pnpm deploy`

> You can also set custom domains for your app and Worker in the Cloudflare dashboard, then use those domains in the vars above.

After deployment:

1. Your app URL is printed by the deploy command, or find it in the [Cloudflare dashboard](https://dash.cloudflare.com/) under Workers & Pages
2. Go to `/admin` to configure your podcast via the Admin console
3. Trigger the first episode from the **Admin console**: go to `/admin`, switch to the **Testing** tab, and click **Trigger Workflow** — or use curl: `curl -X POST <your-worker-url>`
4. The Worker's cron trigger automatically generates new episodes on schedule. The default is daily at 06:05 UTC — configure this in `worker/wrangler.jsonc` under `triggers.crons` using [standard cron syntax](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

## Running Multiple Podcasts

You can run multiple independent podcasts from the same codebase. Each podcast is a separate Cloudflare deployment with its own configuration.

### Setup

1. Create additional Cloudflare resources (KV namespace, R2 bucket) for the new podcast

2. Create dedicated wrangler config files:

```bash
# For a podcast named "my-second-podcast"
cp wrangler.template.jsonc wrangler.my-second.jsonc
cp worker/wrangler.template.jsonc worker/wrangler.my-second.jsonc
```

3. Fill in the new resource IDs and podcast name in both files

4. Add the new config files to `.gitignore`:

```
wrangler.my-second.jsonc
worker/wrangler.my-second.jsonc
```

5. Optionally, add convenience scripts to `package.json`:

```json
{
  "scripts": {
    "dev:worker:second": "wrangler dev --cwd worker --config wrangler.my-second.jsonc --persist-to ../.wrangler/state-second",
    "deploy:worker:second": "wrangler deploy --cwd worker --config wrangler.my-second.jsonc",
    "logs:worker:second": "wrangler tail --cwd worker --config wrangler.my-second.jsonc"
  }
}
```

6. Deploy and configure via the new instance's Admin console — each deployment has its own independent Admin page, prompts, TTS settings, content sources, and data

> No code changes required. Each podcast instance reads `PODCAST_ID` from its own wrangler config, and all data in KV/R2 is namespaced by podcast ID.

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start Next.js dev server (port 3000) |
| `pnpm dev:worker` | Start Worker dev server (port 8787) |
| `pnpm build` | Build the Next.js app |
| `pnpm deploy` | Build and deploy the Next.js app |
| `pnpm deploy:worker` | Deploy the Worker |
| `pnpm logs:worker` | Tail Worker logs |
| `pnpm lint:fix` | Auto-fix ESLint issues |
| `pnpm tests` | Run integration tests (requires remote) |

## Origin

This project evolved from [hacker-podcast](https://github.com/miantiao-me/hacker-podcast). Thanks to the original author for open-sourcing it.
