import path from "node:path";
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { Registry } from "../registry.js";
import { isPortFree } from "../registry.js";

export default async function release(flags: Flags): Promise<number> {
  const name = flags.positional[0];
  if (!name) {
    process.stderr.write("Usage: portmarshal release <name>\n");
    return EXIT.ERR;
  }
  const project = path.resolve(flags.project ?? process.cwd());
  const registry = new Registry();
  const entry = await registry.release(name, project);
  if (!entry) {
    process.stderr.write(`No active claim found for ${name}@${project}\n`);
    return EXIT.NOT_FOUND;
  }
  process.stderr.write(`Released claim ${name} → ${entry.port}\n`);
  if (!(await isPortFree(entry.port))) {
    process.stderr.write(`Note: port ${entry.port} is still listening. release only removes the claim; stop it with portmarshal stop ${entry.port}\n`);
  }
  return EXIT.OK;
}
