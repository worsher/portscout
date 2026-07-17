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

/** 转义字符串用于嵌入 AppleScript 双引号字面量 */
function asStr(s: string | number): string {
  return JSON.stringify(String(s)); // 产出带引号的字面量，AppleScript 转义规则与 JSON 兼容
}

function notify(msg: string): void {
  void osascript(`display notification ${JSON.stringify(msg)} with title "portmarshal"`);
}

export default async function stop(flags: Flags): Promise<number> {
  const target = flags.positional[0];
  if (!target) {
    process.stderr.write("Usage: portmarshal stop <port|name> [--force|--gui]\n");
    return EXIT.ERR;
  }
  if (flags.gui && process.platform !== "darwin") {
    process.stderr.write("--gui requires macOS osascript; review the target and use --force on this platform\n");
    return EXIT.ERR;
  }
  const registry = new Registry();
  const entries = await registry.load();
  const callerCwd = path.resolve(flags.project ?? process.cwd());

  let port = Number(target);
  if (!Number.isFinite(port)) {
    const reg = entries.find((e) => !e.released && e.name === target && e.project === callerCwd);
    if (!reg) {
      process.stderr.write(`No active claim found for ${target}@${callerCwd}\n`);
      return EXIT.NOT_FOUND;
    }
    port = reg.port;
  } else if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`Invalid TCP port: ${target}\n`);
    return EXIT.ERR;
  }

  const scan = await scanListeners();
  const proc = scan.find((p) => p.ports.includes(port));
  if (!proc) {
    process.stderr.write(`Nothing is listening on port ${port}\n`);
    if (flags.gui) notify(`Nothing is listening on port ${port}`);
    return EXIT.NOT_FOUND;
  }

  const kind = classifyTarget(proc, callerCwd, entries);
  const desc = `${port} (${proc.source} · ${resolveProjectDir(proc) ?? "?"} · pid ${proc.pid})`;

  if (kind === "foreign" && !flags.force) {
    if (flags.gui) {
      const proj = resolveProjectDir(proc) ?? "?";
      const dialogText = `"Port " & ${asStr(port)} & " is an active " & ${asStr(proc.source)} & " service in " & ${asStr(proj)} & ". Stop it?"`;
      const { ok } = await osascript(
        `display dialog ${dialogText} with title "portmarshal" buttons {"Cancel","Stop"} default button "Cancel" cancel button "Cancel" with icon caution`,
      );
      if (!ok) return EXIT.OK; // 用户取消
    } else {
      const info = { port, pid: proc.pid, source: proc.source, project: resolveProjectDir(proc), command: proc.command };
      if (flags.json) {
        process.stdout.write(JSON.stringify({ blocked: true, ...info }) + "\n");
      } else {
        process.stderr.write(`Blocked: ${desc} belongs to another active service\n  Command: ${proc.command}\n  Review the attribution, then add --force to stop it\n`);
      }
      return EXIT.BLOCKED;
    }
  }

  const how = await terminate(proc.pid);
  // 进程可能监听多个端口，全部预留记录一并清理
  for (const p of proc.ports) await registry.markReleasedByPort(p);
  const msg = how === "gone" ? "Process was already gone; cleared its claim" : `Stopped ${desc}${how === "kill" ? " (SIGKILL)" : ""}`;
  if (flags.json) {
    process.stdout.write(JSON.stringify({ stopped: true, port, pid: proc.pid, how }) + "\n");
  } else {
    process.stderr.write(msg + "\n");
  }
  if (flags.gui) notify(msg);
  return EXIT.OK;
}
