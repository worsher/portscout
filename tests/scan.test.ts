import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLsofListeners, parsePsTable, traceSource,
  inferProjectFromCommand, isNoise,
} from "../src/scan.js";
import { LSOF_FPCN, PS_TABLE } from "./fixtures.js";

test("parseLsofListeners 解析机器格式并处理 IPv6", () => {
  const entries = parseLsofListeners(LSOF_FPCN);
  assert.deepEqual(entries, [
    { pid: 2755, port: 8901, address: "*" },
    { pid: 8660, port: 8000, address: "127.0.0.1" },
    { pid: 8660, port: 8000, address: "[::1]" },
    { pid: 31401, port: 63979, address: "127.0.0.1" },
  ]);
});

test("parsePsTable 建立 pid→行 映射", () => {
  const table = parsePsTable(PS_TABLE);
  assert.equal(table.get(8660)?.ppid, 700);
  assert.equal(table.get(2755)?.comm.endsWith("Python"), true);
});

test("traceSource 识别 cursor / orphan / 未知", () => {
  const table = parsePsTable(PS_TABLE);
  assert.equal(traceSource(8660, table), "cursor");   // node→zsh→Cursor
  assert.equal(traceSource(2755, table), "orphan");   // ppid=1 且无匹配
  assert.equal(traceSource(99999, table), "?");       // 不在表中
});

test("traceSource 识别 claude-code / antigravity / docker", () => {
  const table = parsePsTable(PS_TABLE);
  assert.equal(traceSource(8123, table), "claude-code");  // node→zsh→claude
  assert.equal(traceSource(9123, table), "antigravity");  // node→Antigravity
  assert.equal(traceSource(11123, table), "docker");      // docker-proxy
});

test("traceSource 识别 macOS 自带 Terminal.app", () => {
  const table = parsePsTable(PS_TABLE);
  // python3→zsh→Terminal（comm basename 恰为 "Terminal"）
  assert.equal(traceSource(10123, table), "terminal");
});

test("inferProjectFromCommand 从命令行提取项目路径", () => {
  assert.equal(
    inferProjectFromCommand("/Users/w/.n/bin/node /Users/w/code/work/mu_frontend/node_modules/umi/bin/forkedDev.js"),
    "/Users/w/code/work/mu_frontend",
  );
  assert.equal(inferProjectFromCommand("python3 -m http.server 8901"), null);
});

test("isNoise 过滤 IDE 内部进程", () => {
  assert.equal(isNoise("Cursor Helper (Plugin)"), true);
  assert.equal(isNoise("language_server_macos_arm"), true);
  assert.equal(isNoise("node"), false);
  assert.equal(isNoise("Python"), false);
});

test("isNoise 覆盖更多噪声模式与正常进程", () => {
  assert.equal(isNoise("AnyDesk"), true);
  assert.equal(isNoise("rapportd"), true);
  assert.equal(isNoise("aTrustAgent"), true);
  assert.equal(isNoise("ControlCenter"), true);
  assert.equal(isNoise("Python"), false);
  assert.equal(isNoise("vite"), false);
});
