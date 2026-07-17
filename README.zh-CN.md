# portscout

[![npm](https://img.shields.io/npm/v/@worsher/portscout)](https://www.npmjs.com/package/@worsher/portscout) [![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[English](README.md) | **简体中文**

本机端口服务的侦察与调度工具，为多 AI agent 并行开发场景设计：回答「哪个端口被谁占、属于哪个项目」，提供带护栏的端口预留与服务停止能力，防止 agent 之间端口冲突与互相误杀。

## 安装

```bash
npm install -g @worsher/portscout
portscout --help
```

或从源码：`pnpm install && pnpm build && npm link`

菜单栏（可选）：`brew install swiftbar`，启动 SwiftBar 后运行 `portscout menubar --install`。

## 命令

| 命令 | 说明 |
|---|---|
| `portscout list [--json] [--all] [--project .]` | 扫描监听端口 → 项目/来源/状态（●正常 ◐预留 ○未注册 ⚠漂移） |
| `portscout whois <port> [--json]` | 单端口归属详情：项目目录、启动命令、来源 |
| `portscout claim <name> [--prefer N] [--range A-B] [--json]` | 预留端口（幂等 + 粘性），stdout 仅输出端口号 |
| `portscout release <name>` | 释放预留（不停进程；服务仍在运行时会提示） |
| `portscout stop <port\|name> [--force\|--gui] [--json]` | 带护栏停止：孤儿/自己的直接停，他人活跃服务拦截 |
| `portscout gc [--kill-orphans]` | 回收过期预留，列出/停止孤儿服务 |
| `portscout watch` | 终端实时仪表盘（2s 刷新，q 退出） |
| `portscout menubar [--install]` | SwiftBar 菜单栏插件（点击可停止服务，含确认护栏） |

## 典型用法

```bash
# agent 启动 dev server 前预留端口（同一项目同名重复 claim 返回同一端口）
PORT=$(portscout claim web --prefer 3000)
npm run dev -- --port "$PORT"

# 「3000 是谁的？」
portscout whois 3000

# 我这个项目现在跑着哪些服务
portscout list --project . --json

# 端口被占，带护栏处置（他人活跃服务会被拦截并显示归属）
portscout stop 3000
```

## 来源识别

每个监听端口会被归属到启动来源：`claude-code` / `cursor` / `antigravity` / `vscode/electron` / `terminal` / `docker`（父进程链识别）；`launchd`（launchd 受管的自启动服务，如 LaunchAgent/登录项，通过 `launchctl list` 交叉验证）；`app`（/Applications 下 GUI 应用的后台进程）；`orphan`（父进程已退出的真孤儿——只有这类会被 `gc` 列出）。

## 三级停止护栏

| 目标服务 | 默认行为 |
|---|---|
| 孤儿（父进程已退出） | 直接停 |
| 自己的（调用方项目内，或预留记录属于调用方） | 直接停 |
| 他人的活跃服务 | 拦截并打印归属，agent 得到退出码 3；`--force` 放行；`--gui` 弹系统确认框 |

## 退出码

`0` 成功 · `1` 一般错误 · `2` 未找到 · `3` 被安全规则拦截（stop 他人活跃服务，需 --force）· `4` 注册表锁竞争超时（可重试）

## agent 接入（CLAUDE.md 约定）

```
- 启动任何 dev server 前，先 `PORT=$(portscout claim <服务名> --prefer <默认端口>)` 获取端口
- 找服务/怀疑冲突时，用 `portscout list --project . --json` 看本项目、`portscout whois <端口>` 查归属
- 端口被占需要处置时用 `portscout stop <端口>`；退出码 3 表示是别人的活跃服务，向用户展示归属并请示，不要 --force
```

## 开发

```bash
pnpm test    # 单元测试（纯 fixture，不碰真实系统命令）
pnpm smoke   # 端到端冒烟（起真实 http.server 验证归属/claim/stop 全链路）
pnpm build   # tsc
```

发版：改 `package.json` 的 version → 提交 → `git tag v<版本号> && git push origin v<版本号>`，GitHub Actions 自动跑门禁（build + 单测 + 冒烟 + tag 一致性校验）并发布到 npm（带 provenance）。

设计文档：[docs/specs/2026-07-16-portscout-design.md](docs/specs/2026-07-16-portscout-design.md) · 实施计划：[docs/plans/2026-07-16-portscout-implementation.md](docs/plans/2026-07-16-portscout-implementation.md)

macOS & Linux · Node ≥ 18 · 零运行时依赖（Linux 用 `ss` + `/proc` 直读，零额外 fork；`--gui` 与 `menubar --install` 仅 macOS，Linux 可将 menubar 输出接入 GNOME Argos）
