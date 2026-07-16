import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Registry } from "../src/registry.js";

async function tmpRegistry(): Promise<Registry> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "portscout-test-"));
  return new Registry(dir);
}
const alwaysFree = async () => true;

test("claim 分配 prefer 端口并写入注册表", async () => {
  const r = await tmpRegistry();
  const { port, reused } = await r.claim({
    name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree,
  });
  assert.equal(port, 3000);
  assert.equal(reused, false);
  const entries = await r.load();
  assert.equal(entries[0].name, "web");
  assert.equal(entries[0].project, "/proj/a");
});

test("claim 幂等：同 (project,name) 重复 claim 返回原端口", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  const second = await r.claim({ name: "web", project: "/proj/a", prefer: 4000, portFree: alwaysFree });
  assert.equal(second.port, 3000);
  assert.equal(second.reused, true);
});

test("claim 冲突顺延：prefer 被其他项目注册时 +1", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  const b = await r.claim({ name: "web", project: "/proj/b", prefer: 3000, portFree: alwaysFree });
  assert.equal(b.port, 3001);
});

test("claim 跳过实际被占用的端口", async () => {
  const r = await tmpRegistry();
  const busy3000 = async (p: number) => p !== 3000;
  const { port } = await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: busy3000 });
  assert.equal(port, 3001);
});

test("claim 在 prefer 不可用时回落扫描 range 低端口段", async () => {
  const r = await tmpRegistry();
  const { port } = await r.claim({
    name: "web", project: "/proj/a",
    prefer: 3005, range: [3000, 3010],
    portFree: async (p) => p < 3005, // 3005-3010 全被占用
  });
  assert.equal(port, 3000);
});

test("release 后再 claim 粘性复用 lastPort", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  const released = await r.release("web", "/proj/a");
  assert.equal(released?.port, 3000);
  const again = await r.claim({ name: "web", project: "/proj/a", portFree: alwaysFree });
  assert.equal(again.port, 3000); // 未传 prefer，靠 lastPort 粘回
});

test("release 不存在的记录返回 null", async () => {
  const r = await tmpRegistry();
  assert.equal(await r.release("nope", "/proj/a"), null);
});

test("gcStale 回收超过 30 分钟未监听的记录并保留粘性", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  const later = Date.now() + 31 * 60 * 1000;
  const removed = await r.gcStale(new Set(), later);
  assert.equal(removed.length, 1);
  const entries = await r.load();
  assert.equal(entries[0].released, true);
  assert.equal(entries[0].lastPort, 3000);
});

test("gcStale 不回收正在监听的记录", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  const later = Date.now() + 31 * 60 * 1000;
  const removed = await r.gcStale(new Set([3000]), later);
  assert.equal(removed.length, 0);
});

test("注册表损坏时备份重建", async () => {
  const r = await tmpRegistry();
  await fs.mkdir(r.dir, { recursive: true });
  await fs.writeFile(path.join(r.dir, "registry.json"), "{broken");
  const entries = await r.load();
  assert.deepEqual(entries, []);
  const bak = await fs.readFile(path.join(r.dir, "registry.json.bak"), "utf8");
  assert.equal(bak, "{broken");
});

test("markReleasedByPort 把活跃记录转为 released", async () => {
  const r = await tmpRegistry();
  await r.claim({ name: "web", project: "/proj/a", prefer: 3000, portFree: alwaysFree });
  await r.markReleasedByPort(3000);
  const entries = await r.load();
  assert.equal(entries[0].released, true);
  assert.equal(entries[0].lastPort, 3000);
});

test("claim 可夺取已死进程遗留的锁", async () => {
  const r = await tmpRegistry();
  const lockDir = path.join(r.dir, ".lock");
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(lockDir, "pid"), "999999"); // 几乎必死的 pid
  const { port } = await r.claim({ name: "web", project: "/p", prefer: 3000, portFree: async () => true });
  assert.equal(port, 3000);
});
