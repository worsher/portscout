# portscout

本机端口服务的侦察与调度工具，为多 AI agent 并行开发场景设计：回答「哪个端口被谁占、属于哪个项目」，提供带护栏的端口预留与服务停止能力，防止 agent 之间端口冲突与互相误杀。

## 核心能力

- **扫描归属**：`list` / `whois` — 端口 → PID → 项目目录 → 启动命令 → 来源（claude-code / cursor / antigravity / 终端 / 孤儿）
- **端口预留**：`claim` / `release` — 幂等 + 粘性分配，同一项目服务地址可预测
- **带护栏处置**：`stop` / `gc` — 孤儿与自己的服务直接停；他人的活跃服务默认拦截（agent 走退出码 3，人走确认对话框）
- **监视**：`watch` 终端仪表盘 / `menubar` SwiftBar 菜单栏插件
- **agent 友好**：全命令 `--json`，退出码语义化，两行 CLAUDE.md 约定即可接入

## 状态

设计已定稿（见 [docs/specs/2026-07-16-portscout-design.md](docs/specs/2026-07-16-portscout-design.md)），实现进行中。

## 环境

macOS · Node.js ≥ 18 · 零运行时依赖
