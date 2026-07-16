import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTarget, terminate } from "../src/scan.js";
import type { ProcessInfo, RegistryEntry } from "../src/types.js";

function proc(over: Partial<ProcessInfo>): ProcessInfo {
  return {
    pid: 100, ports: [3000], procName: "node", command: "",
    cwd: "/p/other", inferredProject: null, source: "cursor", ...over,
  };
}

test("classifyTarget: 孤儿 → orphan", () => {
  assert.equal(classifyTarget(proc({ source: "orphan" }), "/p/me", []), "orphan");
});

test("classifyTarget: cwd 同项目 → own", () => {
  assert.equal(classifyTarget(proc({ cwd: "/p/me" }), "/p/me", []), "own");
  assert.equal(classifyTarget(proc({ cwd: "/p/me/sub" }), "/p/me", []), "own");
});

test("classifyTarget: 注册记录属于调用方项目 → own", () => {
  const reg: RegistryEntry[] = [{ name: "web", project: "/p/me", port: 3000, claimedAt: new Date().toISOString() }];
  assert.equal(classifyTarget(proc({ cwd: "/elsewhere" }), "/p/me", reg), "own");
});

test("classifyTarget: 他人活跃服务 → foreign", () => {
  assert.equal(classifyTarget(proc({}), "/p/me", []), "foreign");
});

test("terminate: SIGTERM 即退 → term", async () => {
  let sent: string[] = [];
  let aliveCalls = 0;
  const result = await terminate(
    42, 500,
    (_pid, sig) => { sent.push(sig); },
    () => { aliveCalls++; return aliveCalls < 2; },
  );
  assert.equal(result, "term");
  assert.deepEqual(sent, ["SIGTERM"]);
});

test("terminate: 超时后 SIGKILL → kill", async () => {
  const sent: string[] = [];
  const result = await terminate(
    42, 200,
    (_pid, sig) => { sent.push(sig); },
    () => true,
  );
  assert.equal(result, "kill");
  assert.deepEqual(sent, ["SIGTERM", "SIGKILL"]);
});
