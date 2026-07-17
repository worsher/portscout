import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { scanListeners, resolveProjectDir } from "../scan.js";

/** 受管服务按 label 探测服务定义文件的常规位置（macOS plist / Linux systemd unit） */
async function findServiceDefinition(source: string): Promise<{ label: string; file: string | null } | null> {
  let candidates: string[];
  let label: string;
  if (source.startsWith("launchd:")) {
    label = source.slice("launchd:".length);
    candidates = [
      path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`),
      `/Library/LaunchAgents/${label}.plist`,
      `/Library/LaunchDaemons/${label}.plist`,
      `/System/Library/LaunchAgents/${label}.plist`,
      `/System/Library/LaunchDaemons/${label}.plist`,
    ];
  } else if (source.startsWith("systemd:")) {
    label = source.slice("systemd:".length);
    candidates = [
      path.join(os.homedir(), ".config/systemd/user", label),
      `/etc/systemd/system/${label}`,
      `/usr/lib/systemd/system/${label}`,
      `/lib/systemd/system/${label}`,
    ];
  } else {
    return null;
  }
  for (const p of candidates) {
    try {
      await fs.access(p);
      return { label, file: p };
    } catch {
      /* 继续尝试下一个位置 */
    }
  }
  return { label, file: null };
}

export default async function whois(flags: Flags): Promise<number> {
  const port = Number(flags.positional[0]);
  if (!Number.isFinite(port)) {
    process.stderr.write("用法: portscout whois <port>\n");
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
  const lines = [
    `端口:     ${port}`,
    `PID:      ${hit.pid}`,
    `来源:     ${hit.source}`,
    `项目目录: ${resolveProjectDir(hit) ?? "?"}`,
    `命令:     ${hit.command}`,
  ];
  const svc = await findServiceDefinition(hit.source);
  if (svc) {
    lines.push(`服务注册: ${svc.label}`);
    lines.push(`服务定义: ${svc.file ?? "(未在常规服务定义目录找到)"}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  return EXIT.OK;
}
