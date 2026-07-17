# awesome 列表 PR 计划

> 每个列表提交前先读它的 CONTRIBUTING（格式/排序/是否要求 star 数），条目按字母序插入对应分类。
> 建议节奏：一周内分散提交，不要同一天铺开。

## 目标列表与条目文案

### 1. awesome-claude-code（hesreallyhim/awesome-claude-code）

分类：Tooling / Ecosystem

```markdown
- [portscout](https://github.com/worsher/portscout) - Port recon & guarded orchestration for multi-agent local dev: attributes every listening port to its project and launching agent, reserves ports idempotently, and blocks agents from killing each other's dev servers. Three-line CLAUDE.md integration.
```

### 2. awesome-mac（jaywcjlove/awesome-mac）

分类：Developer Tools → Command Line Tools

```markdown
- [portscout](https://github.com/worsher/portscout) - Attribute every listening port to its project and launching app/agent; guarded stop, port reservation, SwiftBar menu-bar view. [![Open-Source Software][OSS Icon]](https://github.com/worsher/portscout)
```

### 3. awesome-cli-apps（agarrharr/awesome-cli-apps）

分类：Development / Productivity

```markdown
- [portscout](https://github.com/worsher/portscout) - Find out which port belongs to which project, started by which agent; reserve ports and stop services behind a safety guard.
```

### 4. SwiftBar 插件仓库（swiftbar/plugin-repository）

按其插件提交规范提交 `portscout.5s.sh` 包装脚本 + 截图；描述：

```
Live view of every dev server on your machine — port, project, launching
agent — with click-to-stop behind a confirm dialog. Powered by portscout.
```

## 提交命令模板

```bash
gh repo fork <owner>/<repo> --clone
cd <repo>
# 编辑 README.md 插入条目（字母序）
git checkout -b add-portscout
git commit -am "Add portscout"
gh pr create --title "Add portscout" --body "Adds portscout: port attribution & guarded orchestration for multi-agent local development. https://github.com/worsher/portscout"
```
