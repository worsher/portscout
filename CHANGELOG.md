# Changelog

## 0.1.2 — 未发布

- **扫描性能优化**：子进程调用从 `3 + 2N` 次（N = 监听进程数）压缩为**固定 5 次**——ps 全表一次取全部命令行、lsof `-p p1,p2,...` 一次批量反查全部 cwd。实测（30+ 监听进程的机器）：walltime 0.18s → 0.089s（2 倍），CPU 0.88s → 0.14s（6 倍）；menubar（5s 轮询）与 watch（2s 刷新）的常驻开销显著下降

## 0.1.1 — 2026-07-17

- **来源判定三层化**：`ppid=1` 不再一律判孤儿——launchd 受管服务（LaunchAgent/登录项，经 `launchctl list` 交叉验证）标为 `launchd:<注册label>`；/Applications 下 GUI 应用的双 fork 后台进程标为 `app`；仅真正被收养的遗留进程才是 `orphan`（起因：OpenClaw gateway 等自启动服务被误判孤儿，`gc --kill-orphans` 有误杀风险）
- **whois 定位服务定义**：launchd 来源的端口显示注册 label 并探测 plist 文件路径（LaunchAgents / LaunchDaemons 常规目录）
- 修复：`.app` 启发式限定 /Applications 前缀，避免误伤 homebrew Python（解释器路径含 Python.app）启动的 dev server

## 0.1.0 — 2026-07-16

首个发布版本：

- 扫描归属引擎：端口 → PID → 项目目录（cwd + 命令行兜底）→ 启动来源（claude-code / cursor / antigravity / vscode/electron / terminal / docker / orphan，父进程链识别）
- 端口预留：`claim`（幂等 + 粘性，唯一键 (项目, 名称)）/ `release`，注册表 mkdir 锁 + 撕裂写入宽限
- 带护栏停止：孤儿与自己的服务直接停，他人活跃服务拦截（agent 退出码 3 / GUI osascript 确认框），SIGTERM→SIGKILL 优雅降级
- 漂移检测：claim 的端口与实际监听端口不符时双向标记 ⚠
- `gc` 孤儿清理、`watch` 终端仪表盘、`menubar` SwiftBar 插件（`--install` 一键安装）
- 全命令 `--json` + 语义化退出码（0/1/2/3/4），零运行时依赖，仅 macOS
