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
  void osascript(`display notification ${JSON.stringify(msg)} with title "portscout"`);
}

export default async function stop(flags: Flags): Promise<number> {
  const target = flags.positional[0];
  if (!target) {
    process.stderr.write("用法: portscout stop <port|name> [--force|--gui]\n");
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
        `display dialog "端口 ${port} 是 ${proc.source} 在 ${resolveProjectDir(proc) ?? "?"} 的活跃服务，确定停止？" with title "portscout" buttons {"取消","停止"} default button "取消" cancel button "取消" with icon caution`,
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
