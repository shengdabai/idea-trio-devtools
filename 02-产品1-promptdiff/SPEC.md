# promptdiff — SPEC

本文件记录 promptdiff 的需求、MVP 范围与技术决策。面向「未来要继续开发/审计这个
工具的工程师」（包括三个月后的作者本人）。

---

## 1. 需求（Requirements）

### 1.1 问题陈述

重度 Claude Code / Codex 用户频繁修改本地 AI 配置（`~/.claude`、`~/.codex`），但这些
配置：

- 没有版本历史 —— 改崩了不知道改了哪一处，回不去。
- 不可观测 —— 一次会话里动了十几个文件，无法回忆/审视。
- 跨机漂移 —— 多台设备的配置悄悄分叉，无人察觉。
- 隐性 —— 它本质是「和 AI 协作的源代码」，却从未被当成代码对待（无 diff / 无 review / 无回滚）。

### 1.2 目标用户

- 主要：单机重度 AI 编程用户（每天改配置、用 Opus/Codex 的人）。
- 次要：在多台机器间同步配置的个人；共用 prompt/rules 的小团队。

### 1.3 核心用户故事

1. 作为用户，我想在大改配置前存一个 baseline，以便事后对比。
2. 作为用户，我想知道「自上次保存以来我改了哪些配置文件、改了哪几行」。
3. 作为用户，我想要一份能在浏览器里慢慢翻、可折叠的 diff 报告。
4. 作为用户，我**绝对不想**让我的 API key / token / 私钥进入任何快照文件。

### 1.4 非功能需求

- **本地优先**：零网络、零账号、零上传。数据只落在 `~/.promptdiff/`。
- **零重依赖**：仅用 Node 内置模块，便于审计与移植。
- **机密零信任**：任何疑似机密一律不捕获，宁可漏配置不可漏密钥。
- **可恢复/可对比**：快照是自包含 JSON，可拷贝到别的机器再对比。
- **确定性**：同一配置状态两次 snapshot 的 `treeHash` 必须相同（文件排序稳定）。

---

## 2. MVP 范围（In / Out）

### 2.1 In Scope（本次交付）

- `snapshot [--label x]` —— 扫描 + 哈希 + 持久化为带时间戳 JSON。
- `list` —— 列出全部快照（最新在前）。
- `diff <a> <b>` —— 两快照逐文件 + 行级 diff，彩色终端。
- `diff <a>` / `diff` —— 快照 vs 当前实际配置。
- `report [<a> <b>]` —— 自包含 HTML（时间线 + 折叠逐文件 diff + 行级高亮）。
- `roots` —— 显示追踪范围。
- 三层机密防线（文件名 / 目录 / 内容兜底）。
- 一个隔离 fixtures 的 e2e 测试，覆盖 snapshot/diff 正确性 + 机密不泄露。

### 2.2 Out of Scope（明确不做，留给 Roadmap）

- 回滚写回（`restore`）—— MVP 只读，不改用户配置（避免不可逆破坏）。
- 后台监控 / 定时 snapshot（`watch`）。
- 云同步 / 账号 / 团队功能。
- 内容寻址去重存储（CAS）。
- 标准 unified-diff 导出 / `git apply`。
- 可视化报告里的「一键回滚」按钮（需本地小服务）。

**为何 `restore` 不进 MVP**：写回配置是不可逆的破坏性操作，MVP 阶段先把「可观测」这一
层价值跑通、建立信任，再做「可回滚」。符合「先 make something people love」的次序。

---

## 3. 技术决策（Technical Decisions）

### 3.1 语言与依赖

- **Node.js + 零运行时 npm 依赖**。理由：目标用户都装了 Node（Claude Code/Codex 生态）；
  零依赖让工具易审计（机密相关，依赖越少越可信）、易 `npm link` 分发、无供应链风险。
- 颜色/diff/解析全部手写，不引 `chalk`/`diff`/`commander`。

### 3.2 模块拆分（lib/ 小而多）

| 模块 | 职责 | 关键点 |
|------|------|--------|
| `config.js` | 单一数据源：追踪哪些 root、跳过什么、机密模式、存储路径 | 纯数据 + 纯函数（`isSecretPath` / `redactSecrets`），无副作用 |
| `scanner.js` | 递归扫描一个 root，产出文件描述符（含 sha256 + 内容） | 同步 `fs`；逐文件错误记为 `skipped` 不抛出；symlink 跳过防环 |
| `snapshot.js` | 快照的构建、持久化、列举、选择器解析、加载 | 快照 = JSON；`treeHash` 做 O(1) 等价比较；`snapshotCurrent` 不落盘 |
| `differ.js` | LCS 行级 diff + 快照级 added/removed/modified/unchanged | 纯函数；DP LCS；超大文件降级为整体 replace |
| `terminal.js` | ANSI 彩色渲染（非 TTY / `NO_COLOR` 自动关色） | 渲染与计算分离 |
| `html-report.js` | 自包含 HTML（内联 CSS/JS，HTML 转义） | 无 CDN / 无外链；转义防注入 |
| `cli.js` | 参数解析 + 命令分派 + 退出码 | 逻辑全在这里，`bin` 只是壳，便于测试 |
| `bin/promptdiff.js` | shebang 入口 | 仅 `process.exit(main(argv))` |

### 3.3 快照格式

```jsonc
{
  "format": 1,                 // 版本号，loadSnapshot 校验
  "id": "<ISO时间戳>-<6hex>",   // 文件名即此 id
  "label": "before-refactor",  // 可选
  "createdAt": "ISO8601",
  "roots": [{ "id":"claude", "label":"...", "dir":"..." }],
  "fileCount": 1906,
  "skippedCount": 389,
  "skipped": [{ "path":"...", "reason":"secret-firewall" | "redacted-N-..." | ... }],
  "treeHash": "sha256(所有文件 root/relPath:hash 排序后)",
  "files": [{ "root","relPath","ext","size","hash","redactions","content" }]
}
```

- `content` 保存（已脱敏的）原文，是行级 diff 的必要输入。
- `hash` 是脱敏后内容的 sha256，做快速相等判断。
- `treeHash` 让「两个快照是否完全相同」变成一次字符串比较。

### 3.4 扫描范围决策（重要）

朴素地「扫整个 `~/.claude`」会捕获 **13698 个文件 / 98MB**，把 `projects/`（会话日志）、
`plugins/`（第三方插件）、运行时 `data/` 全吞进去 —— diff 会被噪声淹没，且更容易碰到机密。

决策：
- **`~/.claude` 用 include 白名单**：只进 `agents/skills/rules/commands/hooks/output-styles/
  cli-modes/mcp-templates/design-systems` 这些**用户手写的配置子目录** + 根目录顶层文件。
- **`~/.codex` 也用 include**（`prompts/agents/skills/hooks`），并靠文件名防线挡掉顶层
  `auth.json`（含 `OPENAI_API_KEY` / `access_token` / `refresh_token`）。
- **SKIP_DIRS** 额外硬性排除 `projects/plugins/data/sessions/...` 等运行时目录，即使它们
  出现在白名单子目录深处也不进。

效果：从 13698 文件降到 ~1900，且全是真正「可 diff 才有意义」的授权配置。

### 3.5 机密防线（三层，含一次真实 bug 复盘）

1. **文件名层**（`SECRET_PATTERNS`）：`.env*`/`*.pem`/`*.key`/`credentials`/`secrets`/
   `id_rsa`/`auth`/`token`/`apikey`/`password`/`session`/`oauth` 等。
2. **目录层**（`SKIP_DIRS`）：运行时/安装目录整体不进。
3. **内容层**（`SECRET_CONTENT_PATTERNS` + `redactSecrets`）：对**值的形状**而非「sk- 这个词」
   做匹配（`sk-ant-…{20,}`、`sk-proj-…`、`ghp_…`、`AKIA…`、`AIza…`、JWT、PRIVATE KEY 块、
   `"access_token":"…"`），命中即替换为 `[REDACTED_SECRET]`；带结构的模式（access_token）
   保留 key 名与引号，让 diff 仍显示「此字段变过」。

> **开发期真实复盘**：第一版只有文件名层。首次对真实 `~/.codex` 做 snapshot 时，
> `auth.json` 被捕获，其中含 `OPENAI_API_KEY` / `id_token` / `access_token` / `refresh_token`。
> 「auth」当时不在文件名模式里 → 泄露。修复：①把 `auth/session/oauth` 加入文件名层；
> ②补内容层兜底（即便文件名无辜也按值形状脱敏）；③删除已泄露快照。
> e2e 现已锁死这两条回归（`auth.json firewalled by name` + `content redaction`）。
> 内容层故意只匹配「长高熵值」，所以教 AI「sk- 长这样」的文档不会被误伤。

### 3.6 Diff 算法

- 行级用经典 **LCS DP**（`O(n·m)`，配置文件几百行足够快）。
- `n·m > 4_000_000` 时降级为「整体删旧 + 整体加新」，避免病态内存。
- `toHunks(ops, context=3)` 把变更行聚成带上下文的 hunk，折叠长段相同行。
- 文件级状态：`added`（仅 B 有）/ `removed`（仅 A 有）/ `modified`（hash 不同）/
  `unchanged`（hash 相同）。

### 3.7 退出码约定

- `diff` 发现差异 → 退出码 1（便于脚本/CI 判断「配置变了没」）；无差异 → 0。
- 错误 → 1（带 `Error:` 前缀；`PROMPTDIFF_DEBUG=1` 打印栈）。
- 未知命令 → 2。

### 3.8 测试策略

- e2e 不碰真实 `~/.claude`：在系统临时目录造一个假配置树（含机密文件），扫两个状态、
  diff、断言计数与行级 stats，并**断言机密两层都没泄露**（文件名 + 内容）。
- 持久化 round-trip 测试用真实 store 但用完即删自己的快照文件。
- 15 个断言全绿才算通过。

---

## 4. 已知限制

- 仅追踪文本配置（`.md/.json/.toml/.yaml/.yml`），二进制/其它扩展名不在范围。
- `> 2MB` 的单文件跳过（记为 `too-large`），避免哈希巨型 blob。
- include 白名单是硬编码的（Roadmap：移到 `~/.promptdiff/config.json` 可配置）。
- 内容脱敏基于已知凭证形状，理论上无法覆盖所有自定义密钥格式 —— 故文件名层与目录层
  仍是第一道、也是更强的防线。
