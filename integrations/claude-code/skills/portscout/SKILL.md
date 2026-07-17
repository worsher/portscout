---
name: portscout
description: 本机端口服务的查询、预留与带护栏停止。当需要启动 dev server、排查端口冲突、寻找某端口属于哪个项目/agent、清理孤儿服务时使用。防止多 agent 端口冲突与互相误杀。
---

# portscout — 端口侦察与调度

前置：`npm i -g @worsher/portscout`（macOS）。以下命令均可加 `--json` 获得结构化输出。

## 启动 dev server 之前

先预留端口（幂等：同一项目同名重复调用返回同一端口）：

```bash
PORT=$(portscout claim <服务名> --prefer <默认端口>)
# 然后用 $PORT 启动服务，例如：npm run dev -- --port "$PORT"
```

## 查询与排查

```bash
portscout list --project . --json   # 本项目正在监听的服务
portscout list --json               # 全机视图（含来源归属与 ⚠ 漂移标记）
portscout whois <端口> --json       # 这个端口是谁的：项目目录/命令/来源
```

来源标签含义：`claude-code`/`cursor`/`antigravity`/`terminal` 等为启动工具；`launchd:<label>` 为系统自启动服务（**不要停止**）；`orphan` 为无主遗留进程（可清理）。

## 停止服务（护栏语义）

```bash
portscout stop <端口>
```

- 退出码 0：已停止（孤儿或本项目的服务）
- **退出码 3：被拦截——这是其他 agent 的活跃服务。把归属信息展示给用户并请示，不要擅自 `--force`**
- 退出码 2：端口无监听

清理全部孤儿：`portscout gc --kill-orphans`（launchd 服务不会被误伤）。

## 端口被占的标准处置流程

1. `portscout whois <端口>` 看归属
2. 是自己项目的旧进程 → `portscout stop <端口>` 直接停
3. 是别人的活跃服务 → 换端口：`PORT=$(portscout claim <服务名>)` 自动分配空闲端口
4. 是孤儿 → `portscout stop <端口>` 可直接停
