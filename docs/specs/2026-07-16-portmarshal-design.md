# PortMarshal 设计文档 — Agent-aware 本地端口归属与停止护栏

> 2026-07-16 初版，2026-07-17 更新至 v0.3.0 实现状态。

## 背景与目标

多个 AI agent（Claude Code / Cursor / Antigravity）在同一台机器上并行开发，各自启动 dev server，导致：端口冲突启动失败、vite 静默换端口后 agent 找不到自己的服务、会话结束后遗留脱离会话进程占着端口没人认领（实测本机 8901 就挂着一个父进程已退出的 http.server）。

目标：一条命令回答「哪个端口被谁占、属于哪个项目」；agent 启动服务前可协作式分配端口；脱离会话进程可发现、可清理。

**设计原则：扫描发现是基座（零侵入，覆盖当前用户可读取进程元数据的监听服务），协作式 claim 是增强（给配合的 agent 用）。**

## 命令接口

```
portmarshal list [--json] [--all] [--project <dir|.>]
                                    # 扫描全机 LISTEN 端口，输出归属表；--project 只看某项目
portmarshal whois <port> [--json]     # 单端口详情：项目目录/命令/来源/注册信息
portmarshal claim <name> [--prefer N] [--range A-B] [--json]
                                    # 协作式分配空闲端口，stdout 仅输出端口号
                                    # 幂等：同 (项目,name) 重复 claim 返回原端口
                                    # 粘性：历史分配过的端口优先复用，地址可预测
portmarshal release <name>            # 仅释放预留记录，不停止进程；服务仍在监听时告警提示
portmarshal stop <port|name> [--force|--gui] [--json]
                                    # 带护栏地停止端口上的服务（见下节安全规则）
                                    # --gui：护栏改用 osascript 确认框+系统通知（菜单栏用）
portmarshal gc [--kill-detached]       # 清理死注册记录；列出（可选杀掉）脱离会话候选服务
portmarshal watch                     # 终端仪表盘，实时刷新
portmarshal menubar [--install]       # 输出 SwiftBar/xbar 插件协议文本；--install 写入插件目录
```

- `list` 默认过滤噪音（IDE 内部 language server、系统服务），`--all` 显示全部。
- `claim` 的典型用法：`PORT=$(portmarshal claim mu-frontend --prefer 8000)`，冲突时自动顺延并返回实际端口；stdout 纯数字保证可脚本化，人类信息走 stderr。
- 所有查询命令支持 `--json`，字段稳定，供 agent 消费。

## 归属引擎（核心）

```
lsof -iTCP -sTCP:LISTEN -P -n          → 全量 (pid, port)
对每个唯一 pid（并发执行）：
  lsof -a -p PID -d cwd                → 项目目录
  ps -o command= -p PID                → 完整启动命令
  循环 ps -o ppid=/comm=  向上爬父链   → 来源标签：claude-code / cursor /
                                          antigravity / vscode / terminal:xxx /
                                          docker / detached(父进程已退出)
与注册表 join                          → 四种状态：
                                          ● 已注册+在监听（正常）
                                          ◐ 已注册未监听（预留待启动）
                                          ○ 在监听未注册（推断归属）
                                          ⚠ 漂移：同一项目「注册的端口未监听 +
                                            监听着未注册端口」同时成立
                                            （典型：claim 了 8000，vite 静默换到 8001）
```

漂移是本工具要解决的核心痛点之一：list/watch 高亮提示，whois 给出对账建议（更新注册或重启服务）。

cwd 失真兜底：若 cwd 为 `/` 或明显非项目目录，从命令行参数中提取绝对路径推断项目。

## 注册表

`~/.portmarshal/registry.json`，条目：

```json
{ "name": "mu-frontend", "port": 8000, "project": "/Users/worsher/code/work/mu_frontend",
  "pid": 8660, "claimedAt": "2026-07-16T10:00:00+08:00", "claimedBy": "cursor" }
```

- **唯一键 = (project, name)**：同一项目多服务用不同 name（web/mock/storybook）；不同 worktree 路径不同，天然不撞名。
- **幂等与粘性**：同键重复 claim，若原端口仍空闲或仍被本项目占用 → 返回原端口；释放后再 claim 同键 → 优先复用历史端口（记录保留 lastPort）。
- 并发安全：写入前以 `mkdir ~/.portmarshal/.lock`（O_EXCL 语义）取锁，超时 2s 强夺（附 pid 检查）。
- `claim` 双重校验：注册表无冲突 **且** 实扫端口空闲，才写入返回。
- `gc` 规则：记录的 pid 已死或端口未监听 → 标记过期并清除（保留 lastPort 供粘性复用）；claim 后 30 分钟仍未监听 → 视为遗忘，回收。

## stop 安全规则（防 agent 互相误杀）

多 agent 场景最大的事故是 agent A 杀掉 agent B 正在用的服务。stop 不是裸 kill，按归属分级：

| 目标服务 | 默认行为 |
|---|---|
| 脱离会话候选服务（父进程已退出） | 直接停 |
| 自己的服务（调用方 cwd 与服务 cwd 同项目，或注册记录属于自己） | 直接停 |
| 别的 agent 的活跃服务（父链上有存活的 claude/cursor/antigravity/terminal） | **拒绝**，打印归属信息，要求 `--force` |

- 终止方式优雅降级：SIGTERM → 等 3s → SIGKILL；退出后自动清理注册表对应记录
- `gc --kill-detached` 复用同一终止逻辑，且只作用于detached 级
- agent 约定中可放心写「端口被占用 `portmarshal stop` 处置」——误杀由工具拦截，而非依赖 agent 自觉

## watch 仪表盘

零依赖 ANSI 终端渲染（不引入 ink/blessed）：2 秒间隔重扫重绘，表格同 `list`，差异高亮——新增行绿色、消失行红色保留一轮、detached 行黄色。`q` 退出。适合调试时盯看；被动余光监视用下面的菜单栏形态。

## 菜单栏（SwiftBar/xbar 插件）

`portmarshal menubar` 按 SwiftBar/xbar 插件协议输出文本，宿主 app 定时执行渲染（推荐 SwiftBar，`brew install swiftbar`，开源免费；刷新间隔由插件文件名约定，如 `portmarshal.5s.sh`）。

菜单结构：

```
⚓5 ⚠1                                ← 常驻标题：服务数 + 异常数（有 detached/漂移变警示色）
---
⚠ 8901 脱离会话候选服务 · site-platform      ← 顶层一行一个服务
-- 停止服务                           ← 子菜单动作，挂 stop --gui
-- 在 Finder 中打开项目目录
8000 mu_frontend · cursor 启动
-- 停止服务…（cursor 正在使用）
-- 复制 http://localhost:8000
-- 在 Finder 中打开项目目录
---
清理 detached 候选 (gc) / 刷新
```

- 点击动作全部挂 CLI 命令（`bash=portmarshal param1=stop param2=8000 terminal=false refresh=true`），菜单栏只是渲染器，逻辑仍集中在 CLI。
- **护栏的 GUI 形态（stop --gui）**：detached/自己的服务直接停 + 系统通知结果；他人活跃服务先弹 osascript 确认对话框（列明归属），确认即 force；失败以系统通知告知。护栏规则与终端模式完全一致，仅呈现方式不同，实现零新增依赖（osascript 系统自带）。
- 安装：`portmarshal menubar --install` 自动写入 SwiftBar 插件目录一个 5 秒间隔的包装脚本。

## 退出码约定（agent 分支决策依据）

| code | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 一般错误（lsof 失败、注册表损坏等） |
| 2 | 未找到（whois/stop/release 目标不存在） |
| 3 | **被安全规则拦截**（stop 目标是他人活跃服务，需 `--force`）|
| 4 | 锁竞争超时（claim/release 可重试） |

3 与 1 分开是关键：agent 收到 3 应把归属信息呈现给用户决策，而不是当作失败重试。

## agent 接入约定

全局 `~/.claude/CLAUDE.md` 增加三行：

```
- 启动任何 dev server 前，先 `PORT=$(portmarshal claim <服务名> --prefer <默认端口>)` 获取端口
- 找服务/怀疑冲突时，用 `portmarshal list --project . --json` 看本项目、`portmarshal whois <端口>` 查归属
- 端口被占需要处置时用 `portmarshal stop <端口>`；退出码 3 表示是别人的活跃服务，向用户展示归属并请示，不要 --force
```

Cursor/Antigravity 可在各自规则文件加同样约定；不遵守约定的 agent 其服务仍会被扫描发现并归属。

## 技术栈与项目结构

- Node.js ≥ 18 + TypeScript，**零运行时依赖**（child_process 调 lsof/ps，手写 argv 解析与 ANSI 渲染）
- 支持 macOS（`lsof` / `launchctl`）与 Linux（`ss` / `/proc` / systemd cgroup）
- 结构：`src/scan.ts`（归属引擎）、`src/registry.ts`（注册表+锁）、`src/commands/*.ts`（六命令）、`src/render.ts`（表格/ANSI）、`bin/portmarshal`
- 安装：`pnpm build && pnpm link --global`

## 错误处理

- lsof 不存在/无权限 → 明确报错并提示；单 pid 反查失败 → 该行降级显示 `?`，不中断整表
- 注册表 JSON 损坏 → 备份为 `.bak` 后重建空表，stderr 告警
- `claim` 在锁竞争超时 → 非零退出码 + stderr 说明，agent 可重试

## 测试

- 单测：lsof/ps 输出解析、父链来源判定、claim 冲突顺延、**claim 幂等/粘性**、**漂移状态判定**、gc 过期判定、**stop 三级规则与退出码**、**menubar 协议输出格式**（fixture 模拟命令输出）
- 冒烟：spawn 一个 `python -m http.server`，断言 list 能归属到正确 cwd；claim → 端口真实空闲 → 重复 claim 返回同一端口；stop 能优雅终止它并清理注册记录；gc 能识别人为制造的死记录

## 明确不做（YAGNI）

- 不做常驻 daemon、HTTP API、Web UI（watch + 菜单栏已覆盖可视需求）
- 不做独立原生菜单栏 app（Tauri/Swift）：SwiftBar 插件已达成体验，日后有需要再评估，CLI 核心无需改动
- 不做反向代理/域名映射（方案 C 范畴）
- 不做跨机器/团队共享
- 不做 HTTP 健康探活（端口监听即事实，应用层探活 `curl` 一行可达）
- watch 仪表盘保持只读，不做按键杀进程（处置统一走 stop，保留护栏与审计路径）
- Docker 容器内服务归属：v1 只标记为 docker 来源，不穿透
