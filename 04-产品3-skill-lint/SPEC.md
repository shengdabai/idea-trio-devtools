# SkillLint — 技术规格 (SPEC)

## 1. 问题与需求

### 1.1 背景
Claude Code 生态里，`SKILL.md` / `CLAUDE.md` / `agents` / `commands` / `rules` 文件由大量用户手写，质量参差。常见质量问题肉眼难以系统化发现：

- `description` 写不好导致 skill 不被触发
- frontmatter 缺必填字段
- token 臃肿、烧 context
- 规则含糊（模糊量词）
- 缺示例 / 反例
- 单文件过大、难维护

### 1.2 目标用户
- 大量编写 skill / CLAUDE.md 的 Claude Code 重度用户
- 插件 / skill 作者
- 有内部 skill 规范的团队

### 1.3 核心需求
1. 递归扫描一个项目目录或 `~/.claude`，发现并分类目标文件。
2. 按文件类型套一套**可解释**的规则，给每个文件打 0-100 分。
3. 终端输出彩色评分表 + 每文件 Top 问题与修复建议。
4. 生成自包含 HTML 报告。
5. 提供 JSON 输出与 CI 门禁，方便集成。

### 1.4 非目标（本 MVP 不做）
- 自动修复（写在 Roadmap）
- 云端托管 / 看板
- 自定义规则配置文件
- 精确分词（用估算代替）

---

## 2. MVP 范围

### 2.1 命令
| 命令 | 行为 |
|---|---|
| `scan [path]` | 体检 + 终端彩色报告（默认 path=`.`）|
| `scan [path] --json` | 输出 JSON |
| `scan [path] --min-score n` | 均分 < n 时退出码 1（CI gate）|
| `report [path]` | 写 `skill-lint-report.html` 并尝试打开浏览器 |
| `report [path] --out f --no-open` | 自定义输出名 / 不自动打开 |
| `--version` / `--help` | 元信息 |

### 2.2 识别的文件类型与分类规则
| 类型 | 判定 |
|---|---|
| `skill` | 文件名 == `SKILL.md` |
| `claude-memory` | 文件名 == `CLAUDE.md` / `CLAUDE.local.md` |
| `agent` | 父目录或路径含 `agents` 的 `.md` |
| `command` | 父目录或路径含 `commands` 的 `.md` |
| `rule` | 父目录或路径含 `rules` 的 `.md` |

忽略目录：`node_modules`、`.git`、`dist`、`build`、`.next` 等。最大递归深度 12，跳过符号链接（防环）。

### 2.3 评分模型
- 每条规则返回 `{ id, title, weight, score(0..1), pass, severity, message, fix }`。
- 文件总分 = `round( Σ(weight × score) / Σweight × 100 )`。
- Top 问题 = 未通过规则，按 `weight × (1 - score)` 降序（影响最大者优先）。
- 汇总：文件数、平均分、按类型均分、最差/最佳文件、问题总数。

不同类型套不同规则集（见 `lib/rules.js` 的 DISPATCH）。例如 `CLAUDE.md` 用更严格的 token 预算规则（因每轮注入）。

---

## 3. 技术决策

### 3.1 运行时
- **Node.js ESM**，`engines.node >= 18`。
- **零运行时依赖**：安装快、攻击面小、便于审计。CLI 工具的依赖越少越可信。

### 3.2 解析
- 不引入 `js-yaml`：自带 `parseSimpleYaml`，支持 top-level `key: value`、块标量 `|`/`>`、`[a,b]` 与块列表。覆盖 skill / agent frontmatter 的真实形态即可。
- Markdown 只做浅层解析（标题、代码块、示例标记），不建完整 AST——按需够用原则。

### 3.3 token 估算
- 不引入 tokenizer。启发式：CJK 字符 ≈ 1 token，拉丁文本 ≈ 1 token / 4 字符。
- 明确标注为「估算」，报告中如实呈现。后续可选接入精确分词（Roadmap）。

### 3.4 颜色 / 输出
- 自实现极简 ANSI（`lib/colors.js`），尊重 `NO_COLOR`、非 TTY 自动降级。
- HTML 报告**完全自包含**（内联 CSS、无外部 `src`），可直接分享 / 归档，自测断言强校验这一点。

### 3.5 架构（文件小而多、纯函数、不可变）
```
bin/skill-lint.js      CLI 入口、参数解析、命令分发、退出码
lib/discover.js        递归发现 + 分类 + 读文件
lib/parse.js           frontmatter / markdown / token 解析
lib/rules.js           规则集（纯函数），按类型 dispatch
lib/scorer.js          单文件加权聚合 + 目录级汇总
lib/report-terminal.js 终端彩色渲染
lib/html-report.js     自包含 HTML 生成
lib/colors.js          ANSI 颜色 + 评分配色 + 字母等级
test/self-test.js      零依赖断言harness（29 项）
fixtures/good|bad      自测样本：好/差 SKILL.md
```
每个文件单一职责、< 400 行；规则为纯函数，输入上下文输出结果，便于单测与扩展。

### 3.6 错误处理
- 路径不存在 → 明确报错并非 0 退出码。
- 单文件读取失败 → 该文件标记 error，不中断整体扫描。
- 浏览器打开失败 → best-effort，绝不因此让命令失败。
- 未知命令 → 打印帮助 + 退出码 2。

### 3.7 安全
- 无任何密钥；不读取 `.env` / `*.key` 等机密文件（只读 `.md`）。
- 不执行被扫描文件中的任何内容（纯静态分析）。
- HTML 报告对所有动态内容做 HTML 转义，防注入。

---

## 4. 验收标准

1. `npm test` 全绿（29 断言）。
2. good fixture ≥ 80 分，bad fixture ≤ 45 分，二者差距 ≥ 40（核心保证：分数能正确区分好坏）。
3. 含全部 5 类文件的目录可被正确分类、分类均分输出正确。
4. `--json` 输出可被 `JSON.parse`。
5. `--min-score` 门禁退出码正确。
6. HTML 报告 `<!DOCTYPE html>` 开头、`</html>` 结尾、无外部 `src`、可在浏览器打开。

> 实测：good=100 / bad=32 / gap=68；全部 5 类文件分类正确；门禁退出码正确；HTML 9KB 自包含。
