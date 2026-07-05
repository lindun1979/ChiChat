# ChiChat — AI 普通话口语教练（Next.js/React web 应用，外国人通过语音与 AI NPC 对话练中文）

## 生产部署
- 生产机: chivox@100.121.81.8（macOS/zsh，BSD grep/sed，无 python3.11 → 用 python3）
- 生产目录: /Users/chivox/workspace/chichat；PM2 进程名: `chichat`
- 端口: 3458 (待确认)——3000 被其他服务占用
- 日志: `pm2 logs chichat`
- 部署方式: git push → 生产机 git pull → `pm2 restart chichat` → 健康检查（禁止 scp 覆盖 git 跟踪文件）
- 生产运维由 openclaw 的"运维斯"(ops agent) 协助，服务清单在生产机 `~/.openclaw/workspace-ops/SERVICES.md`

## 模型/依赖
- 实时语音对话: Gemini Live API（STT + LLM + TTS 一体，需 Google AI Studio API key）
- 发音评分: Chivox（需 Chivox API key）
- 会话评测 LLM: 可配置（GLM-4-flash-250414 曾被提及为参考选型）

## 业务语义/设计意图（防误改）
- 场景 voice↔NPC 对照表在 `src/lib/scenarios.ts` 的 `voiceName` 字段：
  - teahouse 小王（男）→ Puck
  - hotel 小李（女）→ Leda
  - market 张阿姨（女）→ Kore
- **NPC 语音性别错配（女 NPC 配男声）历史上出过两次**，改动 voiceName 或新增场景前必须核对 NPC 性别与音色性别一致

## 公网访问（Cloudflare Tunnel）
- 域名: voiceagent.bond（DNS 托管在 Cloudflare）
- chichat.voiceagent.bond → localhost:3458（ChiChat 学中文）
- app.voiceagent.bond → localhost:3457（voice-agent 学英语）
- 根域名 voiceagent.bond → 落地页（待建，计划用 Cloudflare Pages）
- 隧道名: voiceagent，ID: 74362578-3fcd-40c0-af55-9e0292000944
- 配置文件: ~/.cloudflared/config.yml
- 进程管理: launchd（com.cloudflare.cloudflared），开机自启 + 崩溃自动重启
- 加新服务: 编辑 config.yml 加 ingress → `cloudflared tunnel route dns voiceagent <subdomain>` → `launchctl kickstart -k gui/$(id -u)/com.cloudflare.cloudflared`

## 已知技术包袱
- 生产端口 3458 未在 repo 内配置文件中固化，依赖生产机启动参数 (待确认)
