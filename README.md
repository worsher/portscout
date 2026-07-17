# PortMarshal

[![npm](https://img.shields.io/npm/v/@worsher/portmarshal)](https://www.npmjs.com/package/@worsher/portmarshal) [![test](https://github.com/worsher/portmarshal/actions/workflows/test.yml/badge.svg)](https://github.com/worsher/portmarshal/actions/workflows/test.yml) [![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> Know which coding agent owns a local dev server — and stop the wrong one from being killed.

**English** | [简体中文](README.zh-CN.md)

PortMarshal is an agent-aware ownership and safety layer for local development services on macOS and Linux. It maps attributable TCP listeners to their PID, project directory, and launching agent; coordinates sticky port claims; detects port drift; and blocks one agent from stopping another agent's active service by default.

![PortMarshal demo](docs/demo.gif)

## Why

Parallel coding agents create three recurring problems:

- **Silent drift** — an agent expects port 3000, but the framework silently starts on 3001.
- **Detached services** — a session exits while its dev server keeps listening.
- **Friendly fire** — one agent frees a port by stopping another agent's service.

PortMarshal scans first and coordinates second. Existing listeners do not need to be launched through PortMarshal to be discovered. Cooperative agents gain stable claims and stronger ownership signals, while uncooperative services still appear when the operating system exposes their process metadata.

## Install

```bash
npm install -g @worsher/portmarshal
portmarshal --help
```

Requires Node.js 18.17 or newer. The runtime has no npm dependencies.

### Migrating from PortScout

```bash
npm uninstall -g @worsher/portscout
npm install -g @worsher/portmarshal
```

On first use, PortMarshal copies an existing `~/.portscout/registry.json` into `~/.portmarshal/registry.json`, preserving sticky claims without deleting the old data.

## Commands

| Command | What it does |
|---|---|
| `portmarshal list [--json] [--all] [--project .]` | List listeners with project, source, and state: active, reserved, unregistered, or drift |
| `portmarshal whois <port> [--json]` | Inspect one port: PID, project directory, full command, agent or service source |
| `portmarshal claim <name> [--prefer N] [--range A-B]` | Allocate a cooperative sticky port claim; stdout contains only the port number |
| `portmarshal release <name>` | Release a claim without stopping its process |
| `portmarshal stop <port\|name> [--force\|--gui]` | Stop a service behind the ownership guard |
| `portmarshal gc [--kill-detached]` | Reap stale claims and review or stop detached service candidates |
| `portmarshal watch` | Refreshing terminal dashboard; press `q` to quit |
| `portmarshal menubar [--install]` | SwiftBar menu with guarded click-to-stop actions |

Typical agent startup:

```bash
PORT=$(portmarshal claim web --prefer 3000)
npm run dev -- --port "$PORT"
```

A claim is a cooperative lease, not an operating-system socket reservation. PortMarshal revalidates a previous claim before reusing it: a port must still be free or be attributable to the same project. There is still an unavoidable handoff window between returning a free port and the application binding it.

## Attribution and safety

PortMarshal follows the process parent chain to identify `claude-code`, `cursor`, `antigravity`, `vscode/electron`, `terminal`, and `docker`. It also recognizes `launchd:<label>` on macOS and `systemd:<unit>` on Linux. A process reparented to PID 1 without a recognized manager is labeled `detached` — this is a review signal, not proof that the process is abandoned.

| Target | Default `stop` behavior |
|---|---|
| Detached service or a service owned by the caller's project/claim | Stop with SIGTERM, then SIGKILL after 3 seconds if needed |
| Another active service | Block, print attribution, and exit with code 3 |

`--force` overrides the guard after review. On macOS, `--gui` asks through a native confirmation dialog.

PortMarshal can only attribute listeners whose process metadata is visible to the current user. For example, Linux `ss` output without PID information is not invented or guessed; those rows are omitted.

## Agent integration

Add this policy to `AGENTS.md`, `CLAUDE.md`, or your editor's agent rules:

```text
- Before starting a dev server, get a port with `PORT=$(portmarshal claim <service> --prefer <default>)`.
- Diagnose conflicts with `portmarshal list --project . --json` and `portmarshal whois <port> --json`.
- Stop services with `portmarshal stop <port>`; exit code 3 means another active service owns it, so show the attribution and ask before using --force.
```

A ready-to-copy Claude Code skill lives in [`integrations/claude-code/skills/portmarshal`](integrations/claude-code/skills/portmarshal).

## How it differs

- [`lsof`](https://man7.org/linux/man-pages/man8/lsof.8.html) and `ss` expose sockets and processes; PortMarshal adds project/agent attribution, claims, drift detection, and stop policy.
- [Sonar](https://github.com/RasKrebs/sonar) is a broad localhost and Docker management CLI; PortMarshal focuses on cross-agent ownership and guarded actions.
- [Portless](https://github.com/vercel-labs/portless) launches apps behind stable named local URLs; PortMarshal can inspect services whether or not it launched them. The tools can be used together.

## Development

```bash
pnpm test
pnpm smoke
pnpm build
```

GitHub Actions runs build, unit tests, and a real listener smoke test on macOS and Linux. Tagged releases publish to npm with provenance.

Design: [`docs/specs/2026-07-16-portmarshal-design.md`](docs/specs/2026-07-16-portmarshal-design.md) · [Changelog](CHANGELOG.md)

macOS and Linux · Node.js ≥ 18.17 · zero runtime dependencies · MIT
