'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const scanner = require('./scanner');

/**
 * Snapshot persistence layer.
 *
 * A snapshot is a single JSON file under ~/.promptdiff/snapshots/ named
 * <timestamp>-<shortid>.json. It captures every tracked config file's content
 * and hash at a moment in time, plus a roll-up hash of the whole tree so two
 * snapshots can be compared for equality in O(1).
 */

const SNAPSHOT_FORMAT = 1;

/**
 * Ensure the snapshot store exists.
 * @returns {void}
 */
function ensureStore() {
  fs.mkdirSync(config.SNAPSHOTS_DIR, { recursive: true });
}

/**
 * Compute a single tree-level hash from sorted per-file hashes.
 * @param {Array<{relPath:string,root:string,hash:string}>} files
 * @returns {string}
 */
function treeHash(files) {
  const h = crypto.createHash('sha256');
  files
    .slice()
    .sort((a, b) => `${a.root}/${a.relPath}`.localeCompare(`${b.root}/${b.relPath}`))
    .forEach((f) => h.update(`${f.root}/${f.relPath}:${f.hash}\n`));
  return h.digest('hex');
}

/**
 * Build a snapshot object (in memory) from a scan result.
 * @param {object} scan - result of scanner.scanAll
 * @param {{label?:string}} [opts]
 * @returns {object} snapshot
 */
function buildSnapshot(scan, opts = {}) {
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;

  const files = scan.files.map((f) => Object.freeze({
    root: f.root,
    rootLabel: f.rootLabel,
    relPath: f.relPath,
    ext: f.ext,
    size: f.size,
    hash: f.hash,
    content: f.content,
  }));

  return Object.freeze({
    format: SNAPSHOT_FORMAT,
    id,
    label: opts.label || null,
    createdAt,
    roots: scan.roots,
    fileCount: files.length,
    skippedCount: scan.skipped.length,
    skipped: scan.skipped,
    treeHash: treeHash(files),
    files,
  });
}

/**
 * Create a snapshot by scanning current config and write it to disk.
 * @param {{label?:string, roots?:Array}} [opts]
 * @returns {{snapshot:object, filePath:string}}
 */
function createSnapshot(opts = {}) {
  ensureStore();
  const scan = scanner.scanAll(opts.roots || config.DEFAULT_ROOTS);
  const snapshot = buildSnapshot(scan, opts);
  const filePath = path.join(config.SNAPSHOTS_DIR, `${snapshot.id}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return { snapshot, filePath };
}

/**
 * List all snapshots (metadata only, content stripped) newest-first.
 * @returns {Array<object>}
 */
function listSnapshots() {
  if (!fs.existsSync(config.SNAPSHOTS_DIR)) {
    return [];
  }
  const names = fs
    .readdirSync(config.SNAPSHOTS_DIR)
    .filter((n) => n.endsWith('.json'));

  const metas = names.reduce((acc, name) => {
    const full = path.join(config.SNAPSHOTS_DIR, name);
    try {
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      acc.push({
        id: raw.id,
        label: raw.label,
        createdAt: raw.createdAt,
        fileCount: raw.fileCount,
        treeHash: raw.treeHash,
        filePath: full,
      });
    } catch (error) {
      // Corrupt snapshot — surface but don't crash listing.
      acc.push({ id: name, label: '(corrupt)', createdAt: null, error: error.message, filePath: full });
    }
    return acc;
  }, []);

  return metas.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Resolve a user-supplied selector to a snapshot file path.
 * Accepts: exact id, "latest"/"HEAD", numeric index (1 = newest), or id prefix.
 *
 * Distinguishes failure modes so callers can give actionable errors:
 *   - empty selector        -> null
 *   - no snapshots at all   -> null
 *   - numeric out of range  -> throws RangeError (lists total count)
 *   - prefix/label ambiguous-> throws an Error tagged `.ambiguous` (lists candidates)
 *   - simply not found      -> null
 *
 * @param {string} selector
 * @returns {string|null} file path, or null when there is genuinely no match
 * @throws {Error} on ambiguous or out-of-range selectors
 */
function resolveSelector(selector) {
  if (!selector) return null;
  const list = listSnapshots();
  if (list.length === 0) return null;

  const sel = String(selector).trim();

  if (sel.toLowerCase() === 'latest' || sel.toUpperCase() === 'HEAD') {
    return list[0].filePath;
  }

  // 1-based index into newest-first list
  if (/^\d+$/.test(sel)) {
    const idx = Number(sel) - 1;
    if (idx < 0 || idx >= list.length) {
      const err = new RangeError(`Index ${sel} out of range — there ${list.length === 1 ? 'is' : 'are'} ${list.length} snapshot${list.length === 1 ? '' : 's'} (use 1..${list.length}, 1 = newest).`);
      err.outOfRange = true;
      throw err;
    }
    return list[idx].filePath;
  }

  const exact = list.find((m) => m.id === sel);
  if (exact) return exact.filePath;

  const byPrefix = list.filter((m) => m.id && m.id.startsWith(sel));
  if (byPrefix.length === 1) return byPrefix[0].filePath;
  if (byPrefix.length > 1) {
    const candidates = byPrefix.slice(0, 8).map((m) => m.id).join('\n  ');
    const err = new Error(`Ambiguous id prefix "${sel}" matches ${byPrefix.length} snapshots:\n  ${candidates}${byPrefix.length > 8 ? '\n  …' : ''}\nUse a longer prefix or the full id.`);
    err.ambiguous = true;
    throw err;
  }

  const byLabel = list.filter((m) => m.label === sel);
  if (byLabel.length === 1) return byLabel[0].filePath;
  if (byLabel.length > 1) {
    const candidates = byLabel.slice(0, 8).map((m) => `${m.id} [${m.label}]`).join('\n  ');
    const err = new Error(`Ambiguous label "${sel}" matches ${byLabel.length} snapshots:\n  ${candidates}${byLabel.length > 8 ? '\n  …' : ''}\nUse a snapshot id instead.`);
    err.ambiguous = true;
    throw err;
  }

  return null;
}

/**
 * Load a full snapshot (with content) by selector or path.
 * @param {string} selectorOrPath
 * @returns {object} snapshot
 */
function loadSnapshot(selectorOrPath) {
  let filePath = selectorOrPath;
  if (!fs.existsSync(filePath)) {
    filePath = resolveSelector(selectorOrPath);
  }
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Snapshot not found: ${selectorOrPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (raw.format !== SNAPSHOT_FORMAT) {
    throw new Error(`Unsupported snapshot format ${raw.format} in ${filePath}`);
  }
  return raw;
}

/**
 * Build an ephemeral snapshot of the CURRENT config without writing to disk.
 * Used by `diff <a>` (snapshot vs live config).
 * @param {{roots?:Array}} [opts]
 * @returns {object} snapshot
 */
function snapshotCurrent(opts = {}) {
  const scan = scanner.scanAll(opts.roots || config.DEFAULT_ROOTS);
  return { ...buildSnapshot(scan, { label: '(current config)' }), id: 'CURRENT', ephemeral: true };
}

/**
 * Map a snapshot root id to its on-disk directory. Resolves against the live
 * config roots (so we never trust an arbitrary `dir` baked into old snapshot
 * JSON — restore always writes to the CURRENT machine's known roots).
 * @param {string} rootId
 * @param {Array<object>} roots
 * @returns {string|null} absolute root dir, or null if unknown
 */
function resolveRootDir(rootId, roots) {
  const match = (roots || config.DEFAULT_ROOTS).find((r) => r.id === rootId);
  return match ? match.dir : null;
}

// Restore accepts snapshot data, never snapshot-controlled filesystem boundaries.
function safeRestorePath(rootDir, relPath) {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\\') ||
      relPath.includes('\0') || path.isAbsolute(relPath) || /^[a-z]:/i.test(relPath)) {
    throw new Error('unsafe-restore-path');
  }
  const parts = relPath.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) throw new Error('unsafe-restore-path');
  const root = path.resolve(rootDir), target = path.resolve(root, relPath);
  if (!target.startsWith(root + path.sep)) throw new Error('unsafe-restore-path');
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) {
      throw new Error('unsafe-restore-link');
    }
  }
  return target;
}

/**
 * Plan a restore of a snapshot back onto the live config tree.
 *
 * Compares the snapshot's files against the CURRENT config and classifies each
 * snapshot file as `write` (content differs / file missing) or `unchanged`.
 * Files that were redacted at capture time are flagged `blocked` and never
 * written back — restoring a `[REDACTED_SECRET]` placeholder over a real value
 * would silently corrupt the user's live config.
 *
 * NOTE: restore is intentionally NON-destructive toward files that exist live
 * but are absent from the snapshot — we only ever write the snapshot's own
 * files; we never delete. Deleting live files on "rollback" is too dangerous
 * for a v1 and is left to a future `--prune` flag.
 *
 * @param {object} snapshot - a loaded snapshot (with file content)
 * @param {{roots?:Array}} [opts]
 * @returns {{actions:Array<{root:string,relPath:string,absPath:string,action:string,reason?:string}>, unknownRoots:Array<string>}}
 */
function planRestore(snapshot, opts = {}) {
  const roots = opts.roots || config.DEFAULT_ROOTS;
  const current = snapshotCurrent({ roots });
  const currentByKey = new Map();
  (current.files || []).forEach((f) => currentByKey.set(`${f.root}/${f.relPath}`, f));

  const unknownRoots = new Set();
  const actions = (snapshot.files || []).map((f) => {
    const absRootDir = resolveRootDir(f.root, roots);
    if (!absRootDir) {
      unknownRoots.add(f.root);
      return { root: f.root, relPath: f.relPath, absPath: null, action: 'skip', reason: 'unknown-root' };
    }
    let absPath;
    try { absPath = safeRestorePath(absRootDir, f.relPath); }
    catch (error) {
      return { root: f.root, relPath: f.relPath, absPath: null, action: 'blocked', reason: error.message };
    }

    // Never write a redacted placeholder back over live config.
    if (typeof f.content === 'string' && f.content.includes(config.REDACTION)) {
      return { root: f.root, relPath: f.relPath, absPath, action: 'blocked', reason: 'contains-redacted-secret' };
    }

    const live = currentByKey.get(`${f.root}/${f.relPath}`);
    if (live && live.hash === f.hash) {
      return { root: f.root, relPath: f.relPath, absPath, action: 'unchanged' };
    }
    return { root: f.root, relPath: f.relPath, absPath, action: 'write', reason: live ? 'content-differs' : 'missing-live' };
  });

  return { actions, unknownRoots: Array.from(unknownRoots) };
}

/**
 * Restore a snapshot back onto the live config tree.
 *
 * Safety: ALWAYS captures a fresh pre-restore snapshot first (so the operation
 * is itself reversible), then writes each planned file. With `dryRun:true` it
 * computes and returns the plan without taking the safety snapshot or writing
 * anything.
 *
 * @param {string} selectorOrPath - which snapshot to restore
 * @param {{dryRun?:boolean, roots?:Array}} [opts]
 * @returns {{snapshot:object, plan:object, dryRun:boolean, preRestore:object|null, written:Array<string>}}
 */
function restoreSnapshot(selectorOrPath, opts = {}) {
  const roots = opts.roots || config.DEFAULT_ROOTS;
  const snapshot = loadSnapshot(selectorOrPath);
  const plan = planRestore(snapshot, { roots });

  if (opts.dryRun) {
    return { snapshot, plan, dryRun: true, preRestore: null, written: [] };
  }

  // Safety net: snapshot the current state BEFORE mutating anything so the
  // restore itself can be undone.
  const { snapshot: preRestore } = createSnapshot({
    label: `pre-restore-of-${snapshot.id}`,
    roots,
  });

  const written = [];
  plan.actions.forEach((a) => {
    if (a.action !== 'write') return;
    const file = (snapshot.files || []).find((f) => f.root === a.root && f.relPath === a.relPath);
    if (!file || typeof file.content !== 'string') return;
    // Recheck immediately before mutation, including links introduced after planning.
    safeRestorePath(resolveRootDir(a.root, roots), a.relPath);
    fs.mkdirSync(path.dirname(a.absPath), { recursive: true });
    safeRestorePath(resolveRootDir(a.root, roots), a.relPath);
    fs.writeFileSync(a.absPath, file.content, 'utf8');
    written.push(a.absPath);
  });

  return { snapshot, plan, dryRun: false, preRestore, written };
}

module.exports = Object.freeze({
  SNAPSHOT_FORMAT,
  ensureStore,
  buildSnapshot,
  createSnapshot,
  listSnapshots,
  resolveSelector,
  loadSnapshot,
  snapshotCurrent,
  treeHash,
  resolveRootDir,
  planRestore,
  restoreSnapshot,
});
