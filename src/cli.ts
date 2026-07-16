#!/usr/bin/env node
import { EXIT } from "./types.js";

export interface Flags {
  json: boolean;
  all: boolean;
  force: boolean;
  gui: boolean;
  install: boolean;
  killOrphans: boolean;
  project?: string;
  prefer?: number;
  range?: [number, number];
  positional: string[];
}

export function parseFlags(args: string[]): Flags {
  const f: Flags = {
    json: false, all: false, force: false, gui: false,
    install: false, killOrphans: false, positional: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--json": f.json = true; break;
      case "--all": f.all = true; break;
      case "--force": f.force = true; break;
      case "--gui": f.gui = true; break;
      case "--install": f.install = true; break;
      case "--kill-orphans": f.killOrphans = true; break;
      case "--project": f.project = args[++i]; break;
      case "--prefer": f.prefer = Number(args[++i]); break;
      case "--range": {
        const m = /^(\d+)-(\d+)$/.exec(args[++i] ?? "");
        if (!m) throw new Error("--range 格式应为 A-B，如 3000-3999");
        f.range = [Number(m[1]), Number(m[2])];
        break;
      }
      default:
        if (a.startsWith("--")) throw new Error(`未知选项: ${a}`);
        f.positional.push(a);
    }
  }
  return f;
}

const HELP = `portscout — 本机端口服务侦察与调度

用法:
  portscout list [--json] [--all] [--project <dir|.>]
  portscout whois <port> [--json]
  portscout claim <name> [--prefer N] [--range A-B] [--json]
  portscout release <name>
  portscout stop <port|name> [--force|--gui] [--json]
  portscout gc [--kill-orphans]
  portscout watch
  portscout menubar [--install]
`;

type CommandFn = (flags: Flags) => Promise<number>;
const COMMANDS: Record<string, () => Promise<{ default: CommandFn }>> = {
  list: () => import("./commands/list.js"),
  whois: () => import("./commands/whois.js"),
  // 后续任务在此注册: claim, release, stop, gc, watch, menubar
};

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  const loader = COMMANDS[cmd];
  if (!loader) {
    process.stderr.write(`未知命令: ${cmd}\n\n${HELP}`);
    return EXIT.ERR;
  }
  try {
    const mod = await loader();
    return await mod.default(parseFlags(rest));
  } catch (e) {
    process.stderr.write(`portscout: ${(e as Error).message}\n`);
    return EXIT.ERR;
  }
}

main().then((code) => { process.exitCode = code; });
