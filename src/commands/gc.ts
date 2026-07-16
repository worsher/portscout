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
      try {
        const how = await terminate(p.pid);
        for (const port of p.ports) await registry.markReleasedByPort(port);
        process.stderr.write(`${C.yellow}已停止孤儿${C.reset} ${desc}（${how}）\n`);
      } catch (e) {
        // 单个孤儿停止失败（如无权限）不中断整批处理
        process.stderr.write(`${C.red}停止失败${C.reset} ${desc}：${(e as Error).message}\n`);
      }
    } else {
      process.stderr.write(`${C.yellow}孤儿服务${C.reset} ${desc}\n`);
    }
  }
  if (!flags.killOrphans) {
    process.stderr.write(`\n共 ${orphans.length} 个孤儿服务；停止它们请运行 portscout gc --kill-orphans\n`);
  }
  return EXIT.OK;
}
