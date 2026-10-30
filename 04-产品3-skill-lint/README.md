# SkillLint 🩺

> 体检你的 Claude Code 生态文件——`SKILL.md` / `CLAUDE.md` / `agents` / `commands` / `rules`，按一套**可解释**的规则打分（0-100），给出每个文件的 Top 问题与修复建议，并生成一份自包含 HTML 报告。

零重依赖的 Node CLI。一行命令，把「装了一堆 skill 不一定更强」从玄学变成**可量化、可观测**。

---

## 为什么有人要它

Claude Code 生态爆发，人人都在写 skill / CLAUDE.md / agent，但质量参差不齐：

- `description` 写不好 → skill 根本不被触发（最隐蔽、最致命）
- frontmatter 缺 `name` / `description` → Claude 可能直接不加载
- 文件 token 臃肿 → 每次加载都在烧 context、烧钱（`CLAUDE.md` 尤甚，每轮都注入）
- 规则含糊（「尽量」「适当」「一些」）→ 模型无所适从，行为不可控
- 没有示例 / 反例 → 模型缺少可模仿的锚点

这些问题肉眼很难系统化发现。**SkillLint 一键体检给分**，并明确告诉你「错在哪、为什么、怎么改」。

---

## 对应的刘小排方法论

| 刘小排原则 | SkillLint 如何体现 |
|---|---|
| **给开发者/创业者用的工具** | 面向正在大量写 skill 的 Claude Code 用户、插件作者、AI 出海团队 |
| **把模糊变成可量化、可观测** | 把「skill 好不好」量化成 0-100 分 + 字母等级 + 加权规则明细 |
| **解决一个真实、具体、高频的痛点** | description 不触发 / 文件臃肿是生态里**人人都会踩**的坑 |
| **可解释，不做黑箱** | 每条规则都说明「检查了什么 + 为什么重要 + 如何修复」，没有不可解释的扣分 |
| **极小可用** | 零依赖、单命令、几秒出结果；不需要配置、不需要 API key |

---

## 功能清单

- `skill-lint scan [path]` — 递归发现并体检，终端输出**彩色评分表** + 每文件 Top 问题与修复建议
- `skill-lint report [path]` — 生成**自包含 HTML 报告**（评分卡片 + 逐文件 findings 折叠），写到当前目录 `skill-lint-report.html`，并自动在浏览器打开
- `skill-lint scan [path] --json` — 输出原始评分 JSON，便于 CI / 二次加工
- `--min-score <n>` — CI 门禁：平均分低于阈值则退出码 1
- 自动识别 5 类文件：`SKILL.md` · `CLAUDE.md` / `CLAUDE.local.md` · `agents/*.md` · `commands/*.md` · `rules/*.md`
- 针对不同类型套用不同规则（如 `CLAUDE.md` 因每轮注入而对 token 预算更严格）

### 评分规则（节选，均可解释、带权重）

| 规则 | 适用类型 | 检查什么 |
|---|---|---|
| frontmatter 必填字段 | skill / agent | `name` / `description` 是否完整 |
| description 质量 | skill / agent / command | 是否含触发场景（Use when…）、长度是否适中 |
| 标题结构 | 全部 | 是否有 `##` 层级、可扫读 |
| token 体量 | 全部 | 估算 token，惩罚臃肿 **与** 空壳 |
| CLAUDE.md token 预算 | CLAUDE.md / rules | 更严格预算（每轮注入，直接乘对话轮数烧钱）|
| 模糊量词 | 全部 | 「尽量/适当/一些/sometimes/usually」等含糊表述 |
| 示例 / 反例 | skill / command | 是否有代码块或 `<example>` |
| 文件体积 | 全部 | 单文件 KB，鼓励高内聚低耦合 |

> token 估算针对中英混排做了校准（CJK ≈ 1 token/字，拉丁 ≈ 1 token/4 字符），是**估算**而非精确分词，报告中如实标注。

---

## 安装 / 运行

需要 Node ≥ 18（开发用 v24 验证）。零运行时依赖。

```bash
# 直接用源码跑（无需 install）
cd 产品3-skill-lint
node bin/skill-lint.js scan ~/.claude

# 或全局安装为 skill-lint 命令
npm install -g .
skill-lint scan ~/.claude
skill-lint report .
```

### 常用示例

```bash
skill-lint scan ~/.claude               # 体检你的全局 Claude 配置
skill-lint scan ./my-plugin             # 体检某个插件仓
skill-lint report .                     # 生成 HTML 报告并打开
skill-lint scan . --json > scores.json  # 导出 JSON 给 CI
skill-lint scan . --min-score 70        # CI 门禁：均分 < 70 失败
```

### 自测

```bash
npm test
# 验证：good fixture 高分、bad fixture 低分、二者差距明显、HTML 自包含等 29 项断言
```

---

## 变现思路

SkillLint 本体开源做获客与口碑（开发者工具的标准打法），变现在「规模化 + 协作 + 托管」三层：

1. **SkillLint Pro（订阅）**
   - 自定义规则集 / 团队规则模板（公司统一 skill 规范）
   - 历史趋势：每次提交记录分数，可视化「我的 skill 库越来越健康」
   - 自动修复（`--fix`）：不止提示，直接帮你改 description / 拆文件
2. **CI / GitHub Action（团队付费）**
   - PR 里自动跑 SkillLint，分数低于阈值挡合并；评论里贴出 findings
   - 面向有大量内部 skill / agent 的中大团队
3. **SaaS 看板（托管）**
   - 把 `~/.claude` 或仓库连上来，云端持续体检 + 排行榜 + 最佳实践推荐
   - 生态市场：给 skill 作者发「健康度徽章」，给使用者一个挑 skill 的客观信号
4. **咨询 / 模板包**
   - 「高分 skill 写作模板」「CLAUDE.md 瘦身套件」作为信息产品出售

刘小排式判断：先用免费 CLI 把「skill 质量可观测」这件事做成开发者共识，再在共识上叠加付费的协作与自动化。

---

## 后续路线（Roadmap）

- [ ] `--fix`：自动补 frontmatter、把模糊量词标注出来、拆分超长文件
- [ ] 自定义规则配置（`.skilllintrc`），团队可加/调权重
- [ ] 更精确的 token 计数（可选接入 tokenizer，默认仍走零依赖估算）
- [ ] 规则插件机制：第三方可注册规则
- [ ] GitHub Action 封装 + PR 评论
- [ ] 历史快照与趋势图（分数随时间变化）
- [ ] 支持 plugin marketplace 清单 / MCP server 配置体检
- [ ] 多语言 description 检测（中英双触发词覆盖度）

---

## 设计取舍

- **零依赖**：`parse.js` 自带一个 YAML 子集解析器，不引入 `js-yaml`，安装快、攻击面小。
- **文件小而多**：`discover` / `rules` / `scorer` / `report-terminal` / `html-report` 各司其职，单文件 < 400 行。
- **纯函数风格**：每条规则是纯函数，输入上下文输出结果，便于测试与扩展；不可变数据。
- **可解释优先**：宁可规则少而清晰，也不做「神秘扣分」。

许可证：MIT。

---

## 开发记录

### v0.1.1 — 评分引擎抗 gaming + 真实区分度修复（针对评审 mustFix）

一轮对抗式评审指出评分模型「易满分、易 gaming、对真实文件无区分度」——核心卖点没立住。本次按优先级逐条修复：

1. **[致命] 内容空壳不再拿满分**（`lib/rules.js` + `lib/parse.js`）
   - `description` 评分从「长度 ≥40 + 子串命中」升级为**信息密度**判定：检测触发词堆砌（≥5 个 hint 词 / 内容词重复 / 低独立词占比且无动词结构），堆砌视为 gaming，硬上限 0.45。
   - `hasExample` 要求代码块**非空**——空 ```` ``` ```` 不再算「有示例」。
   - `ruleStructure` 不再只数 `##`，而是测「小节是否真的有正文」（`bodyContentTokens`），空标题结构只给 0.4。
   - `ruleLength` 的空壳地板改为只看**正文实质 token**（排除 frontmatter），堆词的长 description 不能再为空正文遮羞。
   - 新增 `fixtures/gamer/`（堆触发词 + 空代码块 + 单字母标题的空壳），实测从 100 → 55，并加入自测断言锁定。

2. **[严重] 真实文件重新校准出区分度**（`lib/rules.js` + `lib/scorer.js`）
   - `mkRule` 的 `pass` 从浮点严格相等 `>=0.999` 改为 `>=0.85`（`PASS_THRESHOLD`），找回中间灰度。
   - 收紧各规则顶档：token / 文件体积 / CLAUDE.md 预算都加了「健康但非最优 = 0.9/0.85」的中间带。
   - 给 `rule` / `CLAUDE.md` 类型新增 `ruleActionable` 维度（是否含示例 / do-don't / 分步指令）。
   - Dogfood `~/.claude`：agent 均分 76、command 77、skill 86，全局仅 5% 满分（修复前真实 rules 目录过半 100、avg 95）。

3. **[严重] 自写 YAML parser 支持一层嵌套 mapping**（`lib/parse.js:parseSimpleYaml`）
   - `metadata:` 下的缩进子键现在能正确解析为子对象，不再误报 parseError。
   - 即便遇到更深结构无法解析，只要必填字段齐全就**不扣分**（降级为「未检查」=0.95），不再把工具局限当成文件缺陷。

4. **[中] CJK / emoji token 估算修复代理对**（`lib/parse.js:estimateTokens`）
   - 改用 `for..of` 按 Unicode 码点迭代 + `\p{Script=Han}` 等属性转义；CJK 扩展 B、emoji 现在各算 1 个单位，不再被当成 2 个拉丁字符。

5. **[中] 空目录不再静默放行 CI 门禁**（`bin/skill-lint.js`）
   - `--min-score` 且未发现任何文件时退出码 1（防「扫错路径」伪装成「达标」）；需显式 `--allow-empty` 才放行。

6. **[低] 终端列对齐去掉魔法数**（`lib/report-terminal.js`）
   - 评分列改为「先 pad 纯文本再上色」，删除 `+9 width fudge`；NO_COLOR 与彩色模式下列均对齐。

**自验**：`node test/self-test.js` → **38 passed, 0 failed**（原 29 + 新增 9 条锁定 gamer/空代码块/代理对/嵌套 YAML）。命令矩阵 scan/report/json/help/version 全过，bad-path 退 1、unknown-cmd 退 2、min-score 门禁退 1，HTML 报告自包含。
