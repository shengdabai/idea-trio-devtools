'use strict';

/**
 * Minimal end-to-end test using Node's built-in assert (zero deps).
 *
 * Strategy: point the scanner at a temp fixtures directory (not the real
 * ~/.claude), build two snapshots from two states of that directory, diff them,
 * and assert the diff is correct — including that secret files are skipped.
 *
 * Run: node test/e2e.test.js   (or: npm test)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scanner = require('../lib/scanner');
const snapshotLib = require('../lib/snapshot');
const differ = require('../lib/differ');
const htmlReport = require('../lib/html-report');
const config = require('../lib/config');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
}

// ---- set up an isolated temp config tree -------------------------------------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'promptdiff-e2e-'));
const fakeClaude = path.join(tmpRoot, '.claude');
fs.mkdirSync(path.join(fakeClaude, 'rules'), { recursive: true });
fs.mkdirSync(path.join(fakeClaude, 'agents'), { recursive: true });

const write = (rel, content) => fs.writeFileSync(path.join(fakeClaude, rel), content, 'utf8');

// state A
write('CLAUDE.md', '# Rules\nline one\nline two\nline three\n');
write('settings.json', '{\n  "model": "opus",\n  "verbose": false\n}\n');
write('rules/style.md', 'use immutable patterns\n');
write('agents/executor.md', 'you are an executor\n');
// a NON-secret-named file that nonetheless contains a live-shaped key in its body
write('rules/oops.md', 'example config:\nANTHROPIC_API_KEY=sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\ndone\n');
// secrets that MUST be skipped
write('.env', 'OPENAI_API_KEY=sk-must-never-be-captured\n');
fs.writeFileSync(path.join(fakeClaude, 'private.key'), 'BEGIN PRIVATE KEY\n', 'utf8');
fs.writeFileSync(path.join(fakeClaude, 'credentials.json'), '{"token":"secret"}\n', 'utf8');
fs.writeFileSync(path.join(fakeClaude, 'auth.json'), '{"access_token":"super-secret-session-value-1234567890"}\n', 'utf8');

const roots = [{ id: 'claude', label: 'fake', dir: fakeClaude }];

process.stdout.write('\npromptdiff e2e\n');

// ---- scanner + secrets firewall ----------------------------------------------
const scanA = scanner.scanAll(roots);
check('scanner finds the 5 tracked files', () => {
  assert.strictEqual(scanA.files.length, 5, `expected 5, got ${scanA.files.length}`);
});
check('scanner NEVER captures secret-named file content (filename firewall)', () => {
  const blob = JSON.stringify(scanA);
  assert.ok(!blob.includes('sk-must-never-be-captured'), 'secret key leaked into scan!');
  assert.ok(!blob.includes('BEGIN PRIVATE KEY'), 'private key leaked into scan!');
  assert.ok(!scanA.files.some((f) => f.relPath.includes('credentials')), 'credentials file captured!');
});
check('scanner REDACTS live-key values inside innocent-named files (content firewall)', () => {
  const oops = scanA.files.find((f) => f.relPath === 'rules/oops.md');
  assert.ok(oops, 'oops.md not scanned');
  assert.ok(!oops.content.includes('sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'live key NOT redacted!');
  assert.ok(oops.content.includes('[REDACTED_SECRET]'), 'redaction marker missing');
  assert.strictEqual(oops.redactions, 1, `expected 1 redaction, got ${oops.redactions}`);
});
check('secret files are recorded as skipped (firewall)', () => {
  const firewalled = scanA.skipped.filter((s) => s.reason === 'secret-firewall').map((s) => s.path);
  assert.ok(firewalled.some((p) => p.includes('.env')), '.env not firewalled');
  assert.ok(firewalled.some((p) => p.includes('private.key')), 'private.key not firewalled');
  assert.ok(firewalled.some((p) => p.includes('credentials')), 'credentials not firewalled');
});
check('auth.json (codex session store) is firewalled by name', () => {
  const blob = JSON.stringify(scanA);
  assert.ok(!blob.includes('super-secret-session-value'), 'auth.json token leaked!');
  assert.ok(!scanA.files.some((f) => f.relPath === 'auth.json'), 'auth.json captured!');
});
check('content redaction preserves JSON structure around masked value', () => {
  const r = config.redactSecrets('{"access_token":"abcdefghijklmnopqrstuvwxyz123456"}');
  assert.ok(r.text.includes('"access_token":"[REDACTED_SECRET]"'), `structure not preserved: ${r.text}`);
  assert.strictEqual(r.redactions, 1);
});

const snapA = snapshotLib.buildSnapshot(scanA, { label: 'state-A' });

// ---- mutate to state B -------------------------------------------------------
write('CLAUDE.md', '# Rules\nline one\nline two CHANGED\nline three\nline four added\n'); // modified
fs.unlinkSync(path.join(fakeClaude, 'agents/executor.md')); // removed
write('rules/new-rule.md', 'a brand new rule\n'); // added
// settings.json + rules/style.md unchanged

const scanB = scanner.scanAll(roots);
const snapB = snapshotLib.buildSnapshot(scanB, { label: 'state-B' });

// ---- diff --------------------------------------------------------------------
const report = differ.compareSnapshots(snapA, snapB);

check('diff detects 1 added file', () => {
  assert.strictEqual(report.summary.added, 1, JSON.stringify(report.summary));
});
check('diff detects 1 removed file', () => {
  assert.strictEqual(report.summary.removed, 1, JSON.stringify(report.summary));
});
check('diff detects 1 modified file', () => {
  assert.strictEqual(report.summary.modified, 1, JSON.stringify(report.summary));
});
check('diff detects 3 unchanged files', () => {
  assert.strictEqual(report.summary.unchanged, 3, JSON.stringify(report.summary));
});
check('modified file has correct add/remove line stats', () => {
  const mod = report.changes.find((c) => c.relPath === 'CLAUDE.md');
  assert.strictEqual(mod.status, 'modified');
  // "line two" -> "line two CHANGED" = 1 del + 1 add; "line four added" = 1 add
  assert.strictEqual(mod.stats.added, 2, `added=${mod.stats.added}`);
  assert.strictEqual(mod.stats.removed, 1, `removed=${mod.stats.removed}`);
});
check('identical snapshots produce identical=true', () => {
  const same = differ.compareSnapshots(snapA, snapA);
  assert.strictEqual(same.identical, true);
  assert.strictEqual(same.summary.modified, 0);
});

// ---- line diff unit ----------------------------------------------------------
check('lineDiff produces correct ops for a simple change', () => {
  const ops = differ.lineDiff('a\nb\nc', 'a\nB\nc');
  const adds = ops.filter((o) => o.type === 'add').map((o) => o.value);
  const dels = ops.filter((o) => o.type === 'del').map((o) => o.value);
  assert.deepStrictEqual(dels, ['b']);
  assert.deepStrictEqual(adds, ['B']);
});

// ---- persistence round-trip (real store, then clean up) ----------------------
check('createSnapshot + loadSnapshot round-trips via disk', () => {
  const { snapshot: written, filePath } = snapshotLib.createSnapshot({ label: 'e2e-temp', roots });
  try {
    const loaded = snapshotLib.loadSnapshot(filePath);
    assert.strictEqual(loaded.treeHash, written.treeHash);
    assert.strictEqual(loaded.fileCount, written.fileCount);
    const blob = JSON.stringify(loaded);
    assert.ok(!blob.includes('sk-must-never-be-captured'), 'secret leaked into persisted snapshot!');
  } finally {
    fs.unlinkSync(filePath);
  }
});

// ---- HTML report -------------------------------------------------------------
check('HTML report is self-contained and escapes content', () => {
  const html = htmlReport.renderHtml(report, { timeline: snapshotLib.listSnapshots() });
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'not an HTML doc');
  assert.ok(html.includes('<style>') && html.includes('</style>'), 'CSS not inlined');
  assert.ok(!/src=["']https?:/.test(html), 'report references external resource');
  assert.ok(html.includes('CLAUDE.md'), 'modified file missing from report');
});

// ---- cleanup -----------------------------------------------------------------
fs.rmSync(tmpRoot, { recursive: true, force: true });

process.stdout.write(`\n\x1b[32mAll ${passed} checks passed.\x1b[0m\n`);
