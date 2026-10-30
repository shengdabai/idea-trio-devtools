// lib/html-report.js
// Build a self-contained (single-file, no external assets) HTML report.

import path from 'node:path';
import { grade } from './colors.js';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tone(score) {
  if (score >= 85) return 'good';
  if (score >= 70) return 'fair';
  if (score >= 50) return 'warn';
  return 'bad';
}

const SEV_LABEL = { error: '严重', warn: '建议', ok: '通过' };

export function buildHtml(results, summary, rootPath) {
  const root = path.resolve(rootPath);
  const sorted = [...results].sort((a, b) => a.score - b.score);
  const generated = new Date().toLocaleString('zh-CN');

  const typeChips = Object.entries(summary.byType || {})
    .map(
      ([k, v]) =>
        `<span class="chip"><b>${esc(k)}</b> 均分 ${v.average} · ${v.count} 个</span>`
    )
    .join('');

  const cards = sorted.map((r) => fileCard(r, root)).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SkillLint 报告 · ${esc(path.basename(root))}</title>
<style>
  :root{
    --bg:#0d1117; --panel:#161b22; --panel2:#1c2430; --line:#272e3a;
    --txt:#e6edf3; --mut:#8b949e;
    --good:#3fb950; --fair:#58a6ff; --warn:#d29922; --bad:#f85149;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);
    font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",PingFang SC,Helvetica,Arial,sans-serif}
  .wrap{max-width:980px;margin:0 auto;padding:40px 20px 80px}
  h1{font-size:26px;margin:0 0 4px;letter-spacing:.5px}
  .sub{color:var(--mut);font-size:13px;margin-bottom:28px;word-break:break-all}
  .hero{display:flex;gap:24px;align-items:center;background:var(--panel);
    border:1px solid var(--line);border-radius:14px;padding:24px;margin-bottom:18px;flex-wrap:wrap}
  .gauge{width:120px;height:120px;border-radius:50%;display:grid;place-items:center;
    flex:0 0 auto;position:relative}
  .gauge b{font-size:34px}
  .gauge span{position:absolute;bottom:24px;font-size:12px;color:var(--mut)}
  .stats{flex:1;min-width:220px}
  .stats .big{font-size:15px;color:var(--mut)}
  .chips{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}
  .chip{background:var(--panel2);border:1px solid var(--line);border-radius:20px;
    padding:4px 12px;font-size:12px;color:var(--mut)}
  .chip b{color:var(--txt)}
  details{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    margin:12px 0;overflow:hidden}
  summary{list-style:none;cursor:pointer;padding:16px 18px;display:flex;align-items:center;
    gap:14px;user-select:none}
  summary::-webkit-details-marker{display:none}
  .score-pill{flex:0 0 auto;width:54px;height:54px;border-radius:10px;display:grid;
    place-items:center;font-weight:700;font-size:18px}
  .meta{flex:1;min-width:0}
  .meta .name{font-weight:600;word-break:break-all}
  .meta .path{color:var(--mut);font-size:12px;word-break:break-all}
  .badge{font-size:11px;padding:2px 9px;border-radius:20px;border:1px solid var(--line);
    color:var(--mut);flex:0 0 auto}
  .arrow{color:var(--mut);transition:.2s;flex:0 0 auto}
  details[open] .arrow{transform:rotate(90deg)}
  .body{padding:0 18px 18px;border-top:1px solid var(--line)}
  .rule{padding:12px 0;border-bottom:1px dashed var(--line)}
  .rule:last-child{border-bottom:none}
  .rule .head{display:flex;align-items:center;gap:8px}
  .dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
  .rule .title{font-weight:600}
  .rule .w{margin-left:auto;color:var(--mut);font-size:12px}
  .rule .msg{color:var(--mut);margin:4px 0 0 17px;font-size:14px}
  .rule .fix{margin:6px 0 0 17px;font-size:14px;color:#7ee787;
    background:rgba(63,185,80,.08);border-left:3px solid var(--good);padding:6px 10px;border-radius:4px}
  .good{color:var(--good)} .fair{color:var(--fair)} .warn{color:var(--warn)} .bad{color:var(--bad)}
  .bg-good{background:rgba(63,185,80,.15)} .bg-fair{background:rgba(88,166,255,.15)}
  .bg-warn{background:rgba(210,153,34,.15)} .bg-bad{background:rgba(248,81,73,.15)}
  .d-good{background:var(--good)} .d-fair{background:var(--fair)}
  .d-warn{background:var(--warn)} .d-bad{background:var(--bad)}
  footer{color:var(--mut);font-size:12px;text-align:center;margin-top:40px;line-height:1.8}
  footer a{color:var(--fair);text-decoration:none}
  .empty{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    padding:40px;text-align:center;color:var(--mut)}
</style>
</head>
<body>
<div class="wrap">
  <h1>🩺 SkillLint 体检报告</h1>
  <div class="sub">扫描根目录: ${esc(root)} · 生成于 ${esc(generated)}</div>

  ${results.length === 0 ? emptyState() : heroBlock(summary, typeChips)}

  ${cards}

  <footer>
    SkillLint · 把「装了一堆 skill 不一定更强」变成可量化、可观测。<br>
    评分规则可解释：每条规则都说明检查了什么、为什么重要、如何修复。<br>
    这是一份自包含的静态报告，可直接分享或归档。
  </footer>
</div>
</body>
</html>`;
}

function emptyState() {
  return `<div class="empty">未发现可体检的文件。<br>
    支持 SKILL.md / CLAUDE.md / agents/*.md / commands/*.md / rules/*.md</div>`;
}

function heroBlock(summary, typeChips) {
  const t = tone(summary.average);
  return `<div class="hero">
    <div class="gauge bg-${t}">
      <b class="${t}">${summary.average}</b>
      <span>${grade(summary.average)} 级</span>
    </div>
    <div class="stats">
      <div class="big">共扫描 <b>${summary.count}</b> 个文件 ·
        发现 <b>${summary.totalIssues}</b> 处可改进项</div>
      <div class="chips">${typeChips}</div>
    </div>
  </div>`;
}

function fileCard(r, root) {
  const t = tone(r.score);
  let rel = path.relative(root, r.path) || path.basename(r.path);
  const name = path.basename(r.path);

  if (r.error) {
    return `<details>
      <summary>
        <div class="score-pill bg-bad bad">!</div>
        <div class="meta"><div class="name">${esc(name)}</div>
          <div class="path">${esc(rel)}</div></div>
        <span class="badge">读取失败</span>
      </summary>
      <div class="body"><p class="bad" style="margin:14px 0">${esc(r.error)}</p></div>
    </details>`;
  }

  const rulesHtml = r.findings
    .map((f) => {
      const ft = tone(f.score * 100);
      return `<div class="rule">
        <div class="head">
          <span class="dot d-${ft}"></span>
          <span class="title">${esc(f.title)}</span>
          <span class="w">${SEV_LABEL[f.severity]} · 权重 ${f.weight}</span>
        </div>
        <div class="msg">${esc(f.message)}</div>
        ${f.fix ? `<div class="fix">修复: ${esc(f.fix)}</div>` : ''}
      </div>`;
    })
    .join('');

  const issueBadge =
    r.issues.length > 0
      ? `<span class="badge ${t}">${r.issues.length} 处可改进</span>`
      : `<span class="badge good">健康</span>`;

  return `<details${r.issues.length ? ' open' : ''}>
    <summary>
      <div class="score-pill bg-${t} ${t}">${r.score}</div>
      <div class="meta">
        <div class="name">${esc(name)} <span class="badge">${esc(r.typeLabel)}</span></div>
        <div class="path">${esc(rel)}</div>
      </div>
      ${issueBadge}
      <span class="arrow">▶</span>
    </summary>
    <div class="body">${rulesHtml}</div>
  </details>`;
}
