#!/usr/bin/env node
import fs from "node:fs/promises";
import { EXIT } from "./types.js";

export interface Flags {
  json: boolean;
  all: boolean;
  force: boolean;
  gui: boolean;
  install: boolean;
  killDetached: boolean;
  project?: string;
  prefer?: number;
  range?: [number, number];
  positional: string[];
}

export function parseFlags(args: string[]): Flags {
  const f: Flags = {
    json: false, all: false, force: false, gui: false,
    install: false, killDetached: false, positional: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--json": f.json = true; break;
      case "--all": f.all = true; break;
      case "--force": f.force = true; break;
      case "--gui": f.gui = true; break;
      case "--install": f.install = true; break;
      case "--kill-detached": f.killDetached = true; break;
      case "--kill-orphans": f.killDetached = true; break; // v0.2 compatibility alias
      case "--project": f.project = args[++i]; break;
      case "--prefer": {
        const port = Number(args[++i]);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error("--prefer must be a TCP port between 1 and 65535");
        }
        f.prefer = port;
        break;
      }
      case "--range": {
        const m = /^(\d+)-(\d+)$/.exec(args[++i] ?? "");
        if (!m) throw new Error("--range must use A-B format, for example 3000-3999");
        const lo = Number(m[1]);
        const hi = Number(m[2]);
        if (lo < 1 || hi > 65535 || lo > hi) {
          throw new Error("--range must be an ascending TCP port range within 1-65535");
        }
        f.range = [lo, hi];
        break;
      }
      default:
        if (a.startsWith("--")) throw new Error(`Unknown option: ${a}`);
        f.positional.push(a);
    }
  }
  return f;
}

const HELP = `portmarshal — agent-aware local port ownership and guarded orchestration

Usage:
  portmarshal list [--json] [--all] [--project <dir|.>]
  portmarshal whois <port> [--json]
  portmarshal claim <name> [--prefer N] [--range A-B] [--json]
  portmarshal release <name>
  portmarshal stop <port|name> [--force|--gui] [--json]
  portmarshal gc [--kill-detached]
  portmarshal watch
  portmarshal menubar [--install]
  portmarshal -v | --version
`;

type CommandFn = (flags: Flags) => Promise<number>;
const COMMANDS: Record<string, () => Promise<{ default: CommandFn }>> = {
  list: () => import("./commands/list.js"),
  whois: () => import("./commands/whois.js"),
  claim: () => import("./commands/claim.js"),
  release: () => import("./commands/release.js"),
  stop: () => import("./commands/stop.js"),
  gc: () => import("./commands/gc.js"),
  watch: () => import("./commands/watch.js"),
  menubar: () => import("./commands/menubar.js"),
};

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    const pkg = JSON.parse(
      await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    process.stdout.write(pkg.version + "\n");
    return EXIT.OK;
  }
  const loader = COMMANDS[cmd];
  if (!loader) {
    process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
    return EXIT.ERR;
  }
  try {
    const mod = await loader();
    return await mod.default(parseFlags(rest));
  } catch (e) {
    process.stderr.write(`portmarshal: ${(e as Error).message}\n`);
    return EXIT.ERR;
  }
}

main().then((code) => { process.exitCode = code; });
