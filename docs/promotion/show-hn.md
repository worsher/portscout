# Show HN 草稿

> 发帖建议：工作日美西早晨 8-10 点（北京时间 23:00-01:00）；发出后守前 2 小时回复评论。
> URL 填 GitHub 仓库，不要填 npm。

## Title

Show HN: Portscout – Stop AI coding agents from killing each other's dev servers

（备选：Show HN: I gave my AI agents a traffic controller for localhost ports）

## Text

Running Claude Code, Cursor and other AI coding agents in parallel on one Mac
kept producing the same three messes:

- An agent claims port 3000, vite finds it taken and silently drifts to 3001 —
  now the agent can't find its own dev server
- Sessions end, dev servers linger as orphan processes nobody can attribute
- Agent A kills the port agent B is actively debugging on

Existing port managers only track services they launched. Portscout scans
zero-intrusion instead: every listening port gets attributed — port → PID →
project directory → launching agent, via parent-chain analysis, with
`launchctl list` cross-checking so auto-started daemons aren't mistaken for
orphans.

On top of that: idempotent port reservation (`PORT=$(portscout claim web)`),
and a three-tier guarded stop — orphans and your own services stop instantly,
another agent's live service is blocked with attribution (exit 3) unless you
--force. Agents integrate via three lines in CLAUDE.md; humans get a SwiftBar
menu-bar view with click-to-stop behind a native confirm dialog.

TypeScript, zero runtime dependencies, macOS only for now (Linux planned).
MIT. Built end-to-end with Claude Code in two days — design doc, 8 TDD tasks,
per-task subagent code review, and the review rounds caught real bugs
(an AppleScript injection in the confirm dialog among them).

https://github.com/worsher/portscout
