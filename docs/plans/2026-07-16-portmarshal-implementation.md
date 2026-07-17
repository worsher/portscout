# PortMarshal 初始实施计划（历史快照）

> 本文保留 v0.1.0 的任务拆分与当时代码草案，仅用于追溯实现过程。当前命令、来源标签和安全语义以 README、设计文档与 `src/` 为准；v0.3.0 已将 `orphan` 更正为 `detached`，并支持 Linux。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 portmarshal CLI——本机端口服务扫描归属、幂等预留、带护栏停止，含终端 watch 与 SwiftBar 菜单栏两种监视形态。

**Architecture:** 单一归属引擎（lsof/ps 解析 → cwd/父链反查）+ 注册表（JSON + mkdir 锁），命令层是薄壳，渲染分表格 / JSON / TUI / SwiftBar 协议四种。核心逻辑全部为可注入依赖的纯函数/类，单测不碰真实系统命令。

**Tech Stack:** TypeScript (ESM, strict) · Node ≥ 18 · 零运行时依赖 · devDeps: typescript / tsx / @types/node · 测试用 node:test（tsx --test 驱动）· 仅 macOS

**Spec:** `docs/specs/2026-07-16-portmarshal-design.md`（v4，已批准）

## Global Constraints

- 零运行时依赖；开发依赖仅 typescript、tsx、@types/node
- 包管理器 pnpm；验证命令 `pnpm build`（tsc）与 `pnpm test`
- 退出码语义：0 成功 / 1 一般错误 / 2 未找到 / 3 被安全规则拦截 / 4 锁竞争超时
- 注册表唯一键 = (project, name)；released 记录保留 lastPort 供粘性复用
- 所有查询命令支持 `--json`；claim 的 stdout 仅输出端口号，人类信息走 stderr
- 用户可见文案用中文；代码标识符/commit message 用英文，commit 结尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## 文件结构

```
package.json / tsconfig.json
src/cli.ts              # 入口：argv 解析、命令分发、退出码（含 shebang）
src/types.ts            # 共享类型与退出码常量
src/exec.ts             # execFile Promise 包装（可注入）
src/scan.ts             # 归属引擎：lsof/ps 解析、来源判定、噪音过滤、组装
src/registry.ts         # Registry 类：load/save/lock/claim/release/gc + isPortFree
src/merge.ts            # scan × registry → 四状态（含漂移）
src/render.ts           # 表格渲染 + ANSI 颜色 + watch 帧格式化
src/commands/list.ts, whois.ts, claim.ts, release.ts, stop.ts, gc.ts, watch.ts, menubar.ts
tests/fixtures.ts       # lsof/ps 输出样本
tests/scan.test.ts, registry.test.ts, merge.test.ts, stop.test.ts, menubar.test.ts, smoke.test.ts
```

---

### Task 1: 脚手架与 CLI 骨架

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/types.ts`, `src/cli.ts`

**Interfaces:**
- Produces: `EXIT` 常量对象；`cli.ts` 的子命令分发框架（后续任务向 `COMMANDS` 表注册）；`parseFlags(args)` 
- 后续所有任务的类型来源：`src/types.ts`

- [ ] **Step 1: 写 package.json 与 tsconfig.json**

`package.json`:

```json
{
  "name": "portmarshal",
  "version": "0.1.0",
  "description": "本机端口服务侦察与调度，防多 agent 端口冲突",
  "type": "module",
  "bin": { "portmarshal": "dist/cli.js" },
  "engines": { "node": ">=18.17" },
  "scripts": {
    "build": "tsc",
    "test": "tsx --test tests/scan.test.ts tests/registry.test.ts tests/merge.test.ts tests/stop.test.ts tests/menubar.test.ts",
    "smoke": "pnpm build && tsx --test tests/smoke.test.ts"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*"]
}
```

运行 `pnpm install`，预期生成 node_modules 与 pnpm-lock.yaml。

- [ ] **Step 2: 写 src/types.ts**

```typescript
export interface ListenEntry {
  pid: number;
  port: number;
  address: string;
}

export interface PsRow {
  pid: number;
  ppid: number;
  comm: string;
}

export interface ProcessInfo {
  pid: number;
  ports: number[];
  procName: string;
  command: string;
  cwd: string | null;
  /** 从命令行参数推断的项目路径（cwd 失真时的兜底） */
  inferredProject: string | null;
  source: string; // "claude-code" | "cursor" | "antigravity" | "vscode/electron" | "terminal" | "docker" | "orphan" | "?"
}

export interface RegistryEntry {
  name: string;
  project: string;
  port: number;
  claimedAt: string; // ISO 8601
  claimedBy?: string;
  released?: boolean;
  lastPort?: number;
}

export type PortState = "active" | "reserved" | "unregistered" | "drift";

export interface MergedEntry {
  port: number;
  state: PortState;
  proc?: ProcessInfo;
  reg?: RegistryEntry;
  driftPeer?: number;
}

export const EXIT = {
  OK: 0,
  ERR: 1,
  NOT_FOUND: 2,
  BLOCKED: 3,
  LOCK_TIMEOUT: 4,
} as const;
```

- [ ] **Step 3: 写 src/cli.ts 骨架**

```typescript
#!/usr/bin/env node
import { EXIT } from "./types.js";

export interface Flags {
  json: boolean;
  all: boolean;
  force: boolean;
  gui: boolean;
  install: boolean;
  killOrphans: boolean;
  project?: string;
  prefer?: number;
  range?: [number, number];
  positional: string[];
}

export function parseFlags(args: string[]): Flags {
  const f: Flags = {
    json: false, all: false, force: false, gui: false,
    install: false, killOrphans: false, positional: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--json": f.json = true; break;
      case "--all": f.all = true; break;
      case "--force": f.force = true; break;
      case "--gui": f.gui = true; break;
      case "--install": f.install = true; break;
      case "--kill-orphans": f.killOrphans = true; break;
      case "--project": f.project = args[++i]; break;
      case "--prefer": f.prefer = Number(args[++i]); break;
      case "--range": {
        const m = /^(\d+)-(\d+)$/.exec(args[++i] ?? "");
        if (!m) throw new Error("--range 格式应为 A-B，如 3000-3999");
        f.range = [Number(m[1]), Number(m[2])];
        break;
      }
      default:
        if (a.startsWith("--")) throw new Error(`未知选项: ${a}`);
        f.positional.push(a);
    }
  }
  return f;
}

const HELP = `portmarshal — 本机端口服务侦察与调度

用法:
  portmarshal list [--json] [--all] [--project <dir|.>]
  portmarshal whois <port> [--json]
  portmarshal claim <name> [--prefer N] [--range A-B] [--json]
  portmarshal release <name>
  portmarshal stop <port|name> [--force|--gui] [--json]
  portmarshal gc [--kill-orphans]
  portmarshal watch
  portmarshal menubar [--install]
`;

type CommandFn = (flags: Flags) => Promise<number>;
const COMMANDS: Record<string, () => Promise<{ default: CommandFn }>> = {
  // 后续任务在此注册: list, whois, claim, release, stop, gc, watch, menubar
};

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  const loader = COMMANDS[cmd];
  if (!loader) {
    process.stderr.write(`未知命令: ${cmd}\n\n${HELP}`);
    return EXIT.ERR;
  }
  try {
    const mod = await loader();
    return await mod.default(parseFlags(rest));
  } catch (e) {
    process.stderr.write(`portmarshal: ${(e as Error).message}\n`);
    return EXIT.ERR;
  }
}

main().then((code) => { process.exitCode = code; });
```

- [ ] **Step 4: 构建并验证**

```bash
pnpm build && node dist/cli.js --help && node dist/cli.js nosuch; echo "exit=$?"
```

预期：打印帮助；`未知命令: nosuch` 且 exit=1。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: project scaffold with CLI skeleton and shared types

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 解析器与来源判定（纯函数）

**Files:**
- Create: `src/exec.ts`, `src/scan.ts`（本任务只写纯函数部分）, `tests/fixtures.ts`, `tests/scan.test.ts`

**Interfaces:**
- Consumes: `types.ts` 的 `ListenEntry` / `PsRow`
- Produces: `parseLsofListeners(text): ListenEntry[]`、`parsePsTable(text): Map<number, PsRow>`、`traceSource(pid, table): string`、`inferProjectFromCommand(cmd): string | null`、`isNoise(procName): boolean`、`exec.ts` 的 `type Exec` 与 `realExec`

- [ ] **Step 1: 写 src/exec.ts**

```typescript
import { execFile } from "node:child_process";

export type Exec = (cmd: string, args: string[]) => Promise<string>;

/** 容错执行：lsof 无匹配时退出码非 0，一律返回 stdout（可能为空串） */
export const realExec: Exec = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (_err, stdout) => {
      resolve(stdout ?? "");
    });
  });
```

- [ ] **Step 2: 写 tests/fixtures.ts**

```typescript
/** lsof -iTCP -sTCP:LISTEN -P -n -Fpcn 的机器格式样本 */
export const LSOF_FPCN = `p2755
cPython
n*:8901
p8660
cnode
n127.0.0.1:8000
n[::1]:8000
p31401
cCursor Helper (Plugin)
n127.0.0.1:63979
`;

/** ps -axo pid=,ppid=,comm= 样本：
 * 2755 为孤儿(ppid=1)；8660 父链 zsh(700)→Cursor(600)；31401 父链 →Cursor(600) */
export const PS_TABLE = `    1     0 /sbin/launchd
 2755     1 /opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python
  600     1 /Applications/Cursor.app/Contents/MacOS/Cursor
  700   600 /bin/zsh
 8660   700 /Users/worsher/.n/bin/node
31401   600 /Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)
`;
```

- [ ] **Step 3: 写失败测试 tests/scan.test.ts**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLsofListeners, parsePsTable, traceSource,
  inferProjectFromCommand, isNoise,
} from "../src/scan.js";
import { LSOF_FPCN, PS_TABLE } from "./fixtures.js";

test("parseLsofListeners 解析机器格式并处理 IPv6", () => {
  const entries = parseLsofListeners(LSOF_FPCN);
  assert.deepEqual(entries, [
    { pid: 2755, port: 8901, address: "*" },
    { pid: 8660, port: 8000, address: "127.0.0.1" },
    { pid: 8660, port: 8000, address: "[::1]" },
    { pid: 31401, port: 63979, address: "127.0.0.1" },
  ]);
});

test("parsePsTable 建立 pid→行 映射", () => {
  const table = parsePsTable(PS_TABLE);
  assert.equal(table.get(8660)?.ppid, 700);
  assert.equal(table.get(2755)?.comm.endsWith("Python"), true);
});

test("traceSource 识别 cursor / orphan / 未知", () => {
  const table = parsePsTable(PS_TABLE);
  assert.equal(traceSource(8660, table), "cursor");   // node→zsh→Cursor
  assert.equal(traceSource(2755, table), "orphan");   // ppid=1 且无匹配
  assert.equal(traceSource(99999, table), "?");       // 不在表中
});

test("inferProjectFromCommand 从命令行提取项目路径", () => {
  assert.equal(
    inferProjectFromCommand("/Users/w/.n/bin/node /Users/w/code/work/mu_frontend/node_modules/umi/bin/forkedDev.js"),
    "/Users/w/code/work/mu_frontend",
  );
  assert.equal(inferProjectFromCommand("python3 -m http.server 8901"), null);
});

test("isNoise 过滤 IDE 内部进程", () => {
  assert.equal(isNoise("Cursor Helper (Plugin)"), true);
  assert.equal(isNoise("language_server_macos_arm"), true);
  assert.equal(isNoise("node"), false);
  assert.equal(isNoise("Python"), false);
});
```

- [ ] **Step 4: 运行确认失败**

```bash
pnpm test 2>&1 | tail -5
```

预期：FAIL，`src/scan.js` 导出不存在。

- [ ] **Step 5: 实现 src/scan.ts 纯函数部分**

```typescript
import type { ListenEntry, PsRow } from "./types.js";

export function parseLsofListeners(text: string): ListenEntry[] {
  const out: ListenEntry[] = [];
  let pid = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    } else if (line.startsWith("n")) {
      const addr = line.slice(1);
      const i = addr.lastIndexOf(":");
      if (i < 0) continue;
      const port = Number(addr.slice(i + 1));
      if (!Number.isFinite(port) || port <= 0) continue;
      out.push({ pid, port, address: addr.slice(0, i) });
    }
  }
  return out;
}

export function parsePsTable(text: string): Map<number, PsRow> {
  const map = new Map<number, PsRow>();
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    map.set(pid, { pid, ppid: Number(m[2]), comm: m[3].trim() });
  }
  return map;
}

const SOURCE_PATTERNS: Array<[RegExp, string]> = [
  [/claude/i, "claude-code"],
  [/cursor/i, "cursor"],
  [/antigrav/i, "antigravity"],
  [/code helper|vscode|electron/i, "vscode/electron"],
  [/iterm|apple_terminal|terminal\.app|warp|kitty|alacritty|wezterm|tmux/i, "terminal"],
  [/docker/i, "docker"],
];

export function traceSource(pid: number, table: Map<number, PsRow>): string {
  let cur = table.get(pid);
  if (!cur) return "?";
  for (let depth = 0; cur && depth < 20; depth++) {
    const base = cur.comm.split("/").pop() ?? cur.comm;
    for (const [re, label] of SOURCE_PATTERNS) {
      if (re.test(base)) return label;
    }
    if (cur.ppid === 1) return "orphan";
    if (cur.ppid <= 0) return "?";
    cur = table.get(cur.ppid);
  }
  return "?";
}

/** cwd 失真兜底：从命令行第一个含 node_modules 或以 / 开头的脚本参数推断项目根 */
export function inferProjectFromCommand(command: string): string | null {
  for (const tok of command.split(/\s+/)) {
    const nm = tok.indexOf("/node_modules/");
    if (nm > 0) return tok.slice(0, nm);
  }
  return null;
}

const NOISE = /^(language_server|Antigravity|Electron$|Cursor|Code Helper|ControlCenter|rapportd|sharingd|AnyDesk|aTrust|MacPacketTunnel|identityservicesd|AMPDeviceDiscoveryAgent)/i;

export function isNoise(procName: string): boolean {
  return NOISE.test(procName);
}
```

- [ ] **Step 6: 运行确认通过并提交**

```bash
pnpm test 2>&1 | tail -5
```

预期：5 个测试全部 PASS。

```bash
git add -A && git commit -m "feat: lsof/ps parsers, source tracing, noise filter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 扫描组装 + list / whois 命令

**Files:**
- Modify: `src/scan.ts`（追加 `scanListeners`）, `src/cli.ts`（注册 list/whois）
- Create: `src/render.ts`, `src/commands/list.ts`, `src/commands/whois.ts`
- Test: `tests/scan.test.ts`（追加）

**Interfaces:**
- Consumes: Task 2 的解析函数与 `Exec`
- Produces: `scanListeners(exec?: Exec): Promise<ProcessInfo[]>`；`render.ts` 的 `formatTable(rows: string[][], header: string[]): string` 与 `C`（ANSI 颜色常量 `{ red, green, yellow, dim, reset }`）；`resolveProjectDir(p: ProcessInfo): string | null`（优先 cwd，失真时用 inferredProject）

- [ ] **Step 1: 追加失败测试（scanListeners 用 fake exec）**

在 `tests/scan.test.ts` 追加：

```typescript
import { scanListeners, resolveProjectDir } from "../src/scan.js";
import type { Exec } from "../src/exec.js";

const fakeExec: Exec = async (cmd, args) => {
  if (cmd === "lsof" && args.includes("-Fpcn")) return LSOF_FPCN;
  if (cmd === "ps" && args.includes("pid=,ppid=,comm=")) return PS_TABLE;
  if (cmd === "lsof" && args.includes("cwd")) {
    const pid = args[args.indexOf("-p") + 1];
    if (pid === "2755") return "p2755\nfcwd\nn/private/tmp/site-platform/scratchpad\n";
    if (pid === "8660") return "p8660\nfcwd\nn/Users/worsher/code/work/mu_frontend\n";
    return "";
  }
  if (cmd === "ps" && args.includes("command=")) {
    const pid = args[args.indexOf("-p") + 1];
    if (pid === "2755") return "python3 -m http.server 8901\n";
    if (pid === "8660") return "/Users/worsher/.n/bin/node /Users/worsher/code/work/mu_frontend/node_modules/umi/bin/forkedDev.js\n";
    return "";
  }
  return "";
};

test("scanListeners 组装 ProcessInfo：去重端口、归属 cwd、来源", async () => {
  const infos = await scanListeners(fakeExec);
  const byPid = new Map(infos.map((p) => [p.pid, p]));
  const py = byPid.get(2755)!;
  assert.deepEqual(py.ports, [8901]);
  assert.equal(py.cwd, "/private/tmp/site-platform/scratchpad");
  assert.equal(py.source, "orphan");
  const umi = byPid.get(8660)!;
  assert.deepEqual(umi.ports, [8000]); // IPv4+IPv6 去重
  assert.equal(umi.source, "cursor");
  assert.equal(umi.inferredProject, "/Users/worsher/code/work/mu_frontend");
});

test("resolveProjectDir 优先 cwd，cwd 为根目录时用 inferredProject", () => {
  const base = { pid: 1, ports: [1], procName: "node", command: "", source: "?" };
  assert.equal(
    resolveProjectDir({ ...base, cwd: "/a/b", inferredProject: null }),
    "/a/b",
  );
  assert.equal(
    resolveProjectDir({ ...base, cwd: "/", inferredProject: "/x/y" }),
    "/x/y",
  );
});
```

运行 `pnpm test`，预期 FAIL（scanListeners 未定义）。

- [ ] **Step 2: 实现 scanListeners 与 resolveProjectDir（追加到 src/scan.ts）**

```typescript
import type { ProcessInfo } from "./types.js";
import { realExec, type Exec } from "./exec.js";

export async function scanListeners(exec: Exec = realExec): Promise<ProcessInfo[]> {
  const [lsofOut, psOut] = await Promise.all([
    exec("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-Fpcn"]),
    exec("ps", ["-axo", "pid=,ppid=,comm="]),
  ]);
  const listens = parseLsofListeners(lsofOut);
  const table = parsePsTable(psOut);

  const byPid = new Map<number, Set<number>>();
  for (const l of listens) {
    if (!byPid.has(l.pid)) byPid.set(l.pid, new Set());
    byPid.get(l.pid)!.add(l.port);
  }

  const infos = await Promise.all(
    [...byPid.entries()].map(async ([pid, ports]): Promise<ProcessInfo> => {
      const [cwdOut, cmdOut] = await Promise.all([
        exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]),
        exec("ps", ["-o", "command=", "-p", String(pid)]),
      ]);
      const cwdLine = cwdOut.split("\n").find((l) => l.startsWith("n"));
      const command = cmdOut.trim();
      const comm = table.get(pid)?.comm ?? "?";
      return {
        pid,
        ports: [...ports].sort((a, b) => a - b),
        procName: comm.split("/").pop() ?? "?",
        command,
        cwd: cwdLine ? cwdLine.slice(1) : null,
        inferredProject: inferProjectFromCommand(command),
        source: traceSource(pid, table),
      };
    }),
  );
  return infos.sort((a, b) => (a.ports[0] ?? 0) - (b.ports[0] ?? 0));
}

export function resolveProjectDir(p: Omit<ProcessInfo, "cwd" | "inferredProject"> & { cwd: string | null; inferredProject: string | null }): string | null {
  if (p.cwd && p.cwd !== "/" && !p.cwd.startsWith("/System")) return p.cwd;
  return p.inferredProject ?? p.cwd;
}
```

运行 `pnpm test`，预期全部 PASS。

- [ ] **Step 3: 写 src/render.ts**

```typescript
export const C = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

export function formatTable(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) =>
    Math.max(...all.map((r) => strip(r[i] ?? "").length)),
  );
  const fmt = (r: string[]) =>
    r.map((c, i) => c + " ".repeat(widths[i] - strip(c).length)).join("  ");
  return [fmt(header), ...rows.map(fmt)].join("\n");
}
```

- [ ] **Step 4: 写 list / whois 命令并注册**

`src/commands/list.ts`:

```typescript
import path from "node:path";
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { scanListeners, isNoise, resolveProjectDir } from "../scan.js";
import { formatTable, C } from "../render.js";

export default async function list(flags: Flags): Promise<number> {
  let infos = await scanListeners();
  if (!flags.all) infos = infos.filter((p) => !isNoise(p.procName));
  if (flags.project) {
    const dir = path.resolve(flags.project);
    infos = infos.filter((p) => {
      const proj = resolveProjectDir(p);
      return proj === dir || proj?.startsWith(dir + "/");
    });
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(infos, null, 2) + "\n");
    return EXIT.OK;
  }
  const rows = infos.flatMap((p) =>
    p.ports.map((port) => [
      String(port),
      String(p.pid),
      p.source === "orphan" ? `${C.yellow}orphan${C.reset}` : p.source,
      p.procName,
      resolveProjectDir(p) ?? "?",
    ]),
  );
  process.stdout.write(formatTable(["PORT", "PID", "来源", "进程", "项目目录"], rows) + "\n");
  return EXIT.OK;
}
```

`src/commands/whois.ts`:

```typescript
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { scanListeners, resolveProjectDir } from "../scan.js";

export default async function whois(flags: Flags): Promise<number> {
  const port = Number(flags.positional[0]);
  if (!Number.isFinite(port)) {
    process.stderr.write("用法: portmarshal whois <port>\n");
    return EXIT.ERR;
  }
  const infos = await scanListeners();
  const hit = infos.find((p) => p.ports.includes(port));
  if (!hit) {
    process.stderr.write(`端口 ${port} 当前无监听\n`);
    return EXIT.NOT_FOUND;
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(hit, null, 2) + "\n");
    return EXIT.OK;
  }
  process.stdout.write(
    [
      `端口:     ${port}`,
      `PID:      ${hit.pid}`,
      `来源:     ${hit.source}`,
      `项目目录: ${resolveProjectDir(hit) ?? "?"}`,
      `命令:     ${hit.command}`,
    ].join("\n") + "\n",
  );
  return EXIT.OK;
}
```

在 `src/cli.ts` 的 `COMMANDS` 中注册：

```typescript
const COMMANDS: Record<string, () => Promise<{ default: CommandFn }>> = {
  list: () => import("./commands/list.js"),
  whois: () => import("./commands/whois.js"),
};
```

- [ ] **Step 5: 构建后真机验证**

```bash
pnpm build && node dist/cli.js list && node dist/cli.js list --json | head -20 && node dist/cli.js whois 8000
```

预期：表格含真实 dev server（如 mu_frontend 的 8000，来源 cursor）；whois 显示完整归属。无监听端口 `node dist/cli.js whois 1; echo $?` 输出 exit=2。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: scan assembly with list and whois commands

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Registry（锁 / claim 幂等粘性 / release / gc 核心）

**Files:**
- Create: `src/registry.ts`, `tests/registry.test.ts`

**Interfaces:**
- Consumes: `types.ts` 的 `RegistryEntry`
- Produces:
  - `class Registry { constructor(dir?: string) }`
  - `registry.load(): Promise<RegistryEntry[]>`
  - `registry.claim(opts: { name: string; project: string; prefer?: number; range?: [number, number]; claimedBy?: string; portFree?: (p: number) => Promise<boolean> }): Promise<{ port: number; reused: boolean }>`
  - `registry.release(name: string, project: string): Promise<RegistryEntry | null>`
  - `registry.gcStale(listeningPorts: Set<number>, now?: number): Promise<RegistryEntry[]>`（返回被回收的记录）
  - `registry.markReleasedByPort(port: number): Promise<void>`（stop 后清理用）
  - `isPortFree(port: number): Promise<boolean>`、`class LockTimeoutError`

- [ ] **Step 1: 写失败测试 tests/registry.test.ts**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Registry } from "../src/registry.js";

async function tmpRegistry(): Promise<Registry> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "portmarshal-test-"));
  return new Registry(dir);
}
const alwaysFree = async () => true;

test("claim 分配 prefer 端口并写入注册表", async () => {
  const r = await tmpRegistry();
  const { port, reused } = await r.claim({
    name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree,
  });
  assert.equal(port, 3000);
  assert.equal(reused, false);
  const entries = await r.load();
  assert.equal(entries[0].name, "web");
  assert.equal(entries[0].project, "/proj/a");
});

test("claim 幂等：同 (project,name) 重复 claim 返回原端口", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  const second = await r.claim({ name: "web", project: "/proj/a", prefer: 4000, portFree: alwaysFree });
  assert.equal(second.port, 3000);
  assert.equal(second.reused, true);
});

test("claim 冲突顺延：prefer 被其他项目注册时 +1", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  const b = await r.claim({ name: "web", project: "/proj/b", prefer: 3000, portFree: alwaysFree });
  assert.equal(b.port, 3001);
});

test("claim 跳过实际被占用的端口", async () => {
  const r = await tmpRegistry();
  const busy3000 = async (p: number) => p !== 3000;
  const { port } = await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: busy3000 });
  assert.equal(port, 3001);
});

test("release 后再 claim 粘性复用 lastPort", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  const released = await r.release("web", "/proj/a");
  assert.equal(released?.port, 3000);
  const again = await r.claim({ name: "web", project: "/proj/a", portFree: alwaysFree });
  assert.equal(again.port, 3000); // 未传 prefer，靠 lastPort 粘回
});

test("release 不存在的记录返回 null", async () => {
  const r = await tmpRegistry();
  assert.equal(await r.release("nope", "/proj/a"), null);
});

test("gcStale 回收超过 30 分钟未监听的记录并保留粘性", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  const later = Date.now() + 31 * 60 * 1000;
  const removed = await r.gcStale(new Set(), later);
  assert.equal(removed.length, 1);
  const entries = await r.load();
  assert.equal(entries[0].released, true);
  assert.equal(entries[0].lastPort, 3000);
});

test("gcStale 不回收正在监听的记录", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  const later = Date.now() + 31 * 60 * 1000;
  const removed = await r.gcStale(new Set([3000]), later);
  assert.equal(removed.length, 0);
});

test("注册表损坏时备份重建", async () => {
  const r = await tmpRegistry();
  await fs.mkdir(r.dir, { recursive: true });
  await fs.writeFile(path.join(r.dir, "registry.json"), "{broken");
  const entries = await r.load();
  assert.deepEqual(entries, []);
  const bak = await fs.readFile(path.join(r.dir, "registry.json.bak"), "utf8");
  assert.equal(bak, "{broken");
});

test("markReleasedByPort 把活跃记录转为 released", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  await r.markReleasedByPort(3000);
  const entries = await r.load();
  assert.equal(entries[0].released, true);
  assert.equal(entries[0].lastPort, 3000);
});
```

运行 `pnpm test`，预期 registry.test.ts 全部 FAIL（模块不存在）。

- [ ] **Step 2: 实现 src/registry.ts**

```typescript
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { RegistryEntry } from "./types.js";

export class LockTimeoutError extends Error {
  constructor() { super("注册表锁竞争超时，可稍后重试"); }
}

export async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host: "127.0.0.1" }, () => srv.close(() => resolve(true)));
  });
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export class Registry {
  readonly dir: string;
  readonly file: string;

  constructor(dir = path.join(os.homedir(), ".portmarshal")) {
    this.dir = dir;
    this.file = path.join(dir, "registry.json");
  }

  async load(): Promise<RegistryEntry[]> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as RegistryEntry[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      await fs.rename(this.file, this.file + ".bak").catch(() => {});
      process.stderr.write("portmarshal: 注册表损坏，已备份为 registry.json.bak 并重建\n");
      return [];
    }
  }

  private async save(entries: RegistryEntry[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = this.file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(entries, null, 2) + "\n");
    await fs.rename(tmp, this.file);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockDir = path.join(this.dir, ".lock");
    const pidFile = path.join(lockDir, "pid");
    await fs.mkdir(this.dir, { recursive: true });
    const start = Date.now();
    for (;;) {
      try {
        await fs.mkdir(lockDir);
        await fs.writeFile(pidFile, String(process.pid));
        break;
      } catch {
        if (Date.now() - start > 2000) {
          const holder = Number(await fs.readFile(pidFile, "utf8").catch(() => "0"));
          if (holder && isAlive(holder)) throw new LockTimeoutError();
          await fs.rm(lockDir, { recursive: true, force: true });
          continue;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  }

  async claim(opts: {
    name: string;
    project: string;
    prefer?: number;
    range?: [number, number];
    claimedBy?: string;
    portFree?: (p: number) => Promise<boolean>;
  }): Promise<{ port: number; reused: boolean }> {
    const free = opts.portFree ?? isPortFree;
    return this.withLock(async () => {
      const entries = await this.load();
      const isKey = (e: RegistryEntry) => e.project === opts.project && e.name === opts.name;
      const existing = entries.find(isKey);

      if (existing && !existing.released) {
        return { port: existing.port, reused: true };
      }

      const taken = new Set(entries.filter((e) => !e.released).map((e) => e.port));
      const [lo, hi] = opts.range ?? [3000, 9999];
      const candidates: number[] = [];
      if (existing?.lastPort) candidates.push(existing.lastPort);
      if (opts.prefer) candidates.push(opts.prefer);
      for (let p = opts.prefer ?? lo; p <= hi; p++) candidates.push(p);

      let chosen = -1;
      for (const p of candidates) {
        if (p < lo && p !== existing?.lastPort && p !== opts.prefer) continue;
        if (taken.has(p)) continue;
        if (await free(p)) { chosen = p; break; }
      }
      if (chosen < 0) throw new Error(`范围 ${lo}-${hi} 内无可用端口`);

      const entry: RegistryEntry = {
        name: opts.name,
        project: opts.project,
        port: chosen,
        claimedAt: new Date().toISOString(),
        claimedBy: opts.claimedBy,
      };
      await this.save([...entries.filter((e) => !isKey(e)), entry]);
      return { port: chosen, reused: false };
    });
  }

  async release(name: string, project: string): Promise<RegistryEntry | null> {
    return this.withLock(async () => {
      const entries = await this.load();
      const idx = entries.findIndex((e) => e.project === project && e.name === name && !e.released);
      if (idx < 0) return null;
      const e = entries[idx];
      entries[idx] = { ...e, released: true, lastPort: e.port };
      await this.save(entries);
      return e;
    });
  }

  async markReleasedByPort(port: number): Promise<void> {
    await this.withLock(async () => {
      const entries = await this.load();
      let changed = false;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.released && e.port === port) {
          entries[i] = { ...e, released: true, lastPort: e.port };
          changed = true;
        }
      }
      if (changed) await this.save(entries);
    });
  }

  /** 回收「已注册未监听且超过 30 分钟」的记录（转 released 保粘性），返回被回收项 */
  async gcStale(listeningPorts: Set<number>, now = Date.now()): Promise<RegistryEntry[]> {
    return this.withLock(async () => {
      const entries = await this.load();
      const removed: RegistryEntry[] = [];
      const next = entries.map((e) => {
        if (e.released) return e;
        const listening = listeningPorts.has(e.port);
        const age = now - Date.parse(e.claimedAt);
        if (!listening && age > 30 * 60 * 1000) {
          removed.push(e);
          return { ...e, released: true, lastPort: e.port };
        }
        return e;
      });
      if (removed.length) await this.save(next);
      return removed;
    });
  }
}
```

- [ ] **Step 3: 运行确认通过并提交**

```bash
pnpm test 2>&1 | tail -5
```

预期：registry 10 个测试全部 PASS。

```bash
git add -A && git commit -m "feat: registry with locking, idempotent sticky claim, release, gc

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: merge 四状态（漂移检测）+ claim / release 命令接线

**Files:**
- Create: `src/merge.ts`, `src/commands/claim.ts`, `src/commands/release.ts`, `tests/merge.test.ts`
- Modify: `src/commands/list.ts`（接入 merge 显示状态列）, `src/cli.ts`（注册 claim/release）

**Interfaces:**
- Consumes: `scanListeners` / `Registry` / `resolveProjectDir`
- Produces: `mergeScanRegistry(scan: ProcessInfo[], registry: RegistryEntry[]): MergedEntry[]`

- [ ] **Step 1: 写失败测试 tests/merge.test.ts**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeScanRegistry } from "../src/merge.js";
import type { ProcessInfo, RegistryEntry } from "../src/types.js";

function proc(pid: number, ports: number[], cwd: string): ProcessInfo {
  return { pid, ports, procName: "node", command: "", cwd, inferredProject: null, source: "terminal" };
}
function reg(name: string, project: string, port: number): RegistryEntry {
  return { name, project, port, claimedAt: new Date().toISOString() };
}

test("active：已注册且在监听", () => {
  const out = mergeScanRegistry([proc(1, [3000], "/p/a")], [reg("web", "/p/a", 3000)]);
  assert.equal(out[0].state, "active");
});

test("reserved：已注册未监听", () => {
  const out = mergeScanRegistry([], [reg("web", "/p/a", 3000)]);
  assert.deepEqual(out.map((e) => [e.port, e.state]), [[3000, "reserved"]]);
});

test("unregistered：在监听未注册", () => {
  const out = mergeScanRegistry([proc(1, [8080], "/p/a")], []);
  assert.equal(out[0].state, "unregistered");
});

test("drift：同项目注册 3000 未监听 + 监听 3001 未注册", () => {
  const out = mergeScanRegistry([proc(1, [3001], "/p/a")], [reg("web", "/p/a", 3000)]);
  const drift3000 = out.find((e) => e.port === 3000)!;
  const drift3001 = out.find((e) => e.port === 3001)!;
  assert.equal(drift3000.state, "drift");
  assert.equal(drift3000.driftPeer, 3001);
  assert.equal(drift3001.state, "drift");
  assert.equal(drift3001.driftPeer, 3000);
});

test("released 记录不参与合并", () => {
  const released: RegistryEntry = { ...reg("web", "/p/a", 3000), released: true, lastPort: 3000 };
  const out = mergeScanRegistry([], [released]);
  assert.equal(out.length, 0);
});
```

运行 `pnpm test`，预期 merge 测试 FAIL。

- [ ] **Step 2: 实现 src/merge.ts**

```typescript
import type { MergedEntry, ProcessInfo, RegistryEntry } from "./types.js";
import { resolveProjectDir } from "./scan.js";

export function mergeScanRegistry(
  scan: ProcessInfo[],
  registry: RegistryEntry[],
): MergedEntry[] {
  const active = registry.filter((r) => !r.released);
  const regByPort = new Map(active.map((r) => [r.port, r]));
  const listening = new Set(scan.flatMap((p) => p.ports));
  const out: MergedEntry[] = [];

  for (const proc of scan) {
    for (const port of proc.ports) {
      const reg = regByPort.get(port);
      out.push({ port, state: reg ? "active" : "unregistered", proc, reg });
    }
  }
  for (const reg of active) {
    if (!listening.has(reg.port)) out.push({ port: reg.port, state: "reserved", reg });
  }

  for (const r of out) {
    if (r.state !== "reserved") continue;
    const peer = out.find(
      (e) => e.state === "unregistered" && e.proc && resolveProjectDir(e.proc) === r.reg!.project,
    );
    if (peer) {
      r.state = "drift";
      r.driftPeer = peer.port;
      peer.state = "drift";
      peer.driftPeer = r.port;
    }
  }
  return out.sort((a, b) => a.port - b.port);
}
```

运行 `pnpm test`，预期全部 PASS。

- [ ] **Step 3: 写 claim / release 命令**

`src/commands/claim.ts`:

```typescript
import path from "node:path";
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { Registry, LockTimeoutError } from "../registry.js";

export default async function claim(flags: Flags): Promise<number> {
  const name = flags.positional[0];
  if (!name) {
    process.stderr.write("用法: portmarshal claim <name> [--prefer N] [--range A-B]\n");
    return EXIT.ERR;
  }
  const project = path.resolve(flags.project ?? process.cwd());
  const registry = new Registry();
  try {
    const { port, reused } = await registry.claim({
      name, project,
      prefer: flags.prefer,
      range: flags.range,
      claimedBy: process.env.CLAUDECODE ? "claude-code" : (process.env.TERM_PROGRAM ?? "cli"),
    });
    if (flags.json) {
      process.stdout.write(JSON.stringify({ name, project, port, reused }) + "\n");
    } else {
      process.stdout.write(String(port) + "\n"); // stdout 仅端口号，供 PORT=$(...) 使用
      process.stderr.write(
        reused
          ? `复用已有预留 ${name}@${project} → ${port}\n`
          : `已预留 ${name}@${project} → ${port}\n`,
      );
    }
    return EXIT.OK;
  } catch (e) {
    if (e instanceof LockTimeoutError) {
      process.stderr.write(`portmarshal: ${e.message}\n`);
      return EXIT.LOCK_TIMEOUT;
    }
    throw e;
  }
}
```

`src/commands/release.ts`:

```typescript
import path from "node:path";
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { Registry } from "../registry.js";
import { isPortFree } from "../registry.js";

export default async function release(flags: Flags): Promise<number> {
  const name = flags.positional[0];
  if (!name) {
    process.stderr.write("用法: portmarshal release <name>\n");
    return EXIT.ERR;
  }
  const project = path.resolve(flags.project ?? process.cwd());
  const registry = new Registry();
  const entry = await registry.release(name, project);
  if (!entry) {
    process.stderr.write(`未找到预留记录 ${name}@${project}\n`);
    return EXIT.NOT_FOUND;
  }
  process.stderr.write(`已释放预留 ${name} → ${entry.port}\n`);
  if (!(await isPortFree(entry.port))) {
    process.stderr.write(`注意：端口 ${entry.port} 上服务仍在运行，release 仅释放预留记录；停止服务请用 portmarshal stop ${entry.port}\n`);
  }
  return EXIT.OK;
}
```

- [ ] **Step 4: list 接入状态列**

修改 `src/commands/list.ts`，将扫描结果与注册表合并后渲染（完整替换文件）：

```typescript
import path from "node:path";
import type { Flags } from "../cli.js";
import { EXIT, type MergedEntry } from "../types.js";
import { scanListeners, isNoise, resolveProjectDir } from "../scan.js";
import { mergeScanRegistry } from "../merge.js";
import { Registry } from "../registry.js";
import { formatTable, C } from "../render.js";

const STATE_LABEL: Record<string, string> = {
  active: `${C.green}●${C.reset} 正常`,
  reserved: `${C.dim}◐ 预留${C.reset}`,
  unregistered: "○ 未注册",
  drift: `${C.yellow}⚠ 漂移${C.reset}`,
};

export default async function list(flags: Flags): Promise<number> {
  const [scan, registry] = await Promise.all([
    scanListeners(),
    new Registry().load(),
  ]);
  const filtered = flags.all ? scan : scan.filter((p) => !isNoise(p.procName));
  let merged = mergeScanRegistry(filtered, registry);
  if (flags.project) {
    const dir = path.resolve(flags.project);
    merged = merged.filter((e) => {
      const proj = e.proc ? resolveProjectDir(e.proc) : e.reg?.project;
      return proj === dir || proj?.startsWith(dir + "/");
    });
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(merged, null, 2) + "\n");
    return EXIT.OK;
  }
  const rows = merged.map((e: MergedEntry) => [
    String(e.port),
    STATE_LABEL[e.state],
    e.proc ? String(e.proc.pid) : "-",
    e.proc
      ? (e.proc.source === "orphan" ? `${C.yellow}orphan${C.reset}` : e.proc.source)
      : "-",
    e.reg?.name ?? "-",
    (e.proc ? resolveProjectDir(e.proc) : e.reg?.project) ?? "?",
    e.state === "drift" ? `↔ ${e.driftPeer}` : "",
  ]);
  process.stdout.write(
    formatTable(["PORT", "状态", "PID", "来源", "预留名", "项目目录", ""], rows) + "\n",
  );
  return EXIT.OK;
}
```

在 `src/cli.ts` 注册：

```typescript
  claim: () => import("./commands/claim.js"),
  release: () => import("./commands/release.js"),
```

- [ ] **Step 5: 构建 + 真机验证 claim 生命周期**

```bash
pnpm build
P=$(node dist/cli.js claim demo --prefer 4567); echo "claimed=$P"
P2=$(node dist/cli.js claim demo); echo "idempotent=$P2"   # 应等于 4567
node dist/cli.js list | grep 4567                           # 应显示 ◐ 预留
node dist/cli.js release demo
node dist/cli.js list --json | grep -c 4567 || echo "released ok"
```

预期：两次 claim 同端口；预留状态可见；release 后消失。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: merge engine with drift detection, claim/release commands

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: stop 三级护栏 + gc 命令

**Files:**
- Create: `src/commands/stop.ts`, `src/commands/gc.ts`, `tests/stop.test.ts`
- Modify: `src/scan.ts`（追加 `classifyTarget` 与 `terminate`）, `src/cli.ts`（注册 stop/gc）

**Interfaces:**
- Consumes: `scanListeners` / `Registry.markReleasedByPort` / `Registry.gcStale`
- Produces: `classifyTarget(proc: ProcessInfo, callerCwd: string, registry: RegistryEntry[]): "orphan" | "own" | "foreign"`；`terminate(pid: number, waitMs?: number, kill?: (pid: number, sig: string) => void, alive?: (pid: number) => boolean): Promise<"term" | "kill" | "gone">`

- [ ] **Step 1: 写失败测试 tests/stop.test.ts**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTarget, terminate } from "../src/scan.js";
import type { ProcessInfo, RegistryEntry } from "../src/types.js";

function proc(over: Partial<ProcessInfo>): ProcessInfo {
  return {
    pid: 100, ports: [3000], procName: "node", command: "",
    cwd: "/p/other", inferredProject: null, source: "cursor", ...over,
  };
}

test("classifyTarget: 孤儿 → orphan", () => {
  assert.equal(classifyTarget(proc({ source: "orphan" }), "/p/me", []), "orphan");
});

test("classifyTarget: cwd 同项目 → own", () => {
  assert.equal(classifyTarget(proc({ cwd: "/p/me" }), "/p/me", []), "own");
  assert.equal(classifyTarget(proc({ cwd: "/p/me/sub" }), "/p/me", []), "own");
});

test("classifyTarget: 注册记录属于调用方项目 → own", () => {
  const reg: RegistryEntry[] = [{ name: "web", project: "/p/me", port: 3000, claimedAt: new Date().toISOString() }];
  assert.equal(classifyTarget(proc({ cwd: "/elsewhere" }), "/p/me", reg), "own");
});

test("classifyTarget: 他人活跃服务 → foreign", () => {
  assert.equal(classifyTarget(proc({}), "/p/me", []), "foreign");
});

test("terminate: SIGTERM 即退 → term", async () => {
  let sent: string[] = [];
  let aliveCalls = 0;
  const result = await terminate(
    42, 500,
    (_pid, sig) => { sent.push(sig); },
    () => { aliveCalls++; return aliveCalls < 2; },
  );
  assert.equal(result, "term");
  assert.deepEqual(sent, ["SIGTERM"]);
});

test("terminate: 超时后 SIGKILL → kill", async () => {
  const sent: string[] = [];
  const result = await terminate(
    42, 200,
    (_pid, sig) => { sent.push(sig); },
    () => true,
  );
  assert.equal(result, "kill");
  assert.deepEqual(sent, ["SIGTERM", "SIGKILL"]);
});
```

运行 `pnpm test`，预期 FAIL。

- [ ] **Step 2: 在 src/scan.ts 追加实现**

```typescript
import type { RegistryEntry } from "./types.js";

export function classifyTarget(
  proc: ProcessInfo,
  callerCwd: string,
  registry: RegistryEntry[],
): "orphan" | "own" | "foreign" {
  if (proc.source === "orphan") return "orphan";
  const proj = resolveProjectDir(proc);
  if (proj && (proj === callerCwd || proj.startsWith(callerCwd + "/") || callerCwd.startsWith(proj + "/"))) {
    return "own";
  }
  const reg = registry.find((r) => !r.released && proc.ports.includes(r.port));
  if (reg && reg.project === callerCwd) return "own";
  return "foreign";
}

export async function terminate(
  pid: number,
  waitMs = 3000,
  kill: (pid: number, sig: NodeJS.Signals) => void = (p, s) => process.kill(p, s),
  alive: (pid: number) => boolean = (p) => { try { process.kill(p, 0); return true; } catch { return false; } },
): Promise<"term" | "kill" | "gone"> {
  try { kill(pid, "SIGTERM"); } catch { return "gone"; }
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    await new Promise((r) => setTimeout(r, 100));
    if (!alive(pid)) return "term";
  }
  try { kill(pid, "SIGKILL"); } catch {}
  return "kill";
}
```

运行 `pnpm test`，预期全部 PASS。

- [ ] **Step 3: 写 src/commands/stop.ts**

```typescript
import path from "node:path";
import { execFile } from "node:child_process";
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { scanListeners, classifyTarget, terminate, resolveProjectDir } from "../scan.js";
import { Registry } from "../registry.js";

function osascript(script: string): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    execFile("osascript", ["-e", script], (err) => resolve({ ok: !err }));
  });
}

function notify(msg: string): void {
  void osascript(`display notification ${JSON.stringify(msg)} with title "portmarshal"`);
}

export default async function stop(flags: Flags): Promise<number> {
  const target = flags.positional[0];
  if (!target) {
    process.stderr.write("用法: portmarshal stop <port|name> [--force|--gui]\n");
    return EXIT.ERR;
  }
  const registry = new Registry();
  const entries = await registry.load();
  const callerCwd = path.resolve(flags.project ?? process.cwd());

  let port = Number(target);
  if (!Number.isFinite(port)) {
    const reg = entries.find((e) => !e.released && e.name === target && e.project === callerCwd);
    if (!reg) {
      process.stderr.write(`未找到预留记录 ${target}@${callerCwd}\n`);
      return EXIT.NOT_FOUND;
    }
    port = reg.port;
  }

  const scan = await scanListeners();
  const proc = scan.find((p) => p.ports.includes(port));
  if (!proc) {
    process.stderr.write(`端口 ${port} 当前无监听\n`);
    if (flags.gui) notify(`端口 ${port} 当前无监听`);
    return EXIT.NOT_FOUND;
  }

  const kind = classifyTarget(proc, callerCwd, entries);
  const desc = `${port}（${proc.source} · ${resolveProjectDir(proc) ?? "?"} · pid ${proc.pid}）`;

  if (kind === "foreign" && !flags.force) {
    if (flags.gui) {
      const { ok } = await osascript(
        `display dialog "端口 ${port} 是 ${proc.source} 在 ${resolveProjectDir(proc) ?? "?"} 的活跃服务，确定停止？" with title "portmarshal" buttons {"取消","停止"} default button "取消" cancel button "取消" with icon caution`,
      );
      if (!ok) return EXIT.OK; // 用户取消
    } else {
      const info = { port, pid: proc.pid, source: proc.source, project: resolveProjectDir(proc), command: proc.command };
      if (flags.json) {
        process.stdout.write(JSON.stringify({ blocked: true, ...info }) + "\n");
      } else {
        process.stderr.write(`已拦截：${desc} 是他人的活跃服务\n  命令: ${proc.command}\n  确认要停止请加 --force\n`);
      }
      return EXIT.BLOCKED;
    }
  }

  const how = await terminate(proc.pid);
  await registry.markReleasedByPort(port);
  const msg = how === "gone" ? `进程已不存在，已清理注册记录` : `已停止 ${desc}${how === "kill" ? "（SIGKILL）" : ""}`;
  if (flags.json) {
    process.stdout.write(JSON.stringify({ stopped: true, port, pid: proc.pid, how }) + "\n");
  } else {
    process.stderr.write(msg + "\n");
  }
  if (flags.gui) notify(msg);
  return EXIT.OK;
}
```

- [ ] **Step 4: 写 src/commands/gc.ts**

```typescript
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { scanListeners, isNoise, terminate, resolveProjectDir } from "../scan.js";
import { Registry } from "../registry.js";
import { C } from "../render.js";

export default async function gc(flags: Flags): Promise<number> {
  const registry = new Registry();
  const scan = await scanListeners();
  const listening = new Set(scan.flatMap((p) => p.ports));

  const removed = await registry.gcStale(listening);
  for (const e of removed) {
    process.stderr.write(`已回收过期预留 ${e.name}@${e.project} → ${e.port}\n`);
  }

  const orphans = scan.filter((p) => p.source === "orphan" && !isNoise(p.procName));
  if (orphans.length === 0) {
    process.stderr.write("没有发现孤儿服务\n");
    return EXIT.OK;
  }
  for (const p of orphans) {
    const desc = `${p.ports.join(",")} · pid ${p.pid} · ${resolveProjectDir(p) ?? "?"} · ${p.command.slice(0, 60)}`;
    if (flags.killOrphans) {
      const how = await terminate(p.pid);
      for (const port of p.ports) await registry.markReleasedByPort(port);
      process.stderr.write(`${C.yellow}已停止孤儿${C.reset} ${desc}（${how}）\n`);
    } else {
      process.stderr.write(`${C.yellow}孤儿服务${C.reset} ${desc}\n`);
    }
  }
  if (!flags.killOrphans) {
    process.stderr.write(`\n共 ${orphans.length} 个孤儿服务；停止它们请运行 portmarshal gc --kill-orphans\n`);
  }
  return EXIT.OK;
}
```

在 `src/cli.ts` 注册：

```typescript
  stop: () => import("./commands/stop.js"),
  gc: () => import("./commands/gc.js"),
```

- [ ] **Step 5: 构建 + 真机验证护栏**

```bash
pnpm build
python3 -m http.server 4568 --directory /tmp & sleep 1
node dist/cli.js stop 4568; echo "exit=$?"        # 本终端起的：own → 直接停，exit=0
python3 -m http.server 4568 --directory /tmp & sleep 1
cd /tmp && node /Users/worsher/code/github/portmarshal/dist/cli.js stop 4568 --project /nowhere; echo "exit=$?"
# 期待：cwd 归属为当前脚本会话（own/foreign 视执行环境），验证 exit=3 时打印归属信息
node /Users/worsher/code/github/portmarshal/dist/cli.js stop 4568 --force   # 强制停止收尾
node /Users/worsher/code/github/portmarshal/dist/cli.js gc
```

预期：own 目标直接停；foreign 目标 exit=3 且打印归属与 --force 提示；gc 列出孤儿（如 8901）。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: guarded stop with three-tier rules, gc command

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: watch TUI + menubar（SwiftBar 插件）

**Files:**
- Create: `src/commands/watch.ts`, `src/commands/menubar.ts`, `tests/menubar.test.ts`
- Modify: `src/render.ts`（追加 `formatWatchFrame`）, `src/cli.ts`（注册 watch/menubar）

**Interfaces:**
- Consumes: `scanListeners` / `mergeScanRegistry` / `formatTable`
- Produces: `renderMenubar(entries: MergedEntry[], binPath: string): string`；`formatWatchFrame(cur: MergedEntry[], prevPorts: Set<number>): string`

- [ ] **Step 1: 写失败测试 tests/menubar.test.ts**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMenubar } from "../src/commands/menubar.js";
import type { MergedEntry, ProcessInfo } from "../src/types.js";

function entry(port: number, state: MergedEntry["state"], source = "cursor", cwd = "/p/a"): MergedEntry {
  const proc: ProcessInfo = {
    pid: 1, ports: [port], procName: "node", command: "node dev",
    cwd, inferredProject: null, source,
  };
  return { port, state, proc };
}

test("renderMenubar 标题含服务数与异常数", () => {
  const out = renderMenubar([entry(3000, "active"), entry(8901, "unregistered", "orphan")], "/bin/portmarshal");
  const title = out.split("\n")[0];
  assert.match(title, /2/);
  assert.match(title, /⚠\s*1/);
});

test("renderMenubar 服务行带子菜单动作，stop 挂 --gui", () => {
  const out = renderMenubar([entry(3000, "active")], "/bin/portmarshal");
  assert.match(out, /-- 停止服务.*bash="\/bin\/portmarshal".*param1=stop.*param2=3000.*param3=--gui.*terminal=false.*refresh=true/);
  assert.match(out, /-- 复制 http:\/\/localhost:3000/);
});

test("renderMenubar 孤儿行标橙色", () => {
  const out = renderMenubar([entry(8901, "unregistered", "orphan")], "/bin/portmarshal");
  const line = out.split("\n").find((l) => l.includes("8901") && !l.startsWith("--"))!;
  assert.match(line, /color=orange/);
});

test("renderMenubar 无服务时显示空态", () => {
  const out = renderMenubar([], "/bin/portmarshal");
  assert.match(out, /没有监听中的开发服务/);
});
```

运行 `pnpm test`，预期 FAIL。

- [ ] **Step 2: 实现 src/commands/menubar.ts**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Flags } from "../cli.js";
import { EXIT, type MergedEntry } from "../types.js";
import { scanListeners, isNoise, resolveProjectDir } from "../scan.js";
import { mergeScanRegistry } from "../merge.js";
import { Registry } from "../registry.js";

export function renderMenubar(entries: MergedEntry[], binPath: string): string {
  const bad = entries.filter((e) => e.state === "drift" || e.proc?.source === "orphan").length;
  const lines: string[] = [];
  lines.push(bad > 0 ? `⚓${entries.length} ⚠${bad} | color=orange` : `⚓${entries.length}`);
  lines.push("---");
  if (entries.length === 0) {
    lines.push("没有监听中的开发服务 | color=gray");
  }
  for (const e of entries) {
    const proj = e.proc ? resolveProjectDir(e.proc) : e.reg?.project;
    const projName = proj ? path.basename(proj) : "?";
    const src = e.proc?.source ?? "预留";
    const isOrphan = e.proc?.source === "orphan";
    const mark = e.state === "drift" ? "⚠ " : isOrphan ? "⚠ " : "";
    const suffix = isOrphan || e.state === "drift" ? " | color=orange" : "";
    const label = isOrphan ? "孤儿服务" : src;
    lines.push(`${mark}${e.port} ${projName} · ${label}${suffix}`);
    const stopLabel = e.proc && !isOrphan && e.state !== "drift" ? `停止服务…（${src} 正在使用）` : "停止服务";
    if (e.proc) {
      lines.push(`-- ${stopLabel} | bash="${binPath}" param1=stop param2=${e.port} param3=--gui terminal=false refresh=true`);
      lines.push(`-- 复制 http://localhost:${e.port} | bash=/bin/bash param1=-c param2="echo -n 'http://localhost:${e.port}' | pbcopy" terminal=false`);
    }
    if (proj) {
      lines.push(`-- 在 Finder 中打开项目目录 | bash=/usr/bin/open param1="${proj}" terminal=false`);
    }
  }
  lines.push("---");
  lines.push(`清理全部孤儿 (gc) | bash="${binPath}" param1=gc param2=--kill-orphans terminal=false refresh=true`);
  lines.push("刷新 | refresh=true");
  return lines.join("\n") + "\n";
}

async function swiftBarPluginDir(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("defaults", ["read", "com.ameba.SwiftBar", "PluginDirectory"], (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

async function install(binPath: string): Promise<number> {
  const dir = await swiftBarPluginDir();
  if (!dir) {
    process.stderr.write(
      "未检测到 SwiftBar 配置。请先安装：brew install swiftbar 并启动一次；\n或手动把以下脚本放入插件目录（命名 portmarshal.5s.sh）：\n\n#!/bin/bash\nexec \"" + binPath + "\" menubar\n",
    );
    return EXIT.ERR;
  }
  const plugin = path.join(dir, "portmarshal.5s.sh");
  await fs.writeFile(plugin, `#!/bin/bash\nexec "${binPath}" menubar\n`, { mode: 0o755 });
  process.stderr.write(`已安装 SwiftBar 插件：${plugin}\n`);
  return EXIT.OK;
}

export default async function menubar(flags: Flags): Promise<number> {
  const binPath = process.argv[1] ? await fs.realpath(process.argv[1]) : fileURLToPath(import.meta.url);
  if (flags.install) return install(binPath);
  const [scan, registry] = await Promise.all([scanListeners(), new Registry().load()]);
  const filtered = scan.filter((p) => !isNoise(p.procName));
  const merged = mergeScanRegistry(filtered, registry);
  process.stdout.write(renderMenubar(merged, binPath));
  return EXIT.OK;
}
```

运行 `pnpm test`，预期全部 PASS。

- [ ] **Step 3: 实现 watch（render 追加 + 命令）**

`src/render.ts` 追加：

```typescript
import type { MergedEntry } from "./types.js";
import { resolveProjectDir } from "./scan.js";

const WATCH_STATE: Record<string, string> = {
  active: `${C.green}●${C.reset}`,
  reserved: "◐",
  unregistered: "○",
  drift: `${C.yellow}⚠${C.reset}`,
};

export function formatWatchFrame(cur: MergedEntry[], prevPorts: Set<number>): string {
  const rows = cur.map((e) => {
    const isNew = !prevPorts.has(e.port);
    const proj = e.proc ? resolveProjectDir(e.proc) : e.reg?.project;
    const color = isNew ? C.green : e.proc?.source === "orphan" || e.state === "drift" ? C.yellow : "";
    const end = color ? C.reset : "";
    return [
      `${color}${e.port}${end}`,
      WATCH_STATE[e.state],
      e.proc?.source ?? "-",
      e.reg?.name ?? "-",
      `${color}${proj ?? "?"}${end}`,
    ];
  });
  const now = new Date().toLocaleTimeString("zh-CN");
  return (
    `portmarshal watch  ${C.dim}${now}  按 q 退出${C.reset}\n\n` +
    formatTable(["PORT", "状态", "来源", "预留名", "项目目录"], rows) +
    "\n"
  );
}
```

`src/commands/watch.ts`:

```typescript
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { scanListeners, isNoise } from "../scan.js";
import { mergeScanRegistry } from "../merge.js";
import { Registry } from "../registry.js";
import { formatWatchFrame } from "../render.js";

export default async function watch(_flags: Flags): Promise<number> {
  let prevPorts = new Set<number>();
  let running = true;

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (buf) => {
      const key = buf.toString();
      if (key === "q" || key === "\x03") running = false; // q 或 Ctrl-C
    });
  }

  while (running) {
    const [scan, registry] = await Promise.all([scanListeners(), new Registry().load()]);
    const merged = mergeScanRegistry(scan.filter((p) => !isNoise(p.procName)), registry);
    process.stdout.write("\x1b[2J\x1b[H" + formatWatchFrame(merged, prevPorts));
    prevPorts = new Set(merged.map((e) => e.port));
    for (let i = 0; i < 20 && running; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  return EXIT.OK;
}
```

在 `src/cli.ts` 注册：

```typescript
  watch: () => import("./commands/watch.js"),
  menubar: () => import("./commands/menubar.js"),
```

- [ ] **Step 4: 构建 + 真机验证**

```bash
pnpm build
node dist/cli.js menubar | head -20     # 检查协议输出：标题/---/服务行/动作行
```

预期：SwiftBar 协议文本，8000 等真实服务在列。watch 需人工验证：另开终端跑 `node dist/cli.js watch`，确认 2 秒刷新、q 退出（此步骤由执行者目测，无法自动断言）。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: watch TUI and SwiftBar menubar renderer with install

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 端到端冒烟 + 文档 + 安装接入

**Files:**
- Create: `tests/smoke.test.ts`
- Modify: `README.md`（完整使用文档）, `~/.claude/CLAUDE.md`（追加 agent 约定，需先阅读现有内容再追加）

**Interfaces:**
- Consumes: 全部命令（经 `node dist/cli.js` 子进程调用）

- [ ] **Step 1: 写 tests/smoke.test.ts（真实端到端）**

```typescript
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const CLI = path.resolve("dist/cli.js");
const PORT = 18923;
let server: ChildProcess;
let projDir: string;

function waitListening(port: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOnce = () => {
      const sock = net.connect({ port, host: "127.0.0.1" }, () => { sock.destroy(); resolve(); });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("timeout waiting for port"));
        else setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

async function cli(args: string[]): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await execFileP("node", [CLI, ...args]);
    return { stdout, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; code?: number };
    return { stdout: err.stdout ?? "", code: err.code ?? 1 };
  }
}

before(async () => {
  projDir = await fs.mkdtemp(path.join(os.tmpdir(), "portmarshal-smoke-"));
  server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: projDir, stdio: "ignore" });
  await waitListening(PORT);
});

after(() => { server.kill("SIGKILL"); });

test("list --all --json 能归属到正确 cwd", async () => {
  const { stdout } = await cli(["list", "--all", "--json"]);
  const entries = JSON.parse(stdout) as Array<{ port: number; proc?: { cwd: string } }>;
  const hit = entries.find((e) => e.port === PORT);
  assert.ok(hit, `端口 ${PORT} 应在扫描结果中`);
  assert.equal(await fs.realpath(hit!.proc!.cwd), await fs.realpath(projDir));
});

test("whois 未监听端口 exit=2", async () => {
  const { code } = await cli(["whois", "1"]);
  assert.equal(code, 2);
});

test("claim 幂等返回同一端口且端口真实空闲", async () => {
  const { stdout: p1 } = await cli(["claim", "smoke-web", "--project", projDir, "--prefer", "18930"]);
  const { stdout: p2 } = await cli(["claim", "smoke-web", "--project", projDir]);
  assert.equal(p1.trim(), p2.trim());
  const free = await new Promise<boolean>((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port: Number(p1), host: "127.0.0.1" }, () => srv.close(() => resolve(true)));
  });
  assert.equal(free, true);
  await cli(["release", "smoke-web", "--project", projDir]);
});

test("stop --force 能停止服务并且端口释放", async () => {
  const { code } = await cli(["stop", String(PORT), "--force"]);
  assert.equal(code, 0);
  await new Promise((r) => setTimeout(r, 500));
  const { code: whoisCode } = await cli(["whois", String(PORT)]);
  assert.equal(whoisCode, 2);
});
```

- [ ] **Step 2: 运行冒烟**

```bash
pnpm smoke 2>&1 | tail -8
```

预期：4 个测试 PASS（注意：本测试使用真实注册表 `~/.portmarshal`，claim 用例已自行 release 清理）。

- [ ] **Step 3: 完善 README.md**

用以下内容替换 README（安装、8 命令示例、退出码表、agent 接入、SwiftBar 接入）：

```markdown
# portmarshal

本机端口服务的侦察与调度工具，为多 AI agent 并行开发场景设计：回答「哪个端口被谁占、属于哪个项目」，提供带护栏的端口预留与服务停止能力，防止 agent 之间端口冲突与互相误杀。

## 安装

```bash
pnpm install && pnpm build && pnpm link --global
portmarshal --help
```

菜单栏（可选）：`brew install swiftbar`，启动 SwiftBar 后运行 `portmarshal menubar --install`。

## 命令

| 命令 | 说明 |
|---|---|
| `portmarshal list [--json] [--all] [--project .]` | 扫描监听端口 → 项目/来源/状态（●正常 ◐预留 ○未注册 ⚠漂移） |
| `portmarshal whois <port>` | 单端口归属详情 |
| `portmarshal claim <name> [--prefer N] [--range A-B]` | 预留端口（幂等 + 粘性），stdout 仅输出端口号 |
| `portmarshal release <name>` | 释放预留（不停进程） |
| `portmarshal stop <port\|name> [--force\|--gui]` | 带护栏停止：孤儿/自己的直接停，他人活跃服务拦截 |
| `portmarshal gc [--kill-orphans]` | 回收过期预留，列出/停止孤儿服务 |
| `portmarshal watch` | 终端实时仪表盘 |
| `portmarshal menubar [--install]` | SwiftBar 菜单栏插件 |

## 退出码

`0` 成功 · `1` 一般错误 · `2` 未找到 · `3` 被安全规则拦截（stop 他人活跃服务，需 --force）· `4` 锁竞争超时（可重试）

## agent 接入（CLAUDE.md 约定）

```
- 启动任何 dev server 前，先 `PORT=$(portmarshal claim <服务名> --prefer <默认端口>)` 获取端口
- 找服务/怀疑冲突时，用 `portmarshal list --project . --json` 看本项目、`portmarshal whois <端口>` 查归属
- 端口被占需要处置时用 `portmarshal stop <端口>`；退出码 3 表示是别人的活跃服务，向用户展示归属并请示，不要 --force
```

## 设计文档

见 [docs/specs/2026-07-16-portmarshal-design.md](docs/specs/2026-07-16-portmarshal-design.md)。macOS · Node ≥ 18 · 零运行时依赖。
```

- [ ] **Step 4: 全局 CLAUDE.md 追加约定**

先读取 `~/.claude/CLAUDE.md` 现有内容（若不存在则创建），在末尾追加：

```markdown

## 端口管理（portmarshal）
- 启动任何 dev server 前，先 `PORT=$(portmarshal claim <服务名> --prefer <默认端口>)` 获取端口
- 找服务/怀疑冲突时，用 `portmarshal list --project . --json` 看本项目、`portmarshal whois <端口>` 查归属
- 端口被占需要处置时用 `portmarshal stop <端口>`；退出码 3 表示是别人的活跃服务，向用户展示归属并请示，不要 --force
```

- [ ] **Step 5: 全局安装验证**

```bash
pnpm link --global && which portmarshal && portmarshal list | head -5
```

预期：全局命令可用，输出真实端口表。

- [ ] **Step 6: 最终验证与提交推送**

```bash
pnpm build && pnpm test && pnpm smoke
git add -A && git commit -m "feat: e2e smoke tests, docs, global install and agent integration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

预期：build/test/smoke 全绿，推送成功。

---

## Self-Review 记录

- **Spec 覆盖**：8 命令（T3 list/whois、T5 claim/release、T6 stop/gc、T7 watch/menubar）；幂等/粘性（T4）；漂移（T5）；三级护栏与退出码 3（T6）；--gui osascript（T6）；--install（T7）；噪音过滤（T2）；--project（T3/T5）；锁与退出码 4（T4/T5）；注册表损坏备份（T4）；cwd 失真兜底 inferProjectFromCommand（T2/T3）；agent 约定（T8）✓
- **无占位符**：所有步骤含完整代码与命令 ✓
- **类型一致性**：`MergedEntry.port` 为必填 number（reserved 侧也有注册端口）；`classifyTarget`/`terminate` 在 scan.ts，stop/gc 消费；`markReleasedByPort`/`gcStale` 签名前后一致 ✓
