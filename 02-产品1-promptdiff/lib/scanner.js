'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

/**
 * Recursively scan a directory for tracked config files, honoring the secrets
 * firewall and skip rules. Returns an immutable list of file descriptors.
 *
 * A descriptor: { root, relPath, absPath, size, ext, hash, content }
 * `content` is the raw UTF-8 text (needed for line-level diffs); `hash` is a
 * sha256 of that content for fast equality checks.
 */

/**
 * Hash a string with sha256.
 * @param {string} text
 * @returns {string} hex digest
 */
function hashContent(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Decode a Buffer as UTF-8 text ONLY if it is genuinely valid UTF-8 text.
 *
 * Node's `buf.toString('utf8')` silently substitutes U+FFFD for invalid bytes,
 * which makes hashes unstable (decode is lossy) and pollutes diffs with replacement
 * characters. We instead:
 *   1. reject any buffer containing a NUL byte (reliable binary signal), and
 *   2. round-trip check: decode -> re-encode -> compare byte-for-byte. If the
 *      re-encoded bytes don't equal the original, the input was not clean UTF-8
 *      (it contained invalid sequences that decode lossily) and we refuse it.
 *
 * @param {Buffer} buf
 * @returns {{ok:true, text:string}|{ok:false, reason:string}}
 */
function decodeUtf8(buf) {
  if (buf.includes(0x00)) {
    return { ok: false, reason: 'binary-nul-byte' };
  }
  const text = buf.toString('utf8');
  // Round-trip: a lossless UTF-8 decode re-encodes to the exact same bytes.
  if (!Buffer.from(text, 'utf8').equals(buf)) {
    return { ok: false, reason: 'invalid-utf8' };
  }
  return { ok: true, text };
}

/**
 * Walk a single root directory, collecting tracked files.
 * Errors on individual files are recorded as `skipped`, never thrown.
 *
 * @param {{id:string,label:string,dir:string}} root
 * @returns {{files: Array<object>, skipped: Array<{path:string,reason:string}>}}
 */
function scanRoot(root) {
  const files = [];
  const skipped = [];

  if (!fs.existsSync(root.dir)) {
    return { files, skipped: [{ path: root.dir, reason: 'root-missing' }] };
  }

  // When a root declares an `include` allow-list, we restrict to authored
  // config: top-level files of the root plus the listed subdirectories.
  const include = Array.isArray(root.include) ? new Set(root.include) : null;

  /**
   * @param {string} dirAbs
   * @param {number} depth - 0 at the root itself
   */
  const walk = (dirAbs, depth = 0) => {
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch (error) {
      skipped.push({ path: dirAbs, reason: `readdir-failed: ${error.code || error.message}` });
      return;
    }

    for (const entry of entries) {
      const abs = path.join(dirAbs, entry.name);
      const rel = path.relative(root.dir, abs);

      // Symlinks: skip to avoid loops and escaping the root.
      if (entry.isSymbolicLink()) {
        skipped.push({ path: rel, reason: 'symlink' });
        continue;
      }

      if (entry.isDirectory()) {
        if (config.SKIP_DIRS.has(entry.name)) {
          continue;
        }
        // Allow-list gate: at the root level (depth 0) only descend into
        // subdirectories named in `include`. Deeper levels are unrestricted.
        if (include && depth === 0 && !include.has(entry.name)) {
          continue;
        }
        walk(abs, depth + 1);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      // SECRETS FIREWALL — never even open these.
      if (config.isSecretPath(rel, entry.name)) {
        skipped.push({ path: rel, reason: 'secret-firewall' });
        continue;
      }

      const ext = path.extname(entry.name);
      if (!config.isTrackedExtension(ext)) {
        continue;
      }

      let stat;
      try {
        stat = fs.statSync(abs);
      } catch (error) {
        skipped.push({ path: rel, reason: `stat-failed: ${error.code || error.message}` });
        continue;
      }

      if (stat.size > config.MAX_FILE_BYTES) {
        skipped.push({ path: rel, reason: `too-large: ${stat.size}b` });
        continue;
      }

      let buf;
      try {
        buf = fs.readFileSync(abs); // raw bytes — no encoding, so nothing is silently mangled
      } catch (error) {
        skipped.push({ path: rel, reason: `read-failed: ${error.code || error.message}` });
        continue;
      }

      // Reject binary / non-UTF-8 content instead of letting Node replace bad
      // bytes with U+FFFD (which would corrupt hashes and pollute diffs).
      const decoded = decodeUtf8(buf);
      if (!decoded.ok) {
        skipped.push({ path: rel, reason: decoded.reason });
        continue;
      }
      const raw = decoded.text;

      // Defense-in-depth: redact live-credential-shaped values from the body
      // before the content ever lands in a snapshot on disk.
      const { text: content, redactions } = config.redactSecrets(raw);
      if (redactions > 0) {
        skipped.push({ path: rel, reason: `redacted-${redactions}-secret-value(s)`, redacted: true });
      }

      files.push(Object.freeze({
        root: root.id,
        relPath: rel,
        absPath: abs,
        size: stat.size,
        ext: ext.toLowerCase(),
        redactions,
        hash: hashContent(content),
        content,
      }));
    }
  };

  walk(root.dir);

  // Deterministic ordering so snapshots are stable across runs.
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { files, skipped };
}

/**
 * Scan a set of roots (defaults to config.DEFAULT_ROOTS).
 * @param {Array<object>} [roots]
 * @returns {{roots: Array<object>, files: Array<object>, skipped: Array<object>}}
 */
function scanAll(roots = config.DEFAULT_ROOTS) {
  const result = roots.reduce(
    (acc, root) => {
      const { files, skipped } = scanRoot(root);
      return {
        files: acc.files.concat(files.map((f) => ({ ...f, rootLabel: root.label }))),
        skipped: acc.skipped.concat(skipped.map((s) => ({ ...s, root: root.id }))),
      };
    },
    { files: [], skipped: [] },
  );

  return {
    roots: roots.map((r) => ({ id: r.id, label: r.label, dir: r.dir })),
    files: result.files,
    skipped: result.skipped,
  };
}

module.exports = Object.freeze({ scanRoot, scanAll, hashContent, decodeUtf8 });
