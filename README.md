# idea-trio-devtools

Three small, dependency-light tools built while testing a "small, sharp, local-first" product method with AI coding agents.

| Folder | Tool | What it does | Run |
|---|---|---|---|
| `02-产品1-promptdiff/` | **promptdiff** | Snapshot, diff and timeline for your Claude Code / Codex configuration (`CLAUDE.md`, `settings.json`, hooks, agents, skills, rules). Secrets are redacted before anything is written. | `node bin/promptdiff.js --help` · tests: `node --test test/` |
| `03-产品2-cardstack/` | **CardStack** | Type a title and a few bullet points, get a styled knowledge card or long image, export as PNG. Pure front end, works offline, nothing is uploaded. | open `index.html` · checks: `node verify.js` |
| `04-产品3-skill-lint/` | **SkillLint** | Scores `SKILL.md` / `CLAUDE.md` / agents / commands / rules (0–100) with explainable rules and writes a self-contained HTML report. | `node bin/skill-lint.js scan <dir>` · tests: `node test/self-test.js` |

Each folder has its own `README.md` (Chinese) and `SPEC.md`.

## 中文说明

三个小工具，都是零重依赖、本地优先：

- **promptdiff**：给 AI 编程配置做快照、可视化 diff 和时间线，写入前先遮蔽密钥。
- **CardStack**：输入标题和要点，生成风格统一的知识卡片，导出 PNG；纯前端、离线可用、不上传。
- **SkillLint**：按可解释的规则给 Claude Code 生态文件打分，输出 HTML 体检报告。

详细说明见各目录的 `README.md` 和 `SPEC.md`。

## License

- Code: MIT, see [`LICENSE`](LICENSE).
- Fonts in `03-产品2-cardstack/fonts/` (Inter, Noto Sans SC, Noto Serif SC): SIL Open Font License 1.1, see [`fonts/OFL.txt`](03-产品2-cardstack/fonts/OFL.txt).
- `03-产品2-cardstack/vendor/html-to-image.js`: MIT, from [bubkoo/html-to-image](https://github.com/bubkoo/html-to-image).
