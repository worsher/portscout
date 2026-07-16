import path from "node:path";
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { Registry, LockTimeoutError } from "../registry.js";

export default async function claim(flags: Flags): Promise<number> {
  const name = flags.positional[0];
  if (!name) {
    process.stderr.write("用法: portscout claim <name> [--prefer N] [--range A-B]\n");
    return EXIT.ERR;
  }
  const project = path.resolve(flags.project ?? process.cwd());
  const registry = new Registry();
  try {
    const { port, reused } = await registry.claim({
      name, project,
      prefer: flags.prefer,
      range: flags.range,
      claimedBy: process.env.CLAUDECODE ? "claude-code" : (process.env.TERM_PROGRAM ?? "cli"),
    });
    if (flags.json) {
      process.stdout.write(JSON.stringify({ name, project, port, reused }) + "\n");
    } else {
      process.stdout.write(String(port) + "\n"); // stdout 仅端口号，供 PORT=$(...) 使用
      process.stderr.write(
        reused
          ? `复用已有预留 ${name}@${project} → ${port}\n`
          : `已预留 ${name}@${project} → ${port}\n`,
      );
    }
    return EXIT.OK;
  } catch (e) {
    if (e instanceof LockTimeoutError) {
      process.stderr.write(`portscout: ${e.message}\n`);
      return EXIT.LOCK_TIMEOUT;
    }
    throw e;
  }
}
