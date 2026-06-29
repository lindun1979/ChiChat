# ChiChat — AI Mandarin Voice Coach

An open-source Mandarin Chinese conversation practice app. Learners talk to AI NPCs in everyday scenarios (tea house, hotel, wet market), get real-time pronunciation scoring, and receive personalized coaching feedback — all through voice.

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
| Pronunciation scoring | Chivox MCP API (`cn_word_eval` / `cn_sentence_eval`) |
| Conversation evaluation | Configurable: Gemini 2.5 Flash (default) or any OpenAI-compatible API |
| Framework | Next.js 16 + React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Testing | Vitest (42 tests passing) |
| Audio | Web Audio API (PCM capture/playback), MediaRecorder (conversation recording) |

## Scenarios

| Scenario | NPC | Slots | Theme |
|----------|-----|-------|-------|
| Tea House | 小王 (server) | tea_type, size, snack, seating | Red |
| Hotel | 小李 (front desk) | room_type, nights, breakfast, deposit | Blue |
| Wet Market | 张阿姨 (vendor) | item, quantity, freshness, payment | Green |

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
│   │       └── chivox-eval/route.ts    # Chivox MCP proxy (cn_word/sentence_eval)
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
│   ├── teahouse/                      # bg.png, npc.png, ambient.mp3 (TODO)
│   ├── hotel/                         # bg.png, npc.png, ambient.mp3 (TODO)
│   └── market/                        # bg.png, npc.png, ambient.mp3 (TODO)
├── claude-chinese-prompts.md          # AI image generation prompts for scenes/NPCs
├── .env.example                       # Environment variables template
├── LICENSE                            # MIT
└── package.json
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_AI_API_KEY` | Yes | — | Google AI Studio API key. Powers Gemini Live dialogue. |
| `CHIVOX_MCP_API_KEY` | Yes | — | Chivox MCP API key. Powers pronunciation scoring. |
| `LLM_BASE_URL` | No | _(uses Gemini)_ | Custom LLM endpoint (OpenAI-compatible format). |
| `LLM_API_KEY` | No | _(falls back to GOOGLE_AI_API_KEY)_ | API key for custom LLM endpoint. |
| `LLM_MODEL` | No | `gemini-2.5-flash` | Model name for conversation evaluation. |

**Evaluation LLM dual-mode**:
- If `LLM_BASE_URL` is not set → uses `@google/genai` SDK with `GOOGLE_AI_API_KEY` + Gemini 2.5 Flash
- If `LLM_BASE_URL` is set → uses OpenAI-compatible `POST /chat/completions` with `LLM_API_KEY` + `LLM_MODEL`

This means you can use GLM, DeepSeek, or any other OpenAI-compatible API for evaluation.

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/chichat.git
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
- [x] Chivox integration switched to Chinese evaluation tools (`cn_word_eval` / `cn_sentence_eval`)
- [x] Evaluation LLM dual-mode: Gemini default + OpenAI-compatible custom endpoint
- [x] Evaluation prompts rewritten for Mandarin proficiency (measure words, particles, tones)
- [x] All UI strings translated to English (target: foreigners learning Mandarin)
- [x] DrillView TTS switched to zh-CN
- [x] Correction tool examples updated to Chinese homophones
- [x] MIT license, .env.example, .gitignore
- [x] All 42 tests passing, build compiles clean
- [x] AI image generation prompts written (`claude-chinese-prompts.md`)

### TODO

- [x] **Verify Chivox Chinese tool names** — Confirmed: `cn_word_eval` / `cn_sentence_eval`. Endpoint: `https://mcp-global.cloud.chivox.com/mcp`.
- [ ] **Generate NPC images** — Use prompts in `claude-chinese-prompts.md` to generate:
  - `public/scenes/teahouse/{bg.png, npc.png}`
  - `public/scenes/hotel/{bg.png, npc.png}`
  - `public/scenes/market/{bg.png, npc.png}`
- [ ] **Generate/source ambient audio** — Background audio for each scene (tea house ambiance, hotel lobby, market bustle)
- [ ] **Test Gemini Live Mandarin voice quality** — The prebuilt voices (Aoede, Puck, Orus) are multilingual but need testing for natural Mandarin. May need to swap voice assignments per scenario.
- [ ] **End-to-end test with real API keys** — Full flow: select → dialogue → review → coaching → drill
- [ ] **Create GitHub repo** and push
- [ ] **Deploy to production** — Set up on office Mac Mini (`~/workspace/chichat`), configure PM2

## Deployment

### Dev (local)

```
~/workspace/dev/chichat
```

### Production (office Mac Mini)

```
ssh chivox@100.121.81.8
cd ~/workspace/chichat
```

Production setup (after code is synced):
```bash
npm install
npm run build
# PM2 or similar process manager
```

## Disclaimer

- This app is for personal Mandarin learning and academic use. AI-generated feedback may not always be accurate.
- Users must provide their own API keys. This project does not collect, upload, or store your API keys — they are stored locally only.
- Per Google's Terms of Service, API users must be 18 years or older.
- Do not enter sensitive, private, or illegal information in conversations.

## License

[MIT](LICENSE)
