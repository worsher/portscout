# portscout

[![npm](https://img.shields.io/npm/v/@worsher/portscout)](https://www.npmjs.com/package/@worsher/portscout) [![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> Stop your AI coding agents from killing each other's dev servers.

**English** | [简体中文](README.zh-CN.md)

Port recon & guarded orchestration for multi-agent local development on macOS. When Claude Code, Cursor, Antigravity and friends all spin up dev servers on one machine, portscout answers *"which port belongs to which project, started by which agent"* — and provides idempotent port reservation plus a three-tier guarded stop so agents don't shoot each other down.

![demo](docs/demo.gif)

## Why

Run a few AI coding agents in parallel and you'll hit all three:

- **Silent drift** — an agent claims port 3000, vite finds it taken and quietly moves to 3001; now nothing knows where the service actually lives
- **Orphans** — sessions end, dev servers linger with no parent process; nobody remembers whose they were
- **Friendly fire** — agent A kills the port agent B is actively debugging on

Existing port managers only track services *they* launched. portscout's scanner is zero-intrusion: every listening port on the machine gets attributed — port → PID → project directory (cwd) → launching agent (parent-chain analysis) — whether or not anyone cooperated.

## Install

```bash
npm install -g @worsher/portscout
portscout --help
```

Menu bar (optional): `brew install swiftbar`, launch it once, then `portscout menubar --install`.

## Commands

| Command | What it does |
|---|---|
| `portscout list [--json] [--all] [--project .]` | Scan all listening ports → project / source / state (● active ◐ reserved ○ unregistered ⚠ drift) |
| `portscout whois <port> [--json]` | Single-port attribution: project dir, full command, launching agent, launchd label + plist |
| `portscout claim <name> [--prefer N] [--range A-B]` | Reserve a port (idempotent + sticky) — stdout is just the number, so `PORT=$(portscout claim web)` |
| `portscout release <name>` | Release a reservation (does not stop the process) |
| `portscout stop <port\|name> [--force\|--gui]` | Guarded stop: orphans & your own services stop directly; other agents' live services are blocked |
| `portscout gc [--kill-orphans]` | Reap stale reservations; list (optionally kill) true orphans |
| `portscout watch` | Live terminal dashboard (2s refresh, `q` to quit) |
| `portscout menubar [--install]` | SwiftBar menu-bar plugin with click-to-stop (guard included) |

## Source attribution

Every listening port is attributed to its launcher via parent-chain analysis: `claude-code` / `cursor` / `antigravity` / `vscode/electron` / `terminal` / `docker`; `launchd:<label>` for launchd-managed services (cross-checked against `launchctl list`, so auto-started daemons like an OpenClaw gateway are never mistaken for orphans); `app` for double-forked GUI-app helpers; `orphan` only for truly abandoned processes — the only category `gc` will touch.

## The three-tier stop guard

| Target | Default behavior |
|---|---|
| Orphan (parent exited) | stops immediately |
| Your own service (caller's project, or your reservation) | stops immediately |
| **Another agent's live service** | **blocked** — attribution printed, exit code 3; `--force` overrides, `--gui` shows a native confirm dialog |

Termination is graceful: SIGTERM → 3s wait → SIGKILL, and the registry entry is released afterwards.

## Exit codes

`0` ok · `1` error · `2` not found · `3` blocked by guard (needs `--force`) · `4` registry lock timeout (retryable)

## Agent integration

Add three lines to your global `CLAUDE.md` (or Cursor rules):

```
- Before starting any dev server, get a port via `PORT=$(portscout claim <service> --prefer <default>)`
- To find services or diagnose conflicts: `portscout list --project . --json`, `portscout whois <port>`
- To free a port use `portscout stop <port>`; exit code 3 means it's another agent's live service —
  show the attribution to the user and ask, do not --force
```

Uncooperative agents are still covered: their services get scanned and attributed regardless.

## Development

```bash
pnpm test    # unit tests (pure fixtures, no real system calls)
pnpm smoke   # end-to-end against a real HTTP server
pnpm build   # tsc
```

Releasing: bump `version` in package.json → commit → `git tag v<version> && git push origin v<version>`. GitHub Actions runs the full gate (build + tests + smoke + tag/version consistency) and publishes to npm with provenance.

Design doc: [docs/specs/2026-07-16-portscout-design.md](docs/specs/2026-07-16-portscout-design.md) · Changelog: [CHANGELOG.md](CHANGELOG.md)

macOS · Node ≥ 18 · zero runtime dependencies · MIT
