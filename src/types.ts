export interface ListenEntry {
  pid: number;
  port: number;
  address: string;
}

export interface PsRow {
  pid: number;
  ppid: number;
  comm: string;
}

export interface ProcessInfo {
  pid: number;
  ports: number[];
  procName: string;
  command: string;
  cwd: string | null;
  /** 从命令行参数推断的项目路径（cwd 失真时的兜底） */
  inferredProject: string | null;
  source: string; // "claude-code" | "cursor" | "antigravity" | "vscode/electron" | "terminal" | "docker" | "detached" | "?"
}

export interface RegistryEntry {
  name: string;
  project: string;
  port: number;
  claimedAt: string; // ISO 8601
  claimedBy?: string;
  released?: boolean;
  lastPort?: number;
}

export type PortState = "active" | "reserved" | "unregistered" | "drift";

export interface MergedEntry {
  port: number;
  state: PortState;
  proc?: ProcessInfo;
  reg?: RegistryEntry;
  driftPeer?: number;
}

export const EXIT = {
  OK: 0,
  ERR: 1,
  NOT_FOUND: 2,
  BLOCKED: 3,
  LOCK_TIMEOUT: 4,
} as const;
