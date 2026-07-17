# Claude Code 集成

## 方式一：skill（推荐）

把 skill 复制到用户级 skills 目录，所有会话自动可用：

```bash
mkdir -p ~/.claude/skills/portscout
curl -fsSL https://raw.githubusercontent.com/worsher/portscout/main/integrations/claude-code/skills/portscout/SKILL.md \
  -o ~/.claude/skills/portscout/SKILL.md
```

Claude Code 会在涉及「启动 dev server / 端口冲突 / 找服务」时自动调用该 skill。

## 方式二：CLAUDE.md 约定（三行）

在全局或项目 CLAUDE.md 中追加：

```
- 启动任何 dev server 前，先 `PORT=$(portscout claim <服务名> --prefer <默认端口>)` 获取端口
- 找服务/怀疑端口冲突时，用 `portscout list --project . --json` 看本项目、`portscout whois <端口>` 查归属
- 端口被占需要处置时用 `portscout stop <端口>`；退出码 3 表示是别人的活跃服务，向用户展示归属并请示，不要 --force
```
