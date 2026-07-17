import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { scanListeners, resolveProjectDir } from "../scan.js";

/** launchd 服务按 label 探测服务定义文件（plist）的常规位置 */
async function findLaunchdPlist(label: string): Promise<string | null> {
  const candidates = [
    path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`),
    `/Library/LaunchAgents/${label}.plist`,
    `/Library/LaunchDaemons/${label}.plist`,
    `/System/Library/LaunchAgents/${label}.plist`,
    `/System/Library/LaunchDaemons/${label}.plist`,
  ];
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* 继续尝试下一个位置 */
    }
  }
  return null;
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
  if (hit.source.startsWith("launchd:")) {
    const label = hit.source.slice("launchd:".length);
    const plist = await findLaunchdPlist(label);
    lines.push(`服务注册: ${label}`);
    lines.push(`服务定义: ${plist ?? "(未在常规 LaunchAgents/LaunchDaemons 目录找到 plist)"}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  return EXIT.OK;
}
