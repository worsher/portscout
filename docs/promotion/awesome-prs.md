# awesome 列表 PR 计划

> 每个列表提交前先读它的 CONTRIBUTING（格式/排序/是否要求 star 数），条目按字母序插入对应分类。
> 建议节奏：一周内分散提交，不要同一天铺开。

## 目标列表与条目文案

### 1. awesome-claude-code（hesreallyhim/awesome-claude-code）

分类：Tooling / Ecosystem

```markdown
- [PortMarshal](https://github.com/worsher/portmarshal) - Agent-aware ownership and guarded orchestration for local dev services: attributes visible listeners to projects and coding agents, coordinates sticky port claims, and blocks cross-agent stops by default.
```

### 2. awesome-mac（jaywcjlove/awesome-mac）

分类：Developer Tools → Command Line Tools

```markdown
- [PortMarshal](https://github.com/worsher/portmarshal) - Attribute local dev listeners to their project and launching agent; guarded stop, sticky claims, and a SwiftBar menu-bar view. [![Open-Source Software][OSS Icon]](https://github.com/worsher/portmarshal)
```

### 3. awesome-cli-apps（agarrharr/awesome-cli-apps）

分类：Development / Productivity

```markdown
- [PortMarshal](https://github.com/worsher/portmarshal) - Find which project and coding agent owns a local port, coordinate sticky claims, and stop services behind an ownership guard.
```

### 4. SwiftBar 插件仓库（swiftbar/plugin-repository）

按其插件提交规范提交 `portmarshal.5s.sh` 包装脚本 + 截图；描述：

```
Live view of every dev server on your machine — port, project, launching
agent — with click-to-stop behind a confirm dialog. Powered by PortMarshal.
```

## 提交命令模板

```bash
gh repo fork <owner>/<repo> --clone
cd <repo>
# 编辑 README.md 插入条目（字母序）
git checkout -b add-portmarshal
git commit -am "Add portmarshal"
gh pr create --title "Add portmarshal" --body "Adds portmarshal: port attribution & guarded orchestration for multi-agent local development. https://github.com/worsher/portmarshal"
```
