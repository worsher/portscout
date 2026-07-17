import type { ListenEntry, ProcessInfo, PsRow, RegistryEntry } from "./types.js";
import { realExec, type Exec } from "./exec.js";

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
  [/iterm|^terminal$|warp|kitty|alacritty|wezterm|tmux/i, "terminal"],
  [/docker/i, "docker"],
];

/** launchctl list 输出（PID\tStatus\tLabel）→ 受 launchd 管理的运行中服务 pid→label 映射 */
export function parseLaunchctlList(text: string): Map<number, string> {
  const services = new Map<number, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)[\t ]+\S+[\t ]+(\S+)/.exec(line);
    if (m) services.set(Number(m[1]), m[2]);
  }
  return services;
}

export function traceSource(pid: number, table: Map<number, PsRow>, launchdServices?: Map<number, string>): string {
  let cur = table.get(pid);
  if (!cur) return "?";
  for (let depth = 0; cur && depth < 20; depth++) {
    const base = cur.comm.split("/").pop() ?? cur.comm;
    for (const [re, label] of SOURCE_PATTERNS) {
      if (re.test(base)) return label;
    }
    if (cur.ppid === 1) {
      // ppid=1 有三种可能，仅最后一种是真孤儿：
      // 1) launchd 受管服务（LaunchAgent/登录项，如 OpenClaw gateway）——launchctl list 可查，带出注册 label
      const label = launchdServices?.get(cur.pid);
      if (label) return `launchd:${label}`;
      // 2) 双 fork 自愿 daemon 化的 GUI 应用后台进程——仅认 /Applications 安装位置，
      //    避免误伤 framework 内嵌的 .app（如 homebrew Python 的 Python.app 解释器壳）
      if (/^\/(?:Applications|Users\/[^/]+\/Applications)\/.*\.app\//.test(cur.comm)) return "app";
      // 3) 父进程退出后被 launchd 收养的遗留进程
      return "orphan";
    }
    if (cur.ppid <= 0) return "?";
    cur = table.get(cur.ppid);
  }
  return "?";
}

/** ps -axo pid=,command= 全表输出 → pid→完整命令行 映射（一次调用替代 per-pid 查询） */
export function parsePsCommands(text: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (m) map.set(Number(m[1]), m[2].trim());
  }
  return map;
}

/** lsof -a -p p1,p2,... -d cwd -Fn 批量输出 → pid→cwd 映射（一次调用替代 per-pid 查询） */
export function parseLsofCwds(text: string): Map<number, string> {
  const map = new Map<number, string>();
  let pid = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid > 0) map.set(pid, line.slice(1));
  }
  return map;
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

export async function scanListeners(exec: Exec = realExec): Promise<ProcessInfo[]> {
  // 固定 4 次并行调用拿全量数据（不随监听进程数增长）
  const [lsofOut, psOut, psCmdOut, launchctlOut] = await Promise.all([
    exec("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-Fpcn"]),
    exec("ps", ["-axo", "pid=,ppid=,comm="]),
    exec("ps", ["-axo", "pid=,command="]),
    exec("launchctl", ["list"]),
  ]);
  const listens = parseLsofListeners(lsofOut);
  const table = parsePsTable(psOut);
  const commands = parsePsCommands(psCmdOut);
  const launchdServices = parseLaunchctlList(launchctlOut);

  const byPid = new Map<number, Set<number>>();
  for (const l of listens) {
    if (!byPid.has(l.pid)) byPid.set(l.pid, new Set());
    byPid.get(l.pid)!.add(l.port);
  }

  // 第 5 次调用：一次 lsof 批量反查全部监听进程的 cwd（-p 支持逗号分隔列表）
  const pids = [...byPid.keys()];
  const cwds = pids.length
    ? parseLsofCwds(await exec("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fn"]))
    : new Map<number, string>();

  const infos = pids.map((pid): ProcessInfo => {
    const ports = byPid.get(pid)!;
    const command = commands.get(pid) ?? "";
    const comm = table.get(pid)?.comm ?? "?";
    return {
      pid,
      ports: [...ports].sort((a, b) => a - b),
      procName: comm.split("/").pop() ?? "?",
      command,
      cwd: cwds.get(pid) ?? null,
      inferredProject: inferProjectFromCommand(command),
      source: traceSource(pid, table, launchdServices),
    };
  });
  return infos.sort((a, b) => (a.ports[0] ?? 0) - (b.ports[0] ?? 0));
}

export function resolveProjectDir(p: Omit<ProcessInfo, "cwd" | "inferredProject"> & { cwd: string | null; inferredProject: string | null }): string | null {
  if (p.cwd && p.cwd !== "/" && !p.cwd.startsWith("/System")) return p.cwd;
  return p.inferredProject ?? p.cwd;
}

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
  const owned = registry.find((r) => !r.released && proc.ports.includes(r.port) && r.project === callerCwd);
  if (owned) return "own";
  return "foreign";
}

export async function terminate(
  pid: number,
  waitMs = 3000,
  kill: (pid: number, sig: NodeJS.Signals) => void = (p, s) => process.kill(p, s),
  alive: (pid: number) => boolean = (p) => { try { process.kill(p, 0); return true; } catch { return false; } },
): Promise<"term" | "kill" | "gone"> {
  try {
    kill(pid, "SIGTERM");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") return "gone";
    throw e;
  }
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    await new Promise((r) => setTimeout(r, 100));
    if (!alive(pid)) return "term";
  }
  try {
    kill(pid, "SIGKILL");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
  }
  return "kill";
}
