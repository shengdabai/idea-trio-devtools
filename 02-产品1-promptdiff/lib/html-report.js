'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Self-contained HTML report generator.
 *
 * Produces a single file (no external CSS/JS/CDN) with:
 *   - a snapshot timeline header
 *   - a summary bar
 *   - collapsible per-file diffs with line-level highlight
 *
 * All dynamic text is HTML-escaped to prevent the config content (which is
 * untrusted from the report's POV) from injecting markup.
 */

/**
 * Escape a string for safe HTML embedding.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;
--add:#2ea043;--addbg:#12251a;--del:#f85149;--delbg:#291416;--mod:#d29922;--accent:#58a6ff;}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
background:var(--bg);color:var(--text);padding:24px;max-width:1100px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px;font-size:13px}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.timeline{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 24px}
.tl{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:12px}
.tl.base{border-color:var(--accent)}.tl.target{border-color:var(--mod)}
.tl .k{color:var(--muted);text-transform:uppercase;font-size:10px;letter-spacing:.06em}
.bar{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 22px;font-size:13px}
.pill{padding:3px 10px;border-radius:20px;border:1px solid var(--border);background:var(--panel)}
.pill.add{color:var(--add)}.pill.del{color:var(--del)}.pill.mod{color:var(--mod)}.pill.same{color:var(--muted)}
details{background:var(--panel);border:1px solid var(--border);border-radius:8px;margin:0 0 10px;overflow:hidden}
summary{cursor:pointer;padding:11px 14px;display:flex;align-items:center;gap:10px;user-select:none;list-style:none}
summary::-webkit-details-marker{display:none}
summary:hover{background:#1c2430}
.badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:5px;flex-shrink:0}
.badge.added{background:var(--addbg);color:var(--add)}
.badge.removed{background:var(--delbg);color:var(--del)}
.badge.modified{background:#2a230f;color:var(--mod)}
.fname{font-family:ui-monospace,monospace;font-weight:600}
.delta{margin-left:auto;color:var(--muted);font-size:12px;font-family:ui-monospace,monospace}
.diff{border-top:1px solid var(--border);background:#0b0f15;overflow-x:auto}
.hunkhdr{color:var(--accent);background:#10161f;padding:4px 14px;font-family:ui-monospace,monospace;font-size:12px}
.row{display:flex;font-family:ui-monospace,monospace;font-size:12.5px;white-space:pre}
.row .ln{width:52px;flex-shrink:0;text-align:right;padding:1px 8px;color:#5b6470;user-select:none}
.row .tx{padding:1px 12px 1px 6px;flex:1}
.row.add{background:var(--addbg)}.row.add .tx{color:#7ee2a8}
.row.del{background:var(--delbg)}.row.del .tx{color:#ff9a93}
.row.eq .tx{color:var(--muted)}
.empty{color:var(--muted);padding:18px;text-align:center}
.foot{margin-top:30px;color:var(--muted);font-size:12px;border-top:1px solid var(--border);padding-top:14px}
.controls{margin:0 0 16px}
.controls button{background:var(--panel);color:var(--text);border:1px solid var(--border);
border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;margin-right:8px}
.controls button:hover{border-color:var(--accent)}
`;

const SCRIPT = `
function toggleAll(open){document.querySelectorAll('details.file').forEach(function(d){d.open=open;});}
`;

/**
 * Build the timeline header HTML.
 * @param {object} report
 * @returns {string}
 */
function timelineHtml(report) {
  const card = (cls, kind, snap) => `
    <div class="tl ${cls}">
      <div class="k">${kind}</div>
      <div><strong>${esc(snap.id)}</strong>${snap.label ? ` <span style="color:var(--muted)">${esc(snap.label)}</span>` : ''}</div>
      <div style="color:var(--muted)">${esc(snap.createdAt || '')}</div>
    </div>`;
  return `<div class="timeline">${card('base', 'base', report.base)}${card('target', 'target', report.target)}</div>`;
}

/**
 * Build the per-file collapsible diff blocks.
 * @param {object} report
 * @returns {string}
 */
function changesHtml(report) {
  const changed = report.changes.filter((ch) => ch.status !== 'unchanged');
  if (changed.length === 0) {
    return '<div class="empty">No differences — config trees are identical.</div>';
  }

  return changed
    .map((ch) => {
      const delta = ch.stats.added || ch.stats.removed
        ? `<span class="delta">+${ch.stats.added} −${ch.stats.removed}</span>`
        : '';
      const head = `
        <summary>
          <span class="badge ${ch.status}">${ch.status}</span>
          <span class="fname">${esc(ch.root)}/${esc(ch.relPath)}</span>
          ${delta}
        </summary>`;

      let body = '';
      if (ch.status === 'modified') {
        const hunks = ch.hunks
          .map((hunk) => {
            const rows = hunk.ops
              .map((op) => {
                const ln = op.type === 'add'
                  ? `<span class="ln">+${op.bLine || ''}</span>`
                  : op.type === 'del'
                    ? `<span class="ln">−${op.aLine || ''}</span>`
                    : `<span class="ln">${op.aLine || ''}</span>`;
                const cls = op.type === 'add' ? 'add' : op.type === 'del' ? 'del' : 'eq';
                return `<div class="row ${cls}">${ln}<span class="tx">${esc(op.value) || '&nbsp;'}</span></div>`;
              })
              .join('');
            return `<div class="hunkhdr">${esc(hunk.header)}</div>${rows}`;
          })
          .join('');
        body = `<div class="diff">${hunks}</div>`;
      } else if (ch.status === 'added') {
        body = `<div class="diff"><div class="empty">New file (${ch.stats.added} lines).</div></div>`;
      } else if (ch.status === 'removed') {
        body = `<div class="diff"><div class="empty">File removed (${ch.stats.removed} lines).</div></div>`;
      }

      return `<details class="file" ${ch.status === 'modified' ? 'open' : ''}>${head}${body}</details>`;
    })
    .join('\n');
}

/**
 * Render the full HTML document.
 * @param {object} report - differ.compareSnapshots output
 * @param {{timeline?:Array}} [opts] - optional full snapshot timeline list
 * @returns {string}
 */
function renderHtml(report, opts = {}) {
  const s = report.summary;
  const bar = `
    <div class="bar">
      <span class="pill add">+${s.added} added</span>
      <span class="pill del">−${s.removed} removed</span>
      <span class="pill mod">~${s.modified} modified</span>
      <span class="pill same">${s.unchanged} unchanged</span>
    </div>`;

  let history = '';
  if (Array.isArray(opts.timeline) && opts.timeline.length) {
    const items = opts.timeline
      .map((m) => `<div class="tl"><div class="k">${esc(m.id)}</div><div style="color:var(--muted)">${esc(m.createdAt || '')} · ${m.fileCount} files</div></div>`)
      .join('');
    history = `<h2 style="font-size:15px;color:var(--muted);margin:26px 0 8px">All snapshots</h2><div class="timeline">${items}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>promptdiff report</title>
<style>${STYLE}</style>
</head>
<body>
<h1>promptdiff</h1>
<p class="sub">Config snapshot diff · generated ${esc(new Date().toISOString())}</p>
${timelineHtml(report)}
${bar}
<div class="controls">
  <button onclick="toggleAll(true)">Expand all</button>
  <button onclick="toggleAll(false)">Collapse all</button>
</div>
${changesHtml(report)}
${history}
<div class="foot">promptdiff — 配置即资产，可观测，可回滚。Secrets are never captured.</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

/**
 * Render and write the HTML report to disk.
 * @param {object} report
 * @param {{timeline?:Array, outPath?:string}} [opts]
 * @returns {string} the path written
 */
function writeReport(report, opts = {}) {
  const outPath = opts.outPath || config.REPORT_PATH;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderHtml(report, opts), 'utf8');
  return outPath;
}

module.exports = Object.freeze({ esc, renderHtml, writeReport });
