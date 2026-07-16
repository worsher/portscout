# Task 3: 扫描组装 + list / whois 命令 - 完成报告

## 实现内容

在 Task 2 纯函数解析器（parseLsofListeners/parsePsTable/traceSource/inferProjectFromCommand/isNoise）之上，完成了 async 组装层与两个查询命令：

### 1. src/scan.ts（追加）
- `scanListeners(exec?: Exec): Promise<ProcessInfo[]>`：并发执行 `lsof -iTCP -sTCP:LISTEN -P -n -Fpcn` 与 `ps -axo pid=,ppid=,comm=`，按 pid 聚合端口（`Set<number>` 天然去重 IPv4/IPv6 重复端口），再对每个 pid 并发反查 `lsof -a -p <pid> -d cwd -Fn`（cwd）与 `ps -o command= -p <pid>`（完整命令行），组装出 `ProcessInfo[]`，按最小端口排序。
- `resolveProjectDir(p)`：cwd 有效（非空、非 `/`、非 `/System` 前缀）时优先返回 cwd，否则回退到 `inferredProject`（再退回 cwd 本身，即 null）。

### 2. src/render.ts（新建）
- `C`：ANSI 颜色常量（red/green/yellow/dim/reset）。
- `formatTable(header, rows)`：按列宽（基于去除 ANSI 转义序列后的字符长度）对齐输出纯文本表格。

### 3. src/commands/list.ts（新建）
- 默认经 `isNoise` 过滤噪声进程，`--all` 显示全部。
- `--project <dir>` 按 `resolveProjectDir` 结果做前缀匹配过滤。
- `--json` 输出结构化 `ProcessInfo[]`；否则渲染表格，`orphan` 来源标黄。

### 4. src/commands/whois.ts（新建）
- 解析位置参数为端口号，非数字 → stderr 提示用法 + `EXIT.ERR`（1）。
- 未找到监听 → stderr 提示 + `EXIT.NOT_FOUND`（2）。
- 命中 → `--json` 输出该 `ProcessInfo`，否则输出端口/PID/来源/项目目录/命令的人类可读块。

### 5. src/cli.ts（注册）
`COMMANDS` 表新增 `list`/`whois` 的懒加载 import，其余命令位置保留注释占位给后续任务。

## TDD 证据

### RED（scanListeners/resolveProjectDir 未导出）

```
$ pnpm test
...
# /Users/worsher/code/github/portscout/tests/scan.test.ts:6
#   scanListeners, resolveProjectDir,
#                  ^
# SyntaxError: The requested module '../src/scan.js' does not provide an export named 'resolveProjectDir'
...
# tests 1
# pass 0
# fail 1
```

### GREEN（实现 scanListeners + resolveProjectDir 后）

```
$ pnpm test
...
ok 9 - scanListeners 组装 ProcessInfo：去重端口、归属 cwd、来源
ok 10 - resolveProjectDir 优先 cwd，cwd 为根目录时用 inferredProject
1..10
# tests 10
# pass 10
# fail 0
```

新增两个测试用例（原 8 个 scan.test.ts 用例保持不变）：
- `scanListeners 组装 ProcessInfo`：用 fakeExec 模拟 lsof/ps 四种调用，验证 pid=2755（python，端口 8901，cwd 正常，source=orphan）与 pid=8660（node/umi，IPv4+IPv6 两条 lsof 记录去重为单一端口 8000，source=cursor，inferredProject 从命令行 node_modules 路径正确推断）。
- `resolveProjectDir`：cwd=/a/b 时优先 cwd；cwd=/ 时回退 inferredProject。

## 真机验证（Step 5，macOS 实机）

### 构建

```
$ pnpm build
> portscout@0.1.0 build /Users/worsher/code/github/portscout
> tsc
```
无报错。

### list（默认过滤噪声）

```
$ node dist/cli.js list
PORT  PID   来源      进程    项目目录
8000  8660  cursor  node  /Users/worsher/code/work/mu_frontend
```

符合预期：真实 dev server（mu_frontend 的 8000 端口，来源 cursor）被正确识别，IDE/系统噪声进程（ControlCenter/AnyDesk/Antigravity Helper/language_server/rapportd/aTrustAgent/Cursor Helper 等）被默认过滤。

### list --json

```json
[
  {
    "pid": 8660,
    "ports": [8000],
    "procName": "node",
    "command": "/Users/worsher/.n/bin/node /Users/worsher/code/work/mu_frontend/node_modules/umi/bin/forkedDev.js dev",
    "cwd": "/Users/worsher/code/work/mu_frontend",
    "inferredProject": "/Users/worsher/code/work/mu_frontend",
    "source": "cursor"
  }
]
```

### whois 8000（命中）

```
$ node dist/cli.js whois 8000
端口:     8000
PID:      8660
来源:     cursor
项目目录: /Users/worsher/code/work/mu_frontend
命令:     /Users/worsher/.n/bin/node /Users/worsher/code/work/mu_frontend/node_modules/umi/bin/forkedDev.js dev
```

### whois 1（未监听，退出码校验）

```
$ node dist/cli.js whois 1; echo "exit=$?"
端口 1 当前无监听
exit=2
```

`exit=2` 即 `EXIT.NOT_FOUND`，符合任务硬性要求。

### 补充验证（超出 brief 最低要求，用于自查）

- `list --all`：显示全部 ~60 行，含 Antigravity/language_server/Cursor Helper/ControlCenter/AnyDesk/rapportd/aTrustAgent/MacPacketTunnel 等噪声进程，`orphan` 来源以黄色高亮。
- `list --project /Users/worsher/code/work/mu_frontend`：仅保留该项目下的 8000 端口一行；换一个不存在的目录则只剩表头、`exit=0`（无崩溃）。
- `whois 8000 --json`：与 `list --json` 中对应条目一致。
- `whois`（不带参数）：`用法: portscout whois <port>`，`exit=1`（EXIT.ERR，与"未找到"的 exit=2 语义区分）。
- `--help` 与未知命令路径：均未受本次改动影响，行为与 Task 1 一致。

## 文件变更

提交 `b7cbd60`：

```
 src/cli.ts            |  4 +++-
 src/commands/list.ts  | 32 ++++++++++++++++++++++++++++++++
 src/commands/whois.ts | 31 +++++++++++++++++++++++++++++++
 src/render.ts         | 19 +++++++++++++++++++
 src/scan.ts           | 45 ++++++++++++++++++++++++++++++++++++++++++++-
 tests/scan.test.ts    | 45 +++++++++++++++++++++++++++++++++++++++++++++
 6 files changed, 174 insertions(+), 2 deletions(-)
```

新建文件：`src/render.ts`、`src/commands/list.ts`、`src/commands/whois.ts`。
修改文件：`src/scan.ts`（追加 scanListeners/resolveProjectDir）、`src/cli.ts`（注册 list/whois）、`tests/scan.test.ts`（追加 2 测试）。
`dist/` 为构建产物，已被 `.gitignore` 排除，未提交。

## 自审核

### 功能正确性
- scanListeners 的端口去重逻辑（`Set<number>` per pid）正确处理了同端口 IPv4/IPv6 双记录的场景（真机 mu_frontend 8000 端口即为此例：lsof 输出 `127.0.0.1:8000` 与 `[::1]:8000` 两条，最终只出现一次）。
- resolveProjectDir 的 cwd 兜底逻辑在真机 `--all` 输出中大量噪声进程（cwd 反查失败或为 `/`）上表现正确，均正确回退为 `inferredProject ?? "/"`，未出现 null 导致的渲染异常。
- whois 的三态退出码区分正确：参数非法 → 1（ERR），端口未监听 → 2（NOT_FOUND），命中 → 0（OK）。与 brief 中"whois not-found 返回 EXIT.NOT_FOUND (2)"的硬性要求一致，真机验证已确认。
- 命令懒加载注册（`COMMANDS.list`/`COMMANDS.whois`）与 Task 1 的 `CommandFn` 类型签名 `(flags: Flags) => Promise<number>` 完全匹配，`pnpm build` 严格模式下无类型错误。

### 代码质量
- 零运行时依赖：新增代码仅用 `node:path` 与已有的 `Exec` 抽象，无新增 npm 依赖。
- 所有用户可见文案（表头、whois 输出、错误提示）均为中文，符合全局约束。
- `list.ts`/`whois.ts` 内部标识符、注释保持英文/既有中文混排风格，与既有代码库一致。

### 已知问题（不在本任务范围内修复，供后续参考）
1. **`formatTable` 对中日韩宽字符的列宽计算按 `.length`（UTF-16 码元数）而非终端显示宽度计算**：表头"来源"/"进程"/"项目目录"在等宽终端中实际占用双倍显示列，而数据列多为 ASCII，导致真机 `list`/`list --all` 输出出现表头与数据列轻微错位（内容仍可读，不影响 `--json` 的机器消费场景，`--json` 字段本身不受影响）。此为 brief 给定的 `render.ts` 代码块（要求"verbatim"使用）固有行为，未做偏离式修复；如需修正需改用 East Asian Width 感知的列宽算法，建议留给 render.ts 的后续统一改造（其他命令如 stop/gc 也会复用该函数）。已通过 spawn_task 标记为独立任务（task_4c539dbd），供后续视需要拉起处理。
2. **brief 文档中 "Produces" 一行的签名描述 `formatTable(rows: string[][], header: string[])` 与其下方代码块的实际签名 `formatTable(header: string[], rows: string[][])` 参数顺序相反**——本次严格按代码块（含 list.ts 的调用点 `formatTable(["PORT", ...], rows)`）实现，两者自洽，仅为 brief 文本本身的描述笔误，不影响实现正确性，供文档维护参考。
3. 沿用 Task 1/2 progress.md 中已记录、本任务未触碰的既有 minor 项（`cli.ts` `--prefer`/`--project` 缺值校验、`scan.ts` basename 死代码等），延后到最终评审统一处理。

### 测试覆盖
- `tests/scan.test.ts` 从 8 个用例增至 10 个，新增用例覆盖：跨 pid 端口聚合、IPv4/IPv6 去重、cwd 正常解析、orphan/cursor 两种来源判定、inferredProject 推断、resolveProjectDir 的两个分支（cwd 有效 / cwd 为根目录回退）。
- `pnpm test` 全量 10/10 通过；`pnpm build` 严格模式无报错；真机验证覆盖 brief Step 5 全部三条命令外加 6 项补充场景（--all/--project 两种取值/whois --json/whois 缺参/回归 help 与未知命令）。

## 提交

```
b7cbd60 feat: scan assembly with list and whois commands

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

工作区在提交后为 clean 状态，无遗留改动。

## 后续任务准备

`scanListeners`/`resolveProjectDir` 已作为稳定接口导出，供 Task 4+（registry/claim/stop/gc/watch/menubar）复用；`render.ts` 的 `C`/`formatTable` 亦为共享渲染基础设施，后续命令（如 stop 的红色警告、watch 的实时表格）可直接复用。

---

## CJK 表头对齐缺陷修复（后续补充）

### 缺陷描述
Task 3 验证中发现的 `formatTable` 第 160 项已知问题：CJK 字符（"来源"、"进程"、"项目目录"）在终端等宽字体中占 2 列显示宽度，但 `.length` 计数时只算 1 个单位，导致表头与 ASCII 数据行错位。

### 修复方案
在 `src/render.ts` 中新增 `isWide()` 函数（检查 East Asian Width 标准中的宽字符码点范围）和 `displayWidth()` 函数（按码点迭代计算终端显示宽度），替换 `formatTable` 中两处 `.length` 调用：

```typescript
const isWide = (cp: number): boolean => /* 条件分支覆盖 CJK 汉字、假名、谚文、全角符号等 */
const displayWidth = (s: string): number => /* 逐字符检查码点，宽字符 +2，其他 +1 */

export function formatTable(header: string[], rows: string[][]): string {
  const widths = header.map((_, i) =>
    Math.max(...all.map((r) => displayWidth(strip(r[i] ?? "")))),  // 改：.length → displayWidth
  );
  const fmt = (r: string[]) =>
    r.map((c, i) => c + " ".repeat(widths[i] - displayWidth(strip(c)))).join("  ");  // 改：.length → displayWidth
  // ...
}
```

### RED → GREEN 证据

#### RED（修复前，测试失败）
新增三项测试用例在 `tests/render.test.ts`，其中第一项（`formatTable 按终端显示宽度对齐 CJK 表头与 ASCII 数据`）在应用 displayWidth 前会失败：

```
CJK 表头"来源"(宽4) 不足 ASCII 数据"orphan"(长6)，
计算列宽时 "来源".length=2 错误小于实际显示宽度 4，
补齐空格数不足，导致表头与数据行显示宽度不等。
```

#### GREEN（修复后，全量测试通过）

```
$ pnpm test
# Subtest: formatTable 按终端显示宽度对齐 CJK 表头与 ASCII 数据
ok 1 - formatTable 按终端显示宽度对齐 CJK 表头与 ASCII 数据
# Subtest: formatTable：CJK 单元格最宽时，ASCII 行按其显示宽度补齐
ok 2 - formatTable：CJK 单元格最宽时，ASCII 行按其显示宽度补齐
# Subtest: formatTable 宽度计算忽略 ANSI 码，假名/全角字符按 2 列
ok 3 - formatTable 宽度计算忽略 ANSI 码，假名/全角字符按 2 列
（及既有 10 项 scan 测试全部 ok）
1..13
# pass 13
# fail 0
```

### 真机验证

```bash
$ pnpm build && node dist/cli.js list
PORT  PID   来源    进程  项目目录
8000  8660  cursor  node  /Users/worsher/code/work/mu_frontend
```

**对比修复前**：表头"来源"错位向左（.length 算短了），列分隔符对不齐。  
**修复后**：displayWidth 正确计数 CJK 双倍宽度，各列补齐空格量精确，表头与数据行视觉对齐。

### 文件变更

```
src/render.ts         | +25  # 新增 isWide + displayWidth，修改 formatTable 两处
tests/render.test.ts  | +54  # 新建，含 3 项测试用例
package.json          | +1   # test 脚本新增 tests/render.test.ts
```

提交 `a9afd8d`：

```
Fix formatTable CJK alignment by using terminal display width

Replace .length with displayWidth() that correctly counts CJK/wide
characters as 2 columns. Add East Asian Width lookup function and use
it in column width calculation and padding logic. Tests verify CJK
headers (来源, 进程, 项目目录) now align with ASCII data rows.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```
