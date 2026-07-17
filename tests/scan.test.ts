import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLsofListeners, parsePsTable, traceSource,
  inferProjectFromCommand, isNoise, parseLaunchctlList,
  scanListeners, resolveProjectDir,
} from "../src/scan.js";
import type { Exec } from "../src/exec.js";
import { LSOF_FPCN, PS_TABLE, LAUNCHCTL_LIST } from "./fixtures.js";

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

const fakeExec: Exec = async (cmd, args) => {
  if (cmd === "lsof" && args.includes("-Fpcn")) return LSOF_FPCN;
  if (cmd === "ps" && args.includes("pid=,ppid=,comm=")) return PS_TABLE;
  if (cmd === "lsof" && args.includes("cwd")) {
    const pid = args[args.indexOf("-p") + 1];
    if (pid === "2755") return "p2755\nfcwd\nn/private/tmp/site-platform/scratchpad\n";
    if (pid === "8660") return "p8660\nfcwd\nn/Users/worsher/code/work/mu_frontend\n";
    return "";
  }
  if (cmd === "ps" && args.includes("command=")) {
    const pid = args[args.indexOf("-p") + 1];
    if (pid === "2755") return "python3 -m http.server 8901\n";
    if (pid === "8660") return "/Users/worsher/.n/bin/node /Users/worsher/code/work/mu_frontend/node_modules/umi/bin/forkedDev.js\n";
    return "";
  }
  return "";
};

test("scanListeners 组装 ProcessInfo：去重端口、归属 cwd、来源", async () => {
  const infos = await scanListeners(fakeExec);
  const byPid = new Map(infos.map((p) => [p.pid, p]));
  const py = byPid.get(2755)!;
  assert.deepEqual(py.ports, [8901]);
  assert.equal(py.cwd, "/private/tmp/site-platform/scratchpad");
  assert.equal(py.source, "orphan");
  const umi = byPid.get(8660)!;
  assert.deepEqual(umi.ports, [8000]); // IPv4+IPv6 去重
  assert.equal(umi.source, "cursor");
  assert.equal(umi.inferredProject, "/Users/worsher/code/work/mu_frontend");
});

test("resolveProjectDir 优先 cwd，cwd 为根目录时用 inferredProject", () => {
  const base = { pid: 1, ports: [1], procName: "node", command: "", source: "?" };
  assert.equal(
    resolveProjectDir({ ...base, cwd: "/a/b", inferredProject: null }),
    "/a/b",
  );
  assert.equal(
    resolveProjectDir({ ...base, cwd: "/", inferredProject: "/x/y" }),
    "/x/y",
  );
});

test("parseLaunchctlList 提取受管服务 pid 集合", () => {
  const pids = parseLaunchctlList(LAUNCHCTL_LIST);
  assert.equal(pids.has(1513), true);
  assert.equal(pids.has(12000), true);
  assert.equal(pids.size, 2); // "-" 行不计
});

test("traceSource 三层判定：launchd 受管 / .app 兜底 / 真孤儿", () => {
  const table = parsePsTable(PS_TABLE);
  const launchd = new Set([12000]);
  // launchd 受管服务（OpenClaw gateway 场景）
  assert.equal(traceSource(12000, table, launchd), "launchd");
  // 其子进程沿链归属到受管链根
  assert.equal(traceSource(14000, table, launchd), "launchd");
  // 不受管但链根在 .app bundle 内（双 fork 自愿孤儿）
  assert.equal(traceSource(13000, table, launchd), "app");
  // 真孤儿：不受管、非 .app（原有 2755 Python）
  assert.equal(traceSource(2755, table, launchd), "orphan");
  // 不传 launchd 集合时向后兼容——但 .app 兜底仍生效
  assert.equal(traceSource(2755, table), "orphan");
});
