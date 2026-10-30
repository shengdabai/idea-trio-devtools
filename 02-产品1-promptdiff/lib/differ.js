'use strict';

/**
 * Diff engine.
 *
 * Two layers:
 *   1. compareSnapshots(a, b) -> file-level diff (added / removed / modified / unchanged)
 *   2. lineDiff(oldText, newText) -> line-level hunks via LCS
 *
 * No dependencies. Pure functions, immutable inputs.
 */

/**
 * Longest-common-subsequence line diff.
 * Returns an array of ops: { type:'eq'|'add'|'del', value:string, aLine?, bLine? }
 *
 * Uses the classic DP LCS table. For config files (hundreds of lines) this is
 * comfortably fast; we cap pathological inputs to keep memory bounded.
 *
 * @param {string} oldText
 * @param {string} newText
 * @returns {Array<{type:string,value:string,aLine?:number,bLine?:number}>}
 */
// LCS DP guard thresholds. We bound BOTH dimensions of cost:
//   - MAX_LCS_CELLS bounds the DP table size (n*m cells). The table is an
//     (n+1) x (m+1) grid of Int32Array, i.e. 4 bytes/cell — 4M cells ≈ 16MB.
//   - MAX_LCS_BYTES bounds total input size independently, because a file of
//     few very long lines passes the cell guard yet still forces large string
//     comparisons; and many short lines (2000x2000 ≈ 64MB table) is exactly the
//     pathological case we must refuse rather than allocate for.
const MAX_LCS_CELLS = 4_000_000;
const MAX_LCS_BYTES = 4 * 1024 * 1024; // 4 MB combined input

function lineDiff(oldText, newText) {
  const a = oldText.length ? oldText.split('\n') : [];
  const b = newText.length ? newText.split('\n') : [];
  const n = a.length;
  const m = b.length;

  // Guard rail: extremely large inputs fall back to a coarse replace-all diff
  // instead of allocating a huge DP table. We trip on EITHER too many DP cells
  // (n*m) OR too many total bytes, so neither "many short lines" nor "few huge
  // lines" can blow up memory.
  const totalBytes = oldText.length + newText.length;
  if (n * m > MAX_LCS_CELLS || totalBytes > MAX_LCS_BYTES) {
    return [
      ...a.map((value, i) => ({ type: 'del', value, aLine: i + 1 })),
      ...b.map((value, i) => ({ type: 'add', value, bLine: i + 1 })),
    ];
  }

  // DP table of LCS lengths.
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack to produce ops in order.
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', value: a[i], aLine: i + 1, bLine: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', value: a[i], aLine: i + 1 });
      i += 1;
    } else {
      ops.push({ type: 'add', value: b[j], bLine: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', value: a[i], aLine: i + 1 });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: 'add', value: b[j], bLine: j + 1 });
    j += 1;
  }
  return ops;
}

/**
 * Group line ops into hunks with surrounding context, collapsing long runs of
 * equal lines. `context` = number of unchanged lines to keep around a change.
 *
 * @param {Array<object>} ops
 * @param {number} [context]
 * @returns {Array<{header:string, ops:Array<object>}>}
 */
function toHunks(ops, context = 3) {
  // Mark indices that are "interesting" (changed) and their context window.
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type !== 'eq') {
      for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k += 1) {
        keep[k] = true;
      }
    }
  });

  const hunks = [];
  let current = null;
  ops.forEach((op, idx) => {
    if (!keep[idx]) {
      if (current) {
        hunks.push(current);
        current = null;
      }
      return;
    }
    if (!current) {
      const aStart = op.aLine || op.bLine || 1;
      const bStart = op.bLine || op.aLine || 1;
      current = { header: `@@ -${aStart} +${bStart} @@`, ops: [] };
    }
    current.ops.push(op);
  });
  if (current) hunks.push(current);
  return hunks;
}

/**
 * Index a snapshot's files by a stable key.
 * @param {object} snapshot
 * @returns {Map<string, object>}
 */
function indexFiles(snapshot) {
  const map = new Map();
  (snapshot.files || []).forEach((f) => {
    map.set(`${f.root}/${f.relPath}`, f);
  });
  return map;
}

/**
 * Compare two snapshots and produce a per-file change report.
 *
 * @param {object} snapA - older / base
 * @param {object} snapB - newer / target
 * @param {{context?:number}} [opts]
 * @returns {object} structured diff report
 */
function compareSnapshots(snapA, snapB, opts = {}) {
  const context = opts.context ?? 3;
  const aIdx = indexFiles(snapA);
  const bIdx = indexFiles(snapB);
  const allKeys = Array.from(new Set([...aIdx.keys(), ...bIdx.keys()])).sort();

  const changes = allKeys.reduce((acc, key) => {
    const fa = aIdx.get(key);
    const fb = bIdx.get(key);

    if (fa && !fb) {
      acc.push({ key, status: 'removed', root: fa.root, relPath: fa.relPath, hunks: [], stats: { added: 0, removed: fa.content.split('\n').length } });
      return acc;
    }
    if (!fa && fb) {
      acc.push({ key, status: 'added', root: fb.root, relPath: fb.relPath, hunks: [], stats: { added: fb.content.split('\n').length, removed: 0 } });
      return acc;
    }
    if (fa.hash === fb.hash) {
      acc.push({ key, status: 'unchanged', root: fa.root, relPath: fa.relPath, hunks: [], stats: { added: 0, removed: 0 } });
      return acc;
    }
    const ops = lineDiff(fa.content, fb.content);
    const hunks = toHunks(ops, context);
    const stats = ops.reduce(
      (s, op) => ({
        added: s.added + (op.type === 'add' ? 1 : 0),
        removed: s.removed + (op.type === 'del' ? 1 : 0),
      }),
      { added: 0, removed: 0 },
    );
    acc.push({ key, status: 'modified', root: fa.root, relPath: fa.relPath, hunks, stats });
    return acc;
  }, []);

  const summary = changes.reduce(
    (acc, c) => ({ ...acc, [c.status]: (acc[c.status] || 0) + 1 }),
    { added: 0, removed: 0, modified: 0, unchanged: 0 },
  );

  return {
    base: { id: snapA.id, label: snapA.label, createdAt: snapA.createdAt, treeHash: snapA.treeHash },
    target: { id: snapB.id, label: snapB.label, createdAt: snapB.createdAt, treeHash: snapB.treeHash },
    identical: snapA.treeHash === snapB.treeHash,
    summary,
    changes,
  };
}

module.exports = Object.freeze({ lineDiff, toHunks, compareSnapshots, indexFiles });
