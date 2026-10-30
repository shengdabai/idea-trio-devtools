'use strict';

/**
 * Terminal rendering helpers: ANSI colors (auto-disabled when not a TTY or
 * NO_COLOR is set) and a pretty printer for a diff report.
 */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const codes = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/**
 * Wrap text in an ANSI color when color is enabled.
 * @param {string} color
 * @param {string} text
 * @returns {string}
 */
function c(color, text) {
  if (!useColor || !codes[color]) return text;
  return `${codes[color]}${text}${codes.reset}`;
}

const STATUS_BADGE = {
  added: () => c('green', '＋ added   '),
  removed: () => c('red', '－ removed '),
  modified: () => c('yellow', '~ modified'),
  unchanged: () => c('gray', '= same    '),
};

/**
 * Render a full diff report to a string for terminal display.
 * @param {object} report - output of differ.compareSnapshots
 * @param {{showUnchanged?:boolean}} [opts]
 * @returns {string}
 */
function renderReport(report, opts = {}) {
  const lines = [];
  const { base, target, summary } = report;

  lines.push(c('bold', 'promptdiff — config diff'));
  lines.push(`${c('cyan', 'base')}   ${base.id}${base.label ? ` (${base.label})` : ''}  ${c('gray', base.createdAt || '')}`);
  lines.push(`${c('cyan', 'target')} ${target.id}${target.label ? ` (${target.label})` : ''}  ${c('gray', target.createdAt || '')}`);
  lines.push('');

  if (report.identical) {
    lines.push(c('green', '✓ No differences — config trees are identical.'));
    return lines.join('\n');
  }

  lines.push(
    `${c('green', `+${summary.added} added`)}  ${c('red', `-${summary.removed} removed`)}  ` +
    `${c('yellow', `~${summary.modified} modified`)}  ${c('gray', `${summary.unchanged} unchanged`)}`,
  );
  lines.push('');

  const visible = report.changes.filter(
    (ch) => ch.status !== 'unchanged' || opts.showUnchanged,
  );

  visible.forEach((ch) => {
    const badge = (STATUS_BADGE[ch.status] || (() => ch.status))();
    const stat = ch.stats.added || ch.stats.removed
      ? c('gray', ` (+${ch.stats.added} -${ch.stats.removed})`)
      : '';
    lines.push(`${badge}  ${c('bold', ch.root)}/${ch.relPath}${stat}`);

    if (ch.status === 'modified') {
      ch.hunks.forEach((hunk) => {
        lines.push(`  ${c('magenta', hunk.header)}`);
        hunk.ops.forEach((op) => {
          if (op.type === 'add') lines.push(`  ${c('green', `+ ${op.value}`)}`);
          else if (op.type === 'del') lines.push(`  ${c('red', `- ${op.value}`)}`);
          else lines.push(`  ${c('gray', `  ${op.value}`)}`);
        });
      });
      lines.push('');
    }
  });

  return lines.join('\n');
}

/**
 * Render the snapshot list to a string.
 * @param {Array<object>} metas
 * @returns {string}
 */
function renderList(metas) {
  if (metas.length === 0) {
    return c('gray', 'No snapshots yet. Run: promptdiff snapshot');
  }
  const lines = [c('bold', `Snapshots (${metas.length}), newest first:`), ''];
  metas.forEach((m, idx) => {
    const index = c('cyan', String(idx + 1).padStart(3));
    const label = m.label ? c('yellow', ` [${m.label}]`) : '';
    lines.push(`${index}  ${c('bold', m.id)}${label}`);
    lines.push(`     ${c('gray', m.createdAt || 'unknown')}  ${c('gray', `${m.fileCount} files`)}  ${c('gray', `tree:${(m.treeHash || '').slice(0, 12)}`)}`);
  });
  return lines.join('\n');
}

module.exports = Object.freeze({ c, renderReport, renderList, useColor });
