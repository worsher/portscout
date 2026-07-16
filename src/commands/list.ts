import path from "node:path";
import type { Flags } from "../cli.js";
import { EXIT } from "../types.js";
import { scanListeners, isNoise, resolveProjectDir } from "../scan.js";
import { formatTable, C } from "../render.js";

export default async function list(flags: Flags): Promise<number> {
  let infos = await scanListeners();
  if (!flags.all) infos = infos.filter((p) => !isNoise(p.procName));
  if (flags.project) {
    const dir = path.resolve(flags.project);
    infos = infos.filter((p) => {
      const proj = resolveProjectDir(p);
      return proj === dir || proj?.startsWith(dir + "/");
    });
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(infos, null, 2) + "\n");
    return EXIT.OK;
  }
  const rows = infos.flatMap((p) =>
    p.ports.map((port) => [
      String(port),
      String(p.pid),
      p.source === "orphan" ? `${C.yellow}orphan${C.reset}` : p.source,
      p.procName,
      resolveProjectDir(p) ?? "?",
    ]),
  );
  process.stdout.write(formatTable(["PORT", "PID", "来源", "进程", "项目目录"], rows) + "\n");
  return EXIT.OK;
}
