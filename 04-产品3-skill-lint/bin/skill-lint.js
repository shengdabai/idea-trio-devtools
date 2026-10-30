#!/usr/bin/env node
// bin/skill-lint.js
// SkillLint CLI entry point. Zero runtime dependencies.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { discover } from '../lib/discover.js';
import { scoreAll, summarize } from '../lib/scorer.js';
import { renderTerminal } from '../lib/report-terminal.js';
import { buildHtml } from '../lib/html-report.js';
import { colors } from '../lib/colors.js';

const VERSION = '0.1.1';

const HELP = `${colors.bold('SkillLint')} v${VERSION} — Claude Code 生态文件体检 CLI

${colors.bold('用法:')}
  skill-lint scan [path]            扫描并在终端打印评分表 + 修复建议 (默认 path=.)
  skill-lint report [path]          生成自包含 HTML 报告到 ./skill-lint-report.html
  skill-lint scan [path] --json     以 JSON 输出原始评分数据 (便于 CI / 二次加工)
  skill-lint --version              打印版本
  skill-lint --help                 打印帮助

${colors.bold('选项:')}
  --json                  输出 JSON 而非彩色表格 (仅 scan)
  --out <file>            指定 report 的输出文件名 (默认 skill-lint-report.html)
  --min-score <n>         scan 时若平均分低于 n 则以退出码 1 结束 (CI gate)
  --allow-empty           配合 --min-score: 允许「未发现文件」通过门禁 (默认空结果=失败)
  --no-open               report 生成后不自动打开浏览器

${colors.bold('识别的文件类型:')}
  SKILL.md · CLAUDE.md / CLAUDE.local.md · agents/*.md · commands/*.md · rules/*.md

${colors.bold('示例:')}
  skill-lint scan ~/.claude
  skill-lint scan ./my-plugin --json > scores.json
  skill-lint report .
`;

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.flags.json = true;
    else if (a === '--no-open') args.flags.noOpen = true;
    else if (a === '--out') args.flags.out = argv[++i];
    else if (a === '--allow-empty') args.flags.allowEmpty = true;
    else if (a === '--min-score') {
      // CI gate input must be a real 0-100 number. A missing or malformed
      // value used to become NaN and silently switch the gate off (exit 0).
      const raw = argv[++i];
      const value = typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
      if (Number.isNaN(value) || value > 100) {
        args.error = `--min-score 需要 0-100 的数字，收到: ${raw === undefined ? '(缺失)' : raw}`;
      } else {
        args.flags.minScore = value;
      }
    }
    else if (a === '--version' || a === '-v') args.flags.version = true;
    else if (a === '--help' || a === '-h') args.flags.help = true;
    else args._.push(a);
  }
  return args;
}

async function gather(targetPath) {
  const entries = await discover(targetPath);
  const results = await scoreAll(entries);
  const summary = summarize(results);
  return { results, summary };
}

async function cmdScan(targetPath, flags) {
  const { results, summary } = await gather(targetPath);

  if (flags.json) {
    const payload = {
      root: path.resolve(targetPath),
      version: VERSION,
      summary,
      files: results.map((r) => ({
        path: r.path,
        type: r.type,
        score: r.score,
        bytes: r.bytes,
        error: r.error || null,
        findings: r.findings.map((f) => ({
          id: f.id,
          title: f.title,
          weight: f.weight,
          score: Number(f.score.toFixed(3)),
          pass: f.pass,
          severity: f.severity,
          message: f.message,
          fix: f.fix,
        })),
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(renderTerminal(results, summary, targetPath) + '\n');
  }

  if (typeof flags.minScore === 'number' && !Number.isNaN(flags.minScore)) {
    // CI gate. An empty result set is NOT a pass — "scanned the wrong path"
    // must not masquerade as "everything is above threshold". Fail unless the
    // caller explicitly opted in with --allow-empty.
    if (results.length === 0 && !flags.allowEmpty) {
      process.stderr.write(
        colors.red(
          `\n--min-score 已设置，但未发现任何可体检文件 — 可能扫错了路径。退出码 1。\n` +
            `  若确实允许空结果，加 --allow-empty。\n`
        )
      );
      return 1;
    }
    if (results.length > 0 && summary.average < flags.minScore) {
      process.stderr.write(
        colors.red(
          `\n平均分 ${summary.average} 低于阈值 ${flags.minScore} — 退出码 1\n`
        )
      );
      return 1;
    }
  }
  return 0;
}

async function cmdReport(targetPath, flags) {
  const { results, summary } = await gather(targetPath);
  const html = buildHtml(results, summary, targetPath);
  const outName = flags.out || 'skill-lint-report.html';
  const outPath = path.resolve(process.cwd(), outName);
  await fs.writeFile(outPath, html, 'utf8');

  process.stdout.write(
    '\n' +
      colors.green('✓ ') +
      `HTML 报告已生成: ${colors.cyan(outPath)}\n` +
      colors.gray(
        `  ${summary.count} 个文件 · 平均 ${summary.average} 分 · ${summary.totalIssues} 处可改进\n\n`
      )
  );

  if (!flags.noOpen) {
    await tryOpen(outPath);
  }
  return 0;
}

async function tryOpen(filePath) {
  const platform = process.platform;
  const opener =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const { spawn } = await import('node:child_process');
    const child = spawn(opener, [filePath], {
      stdio: 'ignore',
      detached: true,
      shell: platform === 'win32',
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Best-effort only; never fail the command because the browser didn't open.
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.error) {
    process.stderr.write(colors.red(`参数错误: ${args.error}\n`));
    return 2;
  }

  if (args.flags.version) {
    process.stdout.write(`skill-lint v${VERSION}\n`);
    return 0;
  }
  if (args.flags.help || args._.length === 0) {
    process.stdout.write(HELP + '\n');
    return 0;
  }

  const [command, pathArg] = args._;
  const targetPath = pathArg || '.';

  try {
    switch (command) {
      case 'scan':
        return await cmdScan(targetPath, args.flags);
      case 'report':
        return await cmdReport(targetPath, args.flags);
      default:
        process.stderr.write(
          colors.red(`未知命令: ${command}\n\n`) + HELP + '\n'
        );
        return 2;
    }
  } catch (error) {
    process.stderr.write(colors.red(`错误: ${error.message}\n`));
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(colors.red(`未捕获错误: ${error.stack || error}\n`));
    process.exit(1);
  });
