import fs from "node:fs/promises";
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

/** Linux: ss -tlnp 输出 → 监听条目（无 Process 列的行无法归属，跳过；多 pid 共享 socket 取第一个） */
export function parseSsListeners(text: string): ListenEntry[] {
  const out: ListenEntry[] = [];
  for (const line of text.split("\n")) {
    if (!/^LISTEN\b/.test(line)) continue;
    const pidMatch = /pid=(\d+)/.exec(line);
    if (!pidMatch) continue;
    const cols = line.trim().split(/\s+/);
    const local = cols[3] ?? "";
    const i = local.lastIndexOf(":");
    if (i < 0) continue;
    const port = Number(local.slice(i + 1));
    if (!Number.isFinite(port) || port <= 0) continue;
    out.push({ pid: Number(pidMatch[1]), port, address: local.slice(0, i) });
  }
  return out;
}

/** Linux: /proc/<pid>/cgroup → systemd 服务单元名；.scope 结尾（登录会话进程）返回 null */
export function parseCgroupServiceUnit(text: string): string | null {
  for (const line of text.split("\n")) {
    const path = line.slice(line.lastIndexOf(":") + 1);
    const last = path.split("/").filter(Boolean).pop();
    if (last?.endsWith(".service")) return last;
  }
  return null;
}

/** Linux: 批量读 /proc/<pid>/cwd 符号链接（零子进程） */
export async function linuxCwds(
  pids: number[],
  readlink: (p: string) => Promise<string> = (p) => fs.readlink(p),
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  await Promise.all(
    pids.map(async (pid) => {
      try {
        map.set(pid, await readlink(`/proc/${pid}/cwd`));
      } catch {
        /* 进程已退出或无权限 */
      }
    }),
  );
  return map;
}

/** Linux: 批量读 /proc/<pid>/cgroup 判定 systemd 受管服务 → pid→"systemd:<unit>" */
export async function linuxServiceLabels(
  pids: number[],
  readFile: (p: string) => Promise<string> = (p) => fs.readFile(p, "utf8"),
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  await Promise.all(
    pids.map(async (pid) => {
      try {
        const unit = parseCgroupServiceUnit(await readFile(`/proc/${pid}/cgroup`));
        if (unit) map.set(pid, `systemd:${unit}`);
      } catch {
        /* 进程已退出或无权限 */
      }
    }),
  );
  return map;
}

export function traceSource(pid: number, table: Map<number, PsRow>, managedServices?: Map<number, string>): string {
  let cur = table.get(pid);
  if (!cur) return "?";
  for (let depth = 0; cur && depth < 20; depth++) {
    // Linux 的 cgroup 标签挂在实际监听 pid 上；macOS 的 launchctl 标签通常挂在链根。
    // 每一层都检查，才能同时覆盖 systemd 子进程和 launchd 直接/间接子进程。
    const managedLabel = managedServices?.get(cur.pid);
    if (managedLabel) return managedLabel;
    const base = cur.comm.split("/").pop() ?? cur.comm;
    for (const [re, label] of SOURCE_PATTERNS) {
      if (re.test(base)) return label;
    }
    if (cur.ppid === 1) {
      // ppid=1 有三种可能，最后一种只能确认已脱离会话：
      // 1) 受管服务（macOS launchd / Linux systemd）——map 值即完整标签（launchd:xxx / systemd:xxx）
      // 2) 双 fork 自愿 daemon 化的 GUI 应用后台进程——仅认 /Applications 安装位置，
      //    避免误伤 framework 内嵌的 .app（如 homebrew Python 的 Python.app 解释器壳）
      if (/^\/(?:Applications|Users\/[^/]+\/Applications)\/.*\.app\//.test(cur.comm)) return "app";
      // 3) 父链已脱离当前会话。它可能是遗留进程，也可能是有意 daemon 化的服务，
      // 因此只标记 detached，不宣称它一定是可安全清理的“真孤儿”。
      return "detached";
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

export async function scanListeners(exec: Exec = realExec, platform: NodeJS.Platform = process.platform): Promise<ProcessInfo[]> {
  const linux = platform === "linux";
  // 固定次数并行调用拿全量数据（不随监听进程数增长）
  const [listenOut, psOut, psCmdOut, launchctlOut] = await Promise.all([
    linux
      ? exec("ss", ["-tlnp"])
      : exec("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-Fpcn"]),
    exec("ps", ["-axo", "pid=,ppid=,comm="]),
    exec("ps", ["-axo", "pid=,command="]),
    linux ? Promise.resolve("") : exec("launchctl", ["list"]),
  ]);
  const listens = linux ? parseSsListeners(listenOut) : parseLsofListeners(listenOut);
  const table = parsePsTable(psOut);
  const commands = parsePsCommands(psCmdOut);

  const byPid = new Map<number, Set<number>>();
  for (const l of listens) {
    if (!byPid.has(l.pid)) byPid.set(l.pid, new Set());
    byPid.get(l.pid)!.add(l.port);
  }
  const pids = [...byPid.keys()];

  // 受管服务标签：macOS 用 launchctl list，Linux 读 /proc/<pid>/cgroup
  const managedServices = linux
    ? await linuxServiceLabels(pids)
    : new Map([...parseLaunchctlList(launchctlOut)].map(([p, l]) => [p, `launchd:${l}`] as const));

  // cwd 反查：macOS 一次 lsof 批量（-p 逗号列表），Linux 读 /proc/<pid>/cwd 符号链接
  const cwds = linux
    ? await linuxCwds(pids)
    : pids.length
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
      source: traceSource(pid, table, managedServices),
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
): "detached" | "own" | "foreign" {
  if (proc.source === "detached") return "detached";
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
