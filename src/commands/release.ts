import path from "node:path";
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { Registry } from "../registry.js";
import { isPortFree } from "../registry.js";

export default async function release(flags: Flags): Promise<number> {
  const name = flags.positional[0];
  if (!name) {
    process.stderr.write("用法: portscout release <name>\n");
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
    process.stderr.write(`注意：端口 ${entry.port} 上服务仍在运行，release 仅释放预留记录；停止服务请用 portscout stop ${entry.port}\n`);
  }
  return EXIT.OK;
}
