// lib/report-terminal.js
// Render scored results as a colored terminal table + per-file top issues.

import path from 'node:path';
import { colors, scoreColor, grade } from './colors.js';

function pad(str, width) {
  const s = String(str);
  // Visible length ignoring ANSI escape sequences.
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '').length;
  if (visible >= width) return s;
  return s + ' '.repeat(width - visible);
}

function bar(score) {
  const filled = Math.round(score / 10);
  const color = scoreColor(score);
  return color('█'.repeat(filled)) + colors.gray('░'.repeat(10 - filled));
}

const SEV_ICON = {
  error: colors.red('✗'),
  warn: colors.yellow('▲'),
  ok: colors.green('✓'),
};

export function renderTerminal(results, summary, rootPath) {
  const out = [];
  const root = path.resolve(rootPath);

  out.push('');
  out.push(colors.bold(colors.cyan('  SkillLint · Claude Code 生态体检')));
  out.push(colors.gray(`  扫描根目录: ${root}`));
  out.push('');

  if (results.length === 0) {
    out.push(colors.yellow('  未发现可体检的文件。'));
    out.push(
      colors.gray(
        '  支持: SKILL.md / CLAUDE.md / agents/*.md / commands/*.md / rules/*.md'
      )
    );
    out.push('');
    return out.join('\n');
  }

  // Scoreboard
  out.push(
    '  ' +
      colors.bold(pad('文件', 46)) +
      colors.bold(pad('类型', 12)) +
      colors.bold(pad('评分', 8)) +
      colors.bold('进度条')
  );
  out.push('  ' + colors.gray('─'.repeat(86)));

  const SCORE_COL = 8;
  const sorted = [...results].sort((a, b) => a.score - b.score);
  for (const r of sorted) {
    let rel = path.relative(root, r.path) || path.basename(r.path);
    if (rel.length > 44) rel = '…' + rel.slice(-43);
    const sc = scoreColor(r.score);
    // Build the PLAIN cell first, pad to visible width, THEN colorize. This
    // keeps the column aligned regardless of ANSI codes or NO_COLOR, instead of
    // hand-tuning a "+9 for color codes" fudge that breaks when colors are off.
    const scorePlain = `${String(r.score).padStart(3)} ${grade(r.score)}`;
    const scoreCell = sc(pad(scorePlain, SCORE_COL));
    out.push(
      '  ' +
        pad(r.error ? colors.red(rel) : rel, 46) +
        colors.gray(pad(r.typeLabel, 12)) +
        scoreCell +
        bar(r.score)
    );
  }

  // Summary
  out.push('');
  const avgColor = scoreColor(summary.average);
  out.push(
    '  ' +
      colors.bold('总览: ') +
      `${summary.count} 个文件 · 平均 ` +
      avgColor(`${summary.average} (${grade(summary.average)})`) +
      ` · 共 ${summary.totalIssues} 处可改进`
  );
  const typeBits = Object.entries(summary.byType)
    .map(([k, v]) => `${k} ${scoreColor(v.average)(v.average)}(${v.count})`)
    .join('  ');
  out.push('  ' + colors.gray('分类均分: ') + typeBits);

  // Per-file top issues (only files that have issues)
  out.push('');
  out.push('  ' + colors.bold('逐文件 Top 问题与修复建议'));
  out.push('  ' + colors.gray('─'.repeat(86)));

  let anyIssues = false;
  for (const r of sorted) {
    if (r.error) {
      out.push(
        '  ' +
          colors.red('✗ ') +
          colors.bold(path.relative(root, r.path)) +
          colors.red(`  读取失败: ${r.error}`)
      );
      anyIssues = true;
      continue;
    }
    if (r.issues.length === 0) continue;
    anyIssues = true;
    const rel = path.relative(root, r.path) || path.basename(r.path);
    out.push(
      '  ' +
        scoreColor(r.score)(`[${r.score}]`) +
        ' ' +
        colors.bold(rel) +
        colors.gray(`  (${r.typeLabel})`)
    );
    for (const issue of r.issues.slice(0, 3)) {
      out.push(
        '      ' + SEV_ICON[issue.severity] + ' ' + colors.dim(issue.title)
      );
      out.push('        ' + colors.gray(issue.message));
      if (issue.fix) {
        out.push('        ' + colors.green('→ ') + issue.fix);
      }
    }
    out.push('');
  }

  if (!anyIssues) {
    out.push('  ' + colors.green('✓ 所有文件都很健康，没有发现问题。'));
    out.push('');
  }

  out.push(
    '  ' +
      colors.gray('生成 HTML 报告: ') +
      colors.cyan(`skill-lint report ${rootPath === '.' ? '' : rootPath}`)
  );
  out.push('');
  return out.join('\n');
}
