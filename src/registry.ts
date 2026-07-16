import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { RegistryEntry } from "./types.js";

export class LockTimeoutError extends Error {
  constructor() { super("注册表锁竞争超时，可稍后重试"); }
}

export async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host: "127.0.0.1" }, () => srv.close(() => resolve(true)));
  });
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export class Registry {
  readonly dir: string;
  readonly file: string;

  constructor(dir = path.join(os.homedir(), ".portscout")) {
    this.dir = dir;
    this.file = path.join(dir, "registry.json");
  }

  async load(): Promise<RegistryEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    try {
      return JSON.parse(raw) as RegistryEntry[];
    } catch {
      await fs.rename(this.file, this.file + ".bak").catch(() => {});
      process.stderr.write("portscout: 注册表损坏，已备份为 registry.json.bak 并重建\n");
      return [];
    }
  }

  private async save(entries: RegistryEntry[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = this.file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(entries, null, 2) + "\n");
    await fs.rename(tmp, this.file);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockDir = path.join(this.dir, ".lock");
    const pidFile = path.join(lockDir, "pid");
    await fs.mkdir(this.dir, { recursive: true });
    const start = Date.now();
    for (;;) {
      try {
        await fs.mkdir(lockDir);
        await fs.writeFile(pidFile, String(process.pid));
        break;
      } catch {
        if (Date.now() - start > 2000) {
          const holderRaw = await fs.readFile(pidFile, "utf8").catch(() => null);
          if (holderRaw === null) {
            // pid 文件尚未写入：持有者可能正处于「mkdir 成功但还没来得及写 pid」的窗口期。
            // 只有当 lockDir 本身足够老（大概率是崩溃进程的残留）才视为可回收，否则耐心等待。
            const st = await fs.stat(lockDir).catch(() => null);
            if (st && Date.now() - st.mtimeMs > 10_000) {
              await fs.rm(lockDir, { recursive: true, force: true });
            }
            await new Promise((r) => setTimeout(r, 50));
            continue;
          }
          const holder = Number(holderRaw);
          if (holder && isAlive(holder)) throw new LockTimeoutError();
          await fs.rm(lockDir, { recursive: true, force: true });
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  }

  async claim(opts: {
    name: string;
    project: string;
    prefer?: number;
    range?: [number, number];
    claimedBy?: string;
    portFree?: (p: number) => Promise<boolean>;
  }): Promise<{ port: number; reused: boolean }> {
    const free = opts.portFree ?? isPortFree;
    return this.withLock(async () => {
      const entries = await this.load();
      const isKey = (e: RegistryEntry) => e.project === opts.project && e.name === opts.name;
      const existing = entries.find(isKey);

      if (existing && !existing.released) {
        return { port: existing.port, reused: true };
      }

      const taken = new Set(entries.filter((e) => !e.released).map((e) => e.port));
      const [lo, hi] = opts.range ?? [3000, 9999];
      const candidates: number[] = [];
      if (existing?.lastPort) candidates.push(existing.lastPort);
      if (opts.prefer) candidates.push(opts.prefer);
      for (let p = lo; p <= hi; p++) candidates.push(p);

      let chosen = -1;
      for (const p of candidates) {
        if (p < lo && p !== existing?.lastPort && p !== opts.prefer) continue;
        if (taken.has(p)) continue;
        if (await free(p)) { chosen = p; break; }
      }
      if (chosen < 0) throw new Error(`范围 ${lo}-${hi} 内无可用端口`);

      const entry: RegistryEntry = {
        name: opts.name,
        project: opts.project,
        port: chosen,
        claimedAt: new Date().toISOString(),
        claimedBy: opts.claimedBy,
      };
      await this.save([...entries.filter((e) => !isKey(e)), entry]);
      return { port: chosen, reused: false };
    });
  }

  async release(name: string, project: string): Promise<RegistryEntry | null> {
    return this.withLock(async () => {
      const entries = await this.load();
      const idx = entries.findIndex((e) => e.project === project && e.name === name && !e.released);
      if (idx < 0) return null;
      const e = entries[idx];
      entries[idx] = { ...e, released: true, lastPort: e.port };
      await this.save(entries);
      return e;
    });
  }

  async markReleasedByPort(port: number): Promise<void> {
    await this.withLock(async () => {
      const entries = await this.load();
      let changed = false;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.released && e.port === port) {
          entries[i] = { ...e, released: true, lastPort: e.port };
          changed = true;
        }
      }
      if (changed) await this.save(entries);
    });
  }

  /** 回收「已注册未监听且超过 30 分钟」的记录（转 released 保粘性），返回被回收项 */
  async gcStale(listeningPorts: Set<number>, now = Date.now()): Promise<RegistryEntry[]> {
    return this.withLock(async () => {
      const entries = await this.load();
      const removed: RegistryEntry[] = [];
      const next = entries.map((e) => {
        if (e.released) return e;
        const listening = listeningPorts.has(e.port);
        const age = now - Date.parse(e.claimedAt);
        if (!listening && age > 30 * 60 * 1000) {
          removed.push(e);
          return { ...e, released: true, lastPort: e.port };
        }
        return e;
      });
      if (removed.length) await this.save(next);
      return removed;
    });
  }
}
