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
      "未检测到 SwiftBar 配置。请先安装：brew install swiftbar 并启动一次；\n或手动把以下脚本放入插件目录（命名 portscout.5s.sh）：\n\n#!/bin/bash\nexec \"" + binPath + "\" menubar\n",
    );
    return EXIT.ERR;
  }
  const plugin = path.join(dir, "portscout.5s.sh");
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
