# promptdiff

> 给你的 AI 编程配置做「快照 + 可视化 diff + 时间线」。
> **配置即资产 · 可观测 · 可回滚 · 可对比。**

`promptdiff` 是一个本地优先（local-first）的零重依赖 Node.js CLI。它把你的
`~/.claude`（`CLAUDE.md`、`settings.json`、`hooks`、`agents/*`、`skills/*`、`rules/*`、
`commands/*` …）和 `~/.codex` 配置做成一个个带时间戳的快照，让每一次改动都
**可见、可对比、可回滚**。

```
$ promptdiff snapshot --label "before-refactor"
$ # ……改了一堆 CLAUDE.md / rules / hooks，结果 Claude 行为变怪了……
$ promptdiff diff latest        # 我到底改了啥？
$ promptdiff report             # 生成一份能在浏览器里翻的 HTML diff 报告
```

---

## 为什么有人要（真实痛点）

重度 Claude Code / Codex 用户（比如本工具的作者本人）几乎每天都在改配置：
调 `CLAUDE.md`、加 hook、改 rules、装 skill、调模型路由……

然后就会遇到：

- **改崩了不知道改了啥**：Claude 突然行为变怪，但你这几天动过十几个文件，回忆不起来是哪一处。
- **回不去**：没有版本可回滚，只能凭记忆手动还原，越还原越乱。
- **多机器配置漂移**：Mac Studio 和 MacBook 上的 `~/.claude` 早就不一样了，但你不知道差在哪。
- **隐性知识不可见**：配置是你和 AI 协作的「源代码」，但它从来没有被当成代码一样对待——没有 diff、没有历史、没有 review。

`promptdiff` 把这层隐性的、易碎的、不可观测的配置，变成**显性的、可对比的、可回滚的资产**。

---

## 对应的刘小排方法论

这个产品是刘小排（Raphael AI 创始人，AI 编程一人公司）几条核心原则的直接落地：

| 刘小排原则 | 在 promptdiff 里的体现 |
|-----------|----------------------|
| **配置即资产** | 你的 prompt / rules / hooks 是和 AI 协作的源代码，值得被版本化、被珍惜，而不是随手改了就忘。 |
| **可观测性优先** | 改动看不见 = 不可控。先让每一次 config 变更「可见」，才谈得上优化它。 |
| **把隐性知识显性化** | 「我上周到底怎么调的」这种只存在脑子里的隐性知识，被沉淀成可检索的快照时间线。 |
| **需求来自真实痛点（翻石头）** | 这个产品的需求不是想出来的，是作者自己被「改崩了回不去」反复硌到，翻出来的石头。 |
| **最小可用、本地优先** | 不做云、不做账号、不做订阅墙。先用零依赖 CLI 把核心价值（snapshot→diff→回滚信号）跑通。 |

---

## 功能清单

| 命令 | 作用 |
|------|------|
| `promptdiff snapshot [--label x]` | 扫描配置目录，把所有 `.md/.json/.toml/.yaml` 文件内容哈希 + 存为带时间戳的快照（JSON）到 `~/.promptdiff/snapshots/`。 |
| `promptdiff list` | 列出所有快照（最新在前），含创建时间、文件数、tree 哈希。 |
| `promptdiff diff <a> <b>` | 两个快照间逐文件 diff（新增 / 删除 / 修改），带行级 diff 和彩色终端输出。 |
| `promptdiff diff <a>` | 某个快照 vs **当前实际配置**（"我自上次保存以来改了啥？"）。 |
| `promptdiff diff` | 最新快照 vs 当前配置（最常用的快捷形式）。 |
| `promptdiff report [<a> <b>]` | 生成一个**自包含 HTML 报告**（时间线 + 折叠式逐文件 diff + 行级高亮）到 `~/.promptdiff/report.html`，可直接浏览器打开。 |
| `promptdiff restore <id> [--dry-run]` | 把某个快照**安全地写回**配置目录（实现「可回滚」）。`--dry-run` 先预览将写哪些文件、不动磁盘；正式回滚前会**自动先存一个 pre-restore 快照**，所以回滚本身也可被回滚。含 `[REDACTED_SECRET]` 的文件**永不**写回（避免占位符覆盖真实凭证）。 |
| `promptdiff roots` | 显示当前被追踪的配置目录与扩展名。 |
| `promptdiff help` / `version` | 帮助 / 版本。 |

**选择器（`<a>` / `<b>`）支持**：完整快照 id、id 前缀、序号（`1` = 最新）、`latest` / `HEAD`、或你用 `--label` 起的名字。

### 机密防线（双层 + 内容兜底，三道）

这是本工具最重要的设计约束——**绝不快照机密内容**：

1. **文件名防线**：跳过 `.env*`、`*.pem`、`*.key`、`*.crt`、`credentials.*`、`secrets.*`、
   `id_rsa*`、`.netrc`、`.npmrc`、`auth.json`、含 `token`/`apikey`/`password`/`session` 字样的文件。
2. **目录防线**：不进入 `projects/`（会话日志）、`plugins/`（第三方装的插件）、`data/`、
   `node_modules`、`cache`、`logs` 等运行时/安装数据目录——只追踪**你手写的配置**。
3. **内容兜底防线**：即便文件名无辜（一个 `.md` 文档、一个 `settings.json`），只要正文里出现
   **形如真实凭证的高熵值**（`sk-ant-…`、`sk-proj-…`、`ghp_…`、AWS key、JWT、`"access_token":"…"`），
   也会在写入快照前替换为 `[REDACTED_SECRET]`，并保留 JSON 结构让 diff 仍能看见「这个字段变过」。

---

## 安装 / 运行

### 直接跑（无需安装）

```bash
cd 产品1-promptdiff
node bin/promptdiff.js snapshot --label first
node bin/promptdiff.js diff latest
node bin/promptdiff.js report
open ~/.promptdiff/report.html
```

### 作为全局命令安装

```bash
cd 产品1-promptdiff
npm link            # 或 npm install -g .
promptdiff snapshot
promptdiff list
```

### 跑测试

```bash
npm test            # 等价于 node test/e2e.test.js
```

测试用一个隔离的临时 fixtures 目录验证 snapshot + diff 的正确性，并断言机密文件
（文件名 + 正文两层）确实没有被捕获。

### 环境要求

- Node.js ≥ 16（推荐 v18+）。零 npm 运行时依赖（只用 Node 内置模块）。

---

## 典型工作流

```bash
# 1. 每次准备大改配置前，先存一个 baseline
promptdiff snapshot --label before-big-refactor

# 2. 一通修改之后，Claude 行为变了 —— 看看到底改了啥
promptdiff diff before-big-refactor

# 3. 想要一份能慢慢翻、能折叠看的报告
promptdiff report before-big-refactor

# 4. 确认是这次改动改崩的 —— 先 dry-run 预览，再一键回滚到 baseline
promptdiff restore before-big-refactor --dry-run   # 预览将写哪些文件，不动磁盘
promptdiff restore before-big-refactor             # 正式回滚（会自动先存 pre-restore 快照）

# 5. 跨机器定位配置漂移
#    把 A 机的 ~/.promptdiff/snapshots/<id>.json 拷到 B 机的任意位置，
#    然后用【完整文件路径】互相 diff（见下方「跨机器对比」注意事项）：
promptdiff diff /path/to/machineA-snapshot.json /path/to/machineB-snapshot.json
```

> **跨机器对比（重要）**：序号（`1`/`2`）、`latest`/`HEAD`、id 前缀、`--label` 这些**简写选择器只解析本机** `~/.promptdiff/snapshots/` 里的快照。从另一台机器拷过来的外来快照 JSON **不会**被简写选择器找到——对它必须传**完整文件路径**（如 `promptdiff diff ./machineA.json latest`）。这是 local-first 的有意设计：简写永远指向本机时间线，外来文件用路径显式引用。

---

## 变现思路

本工具本身是 local-first 免费内核（建立信任 + 自然传播），变现走「上层服务」而非「卡免费功能」：

1. **Pro 桌面/菜单栏版（一次性买断或订阅）**：自动定时 snapshot、配置变更后台监控、
   GUI 化的一键回滚（CLI 的 `restore` 已开源免费，Pro 提供可视化对比 + 选择性回滚）、改动通知。$5–9/月 或 $39 买断。
2. **团队 / 多机同步云（订阅）**：把 snapshot 推到私有云，跨机器对比 + 漂移告警 +
   团队共享「黄金配置」基线。面向有多人共用 prompt/rules 的小团队，$10–20/席/月。
3. **配置市场 / 模板（一次性）**：把高质量的 `CLAUDE.md` / rules / agents 组合打包成可
   diff-apply 的「配置包」出售，promptdiff 负责安全地预览+套用。
4. **企业合规版（年费）**：审计 AI 配置变更历史（谁、何时、改了哪条 rule），满足
   「AI 使用可追溯」的内控需求。

护城河来自：**本地零依赖内核免费 → 海量个人用户 → Pro/团队/合规层收费**，符合刘小排
「make something people love，再谈商业化」的次序。

---

## 后续路线（Roadmap）

- [x] `promptdiff restore <id> [--dry-run]`：把某个快照安全地写回配置目录（带 dry-run 预览 + 自动先存一个 pre-restore 快照）。**已实现。**
- [ ] `promptdiff watch`：后台监控配置目录，变更即自动 snapshot（debounce）。
- [ ] `promptdiff diff <a> <b> --root claude`：按 root / 子目录 / glob 过滤 diff 范围。
- [ ] 多机漂移模式：`promptdiff drift <machineA.json> <machineB.json>`。
- [ ] 导出 patch：`promptdiff patch <a> <b>` 生成标准 unified diff，可走 `git apply`。
- [ ] 可配置 `~/.promptdiff/config.json`：自定义 roots / include / 扩展名 / 机密模式。
- [ ] HTML 报告里直接「回滚此文件到 base 版本」的一键按钮（配合本地小服务）。
- [ ] 压缩存储：快照内容做内容寻址去重（CAS），长期时间线不膨胀。

---

## 设计原则

- **本地优先**：所有数据只在 `~/.promptdiff/`，不联网、不上传、无账号。
- **零重依赖**：只用 Node 内置模块（`fs`/`crypto`/`path`/`os`），易审计、易移植。
- **机密零信任**：宁可漏报一个配置文件，也绝不捕获一个机密值。
- **不可变风格**：核心模块为纯函数，输入不被原地修改，便于测试。

MIT License.

---

## 开发记录

### 评审打磨（v0.1）

针对一轮代码评审的「必须修复项（mustFix）」逐条收口，核心是**消除名实不符**并加固正确性：

1. **`restore` 价值闭环（P0）**：README 把「可回滚」列为头号卖点，但此前 `restore` 只活在
   Roadmap。现已实现 `promptdiff restore <id> [--dry-run]`：dry-run 只预览不动磁盘；正式
   回滚前**自动先存一个 pre-restore 快照**（回滚本身可被回滚）；含 `[REDACTED_SECRET]` 的
   文件**永不写回**（避免占位符覆盖真实凭证）；回滚只写快照内的文件、从不删除多余的 live 文件。
   README 的 slogan / 功能清单 / 典型工作流 / Roadmap / 变现思路同步更新，「可回滚」从承诺变成实现。

2. **二进制 / 非 UTF-8 文件不再静默损坏（P1）**：扫描读原始 `Buffer`，经
   `decodeUtf8()` 双重校验——(a) 含 NUL 字节直接判为二进制，(b) `decode → re-encode → 逐字节比对`
   round-trip，不通过即判为非法 UTF-8。失败的文件被 **skip 并记 reason**（`binary-nul-byte` /
   `invalid-utf8`），不再用 U+FFFD 替换字符污染 hash 与 diff。

3. **LCS 守卫同时限行数与字节数（P1）**：除原有的 `n*m` DP 单元上限（`MAX_LCS_CELLS`），新增
   `MAX_LCS_BYTES`（4 MB 总输入）。「少量超长行」和「2000×2000 短行（约 64MB DP 表）」两类
   病态输入都会触发降级为粗粒度 replace-all diff，而非分配大表。

4. **选择器失败语义可区分（P2）**：`resolveSelector` 不再对所有失败统一返回 null 让上层抛
   「Snapshot not found」。现在数字越界抛 `RangeError`（提示快照总数与可用区间）、前缀/label
   多命中抛带 `.ambiguous` 标记的错误并**列出候选 id**、确实没命中才落到「not found」。三类
   失败各有可操作的提示，退出码均为 1。

5. **发布卫生（P2）**：补 `.gitignore`（忽略 `node_modules/`、运行时 `.promptdiff/`、机密文件、
   内部状态文件）、`git init`，并把 `test/` 加入 `package.json` 的 `files` 白名单，使 npm
   安装者能按 README 跑 `npm test`。

6. **跨机漂移文档对齐（P3）**：明确「简写选择器（序号 / `latest` / 前缀 / `--label`）只解析
   本机快照」，外来快照必须用**完整文件路径**引用——见上方「典型工作流」末尾的「跨机器对比」注意事项。

#### 自验

- `npm test` → 15/15 通过。
- 隔离 HOME 沙箱端到端冒烟：`snapshot → diff → restore --dry-run → restore` 全链路跑通；
  含 NUL 的 `binary.md` 被 `binary-nul-byte` 跳过；dry-run 不动磁盘、真实 restore 正确回滚
  被改文件并重建被删文件、自动生成 pre-restore 安全快照；out-of-range / ambiguous / not-found
  三类选择器各自给出对应错误且退出码为 1；LCS 字节守卫在超长输入上正确降级。
