import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { scanListeners, resolveProjectDir } from "../scan.js";

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
