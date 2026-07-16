import { execFile } from "node:child_process";

export type Exec = (cmd: string, args: string[]) => Promise<string>;

/** 容错执行：lsof 无匹配时退出码非 0，一律返回 stdout（可能为空串） */
export const realExec: Exec = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (_err, stdout) => {
      resolve(stdout ?? "");
    });
  });
