import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMenubar } from "../src/commands/menubar.js";
import type { MergedEntry, ProcessInfo } from "../src/types.js";

function entry(port: number, state: MergedEntry["state"], source = "cursor", cwd = "/p/a"): MergedEntry {
  const proc: ProcessInfo = {
    pid: 1, ports: [port], procName: "node", command: "node dev",
    cwd, inferredProject: null, source,
  };
  return { port, state, proc };
}

test("renderMenubar 标题含服务数与异常数", () => {
  const out = renderMenubar([entry(3000, "active"), entry(8901, "unregistered", "orphan")], "/bin/portscout");
  const title = out.split("\n")[0];
  assert.match(title, /2/);
  assert.match(title, /⚠\s*1/);
});

test("renderMenubar 服务行带子菜单动作，stop 挂 --gui", () => {
  const out = renderMenubar([entry(3000, "active")], "/bin/portscout");
  assert.match(out, /-- 停止服务.*bash="\/bin\/portscout".*param1=stop.*param2=3000.*param3=--gui.*terminal=false.*refresh=true/);
  assert.match(out, /-- 复制 http:\/\/localhost:3000/);
});

test("renderMenubar 孤儿行标橙色", () => {
  const out = renderMenubar([entry(8901, "unregistered", "orphan")], "/bin/portscout");
  const line = out.split("\n").find((l) => l.includes("8901") && !l.startsWith("--"))!;
  assert.match(line, /color=orange/);
});

test("renderMenubar 无服务时显示空态", () => {
  const out = renderMenubar([], "/bin/portscout");
  assert.match(out, /没有监听中的开发服务/);
});
