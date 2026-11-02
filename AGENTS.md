# ChiChat — AI Mandarin Voice Coach

An open-source Mandarin Chinese conversation practice app. Learners talk to AI NPCs in everyday scenarios (tea house, hotel, wet market), get real-time pronunciation scoring, and receive personalized coaching feedback — all through voice.

> 本文是项目唯一入口文档（Claude Code / opencode / Cursor 共用）；下半部分是公开仓库的使用说明，上半部分是生产部署与运维事实。

## 生产部署（2026-11-02 更新）

- **生产机**：`chivox@100.121.81.8`（office，macOS/zsh，BSD 工具链）
- **生产目录**：`/Users/chivox/workspace/chichat`；PM2 进程名 `chichat`（`npm start -- -p 3458`）
- **端口**：`*:3458`；日志 `~/.pm2/logs/chichat-{out,error}.log`
- **部署**：dev 提交并 push GitHub → 生产 `git pull github main --ff-only` → 代码/依赖变更后 `npm install && npm run build` → `pm2 restart chichat`（`next start` 依赖 `.next`，只改文案也需重新 build）。禁止 scp 覆盖 git 跟踪文件。
- **配置**：`.env.local`（gitignored，0600）：`GOOGLE_AI_API_KEY` / `CHIVOX_MCP_API_KEY` / `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`；改前留 `.env.local.bak-<日期>` 备份。
- **公网**：cloudflared 隧道（`com.cloudflare.cloudflared`）`chichat.voiceagent.bond` → `localhost:3458`。
- **运维**：运维斯协助，服务清单 osaka `~/.openclaw-gw/workspace-ops/SERVICES.md`。

## 模型/依赖（生产现状）

- **实时语音对话**：Gemini Live API（`gemini-3.1-flash-live-preview`），由**浏览器直连** Google（不经服务器出口）。
- **发音评分**：Chivox MCP `https://mcp-global.cloud.chivox.com/mcp`，服务器侧 `/api/chivox-eval` 代理。
- **会话评测 LLM**：2026-11-02 起走 osaka cliProxy `http://100.64.138.18:8317/v1`，`LLM_MODEL=glm-4-flash-250414`（原 office 8317 实例已不再使用）。

## 业务语义/设计意图（防误改）

- 场景 voice↔NPC 对照表在 `src/lib/scenarios.ts` 的 `voiceName` 字段：
  - teahouse 小王（男）→ Puck
  - hotel 小李（女）→ Leda
  - market 张阿姨（女）→ Kore
- **NPC 语音性别错配（女 NPC 配男声）历史上出过两次**，改动 `voiceName` 或新增场景前必须核对 NPC 性别与音色性别一致。
- 评测接口双模式：未设 `LLM_BASE_URL` 时用 Gemini；生产已设，走 OpenAI 兼容 `/chat/completions`（流式 SSE）。

## 服务拓扑
<!-- topology:v1 -->
- 产物形态：服务
- 用户界面：Web（`https://chichat.voiceagent.bond`，Cloudflare Tunnel 公网）
- 部署宿主：office（cloudflared 隧道与 3458 端口在该机；服务器侧只调 osaka LLM 与 Chivox MCP，Gemini Live 为浏览器直连）

| 提供 ref | 进程管理 | 健康端点 |
|---|---|---|
| office:chichat | PM2 `chichat` | http://127.0.0.1:3458/（根路径 200；探针=pm2 online + 3458 监听） |

| 提供 ref | 依赖 ref | 硬/软 | 挂了的表现 |
|---|---|---|---|
| office:chichat | osaka:cliproxy.service | 软 | 结束对话后的会话评测失败（无报告/DRILL）；实时对话与发音评分不受影响 |
| office:chichat | remote:chivox-mcp | 软 | 发音评分不可用（`/api/chivox-eval` 返回错误）；对话与评测不受影响 |

## 迭代记录

- **2026-11-02**：会话评测 LLM 从 office cliProxy(8317) 迁到 osaka 单实例 8317（`LLM_BASE_URL=http://100.64.138.18:8317/v1`，key 不变）；用户应用内端到端测试通过。office 8317 剩余唯一消费者为 voice-agent。
- 更早迭代见文末「Current Progress」。

## Background

This project was forked from an internal English oral practice tool (voice-agent) and redesigned for **foreigners learning Mandarin**. The original system used Gemini Live API for real-time voice dialogue, Chivox for pronunciation scoring, and a configurable LLM for conversation evaluation. ChiChat preserves this architecture but replaces all English scenarios, prompts, and evaluation rubrics with Mandarin equivalents, and switches the UI to English for the target audience.

The goal is to publish this as an open-source project on GitHub, allowing anyone with a Google AI Studio API key and Chivox API key to run their own Mandarin voice coach locally.

## How It Works

```
User speaks Mandarin → Mic → Gemini Live (STT + LLM + TTS) → NPC responds in Mandarin
                                    ↓
                           Slot tracking (tea type, room, produce...)
                           Speech correction (ASR error fix)
                                    ↓
                    [End conversation] → Chivox pronunciation scoring
                                    ↓
                         LLM evaluation (tier, feedback, drills)
                                    ↓
                    Coaching report + targeted pronunciation drills
```

### Six-Phase Learning Loop

1. **Select** — Choose a scenario (Tea House / Hotel / Wet Market)
2. **Briefing** — See your task objective and completion criteria
3. **Dialogue** — Real-time voice conversation with the NPC
4. **Review** — Read transcript with word-level pronunciation scores (color-coded)
5. **Coaching** — AI coach assessment: tier rating, key improvements, expression upgrades
6. **Drill** — Targeted pronunciation practice on weak words/sentences

### Adaptive Difficulty (4 Tiers)

| Tier | Label | NPC Behavior |
|------|-------|-------------|
| 1 | Beginner | Very slow speech, binary choices, accepts single words |
| 2 | Basic | Accepts keywords, models full sentences back |
| 3 | Conversational | Natural pace, small complications, expects complete sentences |
| 4 | Fluent | Natural chat, colloquial expressions, small talk |

Promotion requires 2 consecutive evaluations above current tier. Progress stored in localStorage per scenario.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Real-time voice dialogue | Google Gemini Live API (`gemini-3.1-flash-live-preview`) via `@google/genai` SDK |
| Pronunciation scoring | Chivox MCP API (`cn_sentence_eval`) |
| Conversation evaluation | Gemini 3.1 Flash Lite (default, free tier) or any OpenAI-compatible API |
| Framework | Next.js 16 + React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Testing | Vitest (42 tests passing) |
| Audio | Web Audio API (PCM capture/playback), MediaRecorder (conversation recording) |

## Scenarios

| Scenario | NPC | Voice | Slots | Theme |
|----------|-----|-------|-------|-------|
| Tea House | 小王 (server) | Puck (male) | tea_type, size, snack, seating | Red |
| Hotel | 小李 (front desk) | Leda (female, young) | room_type, nights, breakfast, deposit | Blue |
| Wet Market | 张阿姨 (vendor) | Kore (female, mature) | item, quantity, bag, payment | Green |

Each NPC speaks only Mandarin, is patient with non-native speakers, and adapts behavior to the learner's tier level.

## Project Structure

```
chichat/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Main page — all 6 phases
│   │   ├── layout.tsx                  # Root layout + metadata
│   │   └── api/
│   │       ├── gemini-token/route.ts   # Provides Google API key to client
│   │       ├── evaluate-conversation/  # LLM evaluation endpoint (dual-mode)
│   │       └── chivox-eval/route.ts    # Chivox MCP proxy (cn_sentence_eval)
│   ├── lib/
│   │   ├── scenarios.ts               # 3 Mandarin scenario configs
│   │   ├── gemini-live.ts             # Gemini Live session management
│   │   ├── evaluation.ts             # Evaluation prompt builder + response parser
│   │   ├── progression.ts            # Tier tracking + localStorage persistence
│   │   ├── task-generator.ts          # Random task generation from slot values
│   │   └── turn-capture.ts           # Turn state machine (idle→capturing→sealed)
│   ├── hooks/
│   │   └── useGeminiLive.ts           # React hook: audio I/O + Chivox integration
│   └── components/
│       └── DrillView.tsx              # Pronunciation drill UI (zh-CN TTS)
├── public/scenes/
│   ├── teahouse/                      # bg.png, npc.png, ambient.mp4
│   ├── hotel/                         # ambient.mp3 (bg.png, npc.png TODO)
│   └── market/                        # ambient.mp3 (bg.png, npc.png TODO)
├── claude-chinese-prompts.md          # AI image generation prompts for scenes/NPCs
├── .env.example                       # Environment variables template
├── LICENSE                            # MIT
└── package.json
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_AI_API_KEY` | Yes | — | Google AI Studio API key. Powers both Gemini Live dialogue and conversation evaluation. |
| `CHIVOX_MCP_API_KEY` | Yes | — | Chivox MCP API key. Powers pronunciation scoring. |
| `LLM_BASE_URL` | No | _(uses Gemini)_ | Custom LLM endpoint (OpenAI-compatible format). |
| `LLM_API_KEY` | No | _(falls back to GOOGLE_AI_API_KEY)_ | API key for custom LLM endpoint. |
| `LLM_MODEL` | No | `gemini-3.1-flash-lite` | Model name for conversation evaluation. |

**Evaluation LLM dual-mode**:
- If `LLM_BASE_URL` is not set → uses `@google/genai` SDK with `GOOGLE_AI_API_KEY` + Gemini 3.1 Flash Lite (free tier: 500 req/day)
- If `LLM_BASE_URL` is set → uses OpenAI-compatible `POST /chat/completions` with `LLM_API_KEY` + `LLM_MODEL`

By default, you only need **one Google AI API key** for everything. You can optionally use GLM, DeepSeek, or any other OpenAI-compatible API for evaluation.

## Quick Start

```bash
git clone https://github.com/lindun1979/ChiChat.git
cd chichat
cp .env.example .env.local
# Edit .env.local — add your GOOGLE_AI_API_KEY and CHIVOX_MCP_API_KEY
npm install
npm run dev
```

Open http://localhost:3000 in Chrome (mic access required).

## Development

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm test          # Run tests (vitest)
npm run lint      # ESLint
```

## Current Progress

### Done

- [x] Project forked from voice-agent, stripped all English content
- [x] 3 Mandarin scenarios with full NPC system instructions and tier-adaptive behavior
- [x] Chivox integration — unified `cn_sentence_eval` for both word and sentence scoring. Endpoint: `https://mcp-global.cloud.chivox.com/mcp`
- [x] Evaluation LLM dual-mode: Gemini default + OpenAI-compatible custom endpoint (production uses GLM-4-flash)
- [x] Evaluation prompts rewritten for Mandarin proficiency (measure words, particles, tones)
- [x] All UI strings translated to English (target: foreigners learning Mandarin)
- [x] DrillView TTS switched to zh-CN
- [x] Correction tool examples updated to Chinese homophones
- [x] MIT license, .env.example, .gitignore
- [x] All 42 tests passing, build compiles clean
- [x] AI image generation prompts written (`claude-chinese-prompts.md`)
- [x] Tea house scene assets (bg.png, npc.png) generated and deployed
- [x] Ambient audio added for all 3 scenes (reused from voice-agent)
- [x] End-to-end test passed — full flow: select → dialogue → review → coaching → drill
- [x] All 3 scene assets (bg.png, npc.png) generated and deployed
- [x] Gemini Live Mandarin voice quality tested — voices assigned: Puck (male), Leda (young female), Kore (mature female)
- [x] Published to GitHub: [`lindun1979/ChiChat`](https://github.com/lindun1979/ChiChat)
- [x] Public access via Cloudflare Tunnel: `https://chichat.voiceagent.bond`


## Disclaimer

- This app is for personal Mandarin learning and academic use. AI-generated feedback may not always be accurate.
- Users must provide their own API keys. This project does not collect, upload, or store your API keys — they are stored locally only.
- Per Google's Terms of Service, API users must be 18 years or older.
- Do not enter sensitive, private, or illegal information in conversations.

## License

[MIT](LICENSE)
