'use strict';

const snapshot = require('./snapshot');
const differ = require('./differ');
const terminal = require('./terminal');
const htmlReport = require('./html-report');
const config = require('./config');

/**
 * Command-line orchestration. Each command is a small pure-ish function that
 * returns an exit code. `main(argv)` parses and dispatches.
 */

const VERSION = require('../package.json').version;

const HELP = `promptdiff v${VERSION} — snapshot, diff & timeline your AI config

Usage:
  promptdiff snapshot [--label <name>]   Capture current config as a snapshot
  promptdiff list                        List all snapshots (newest first)
  promptdiff diff <a> <b>                Diff two snapshots
  promptdiff diff <a>                    Diff a snapshot vs current live config
  promptdiff report [<a> <b>]            Write self-contained HTML report
  promptdiff restore <id> [--dry-run]    Write a snapshot back onto live config
  promptdiff roots                       Show which directories are tracked
  promptdiff help | --help | -h          Show this help
  promptdiff version | --version         Show version

Selectors for <a>/<b>:
  - full snapshot id        - id prefix (if unambiguous)
  - 1, 2, 3 ...             (1 = newest)        - latest / HEAD
  - a label set via --label

Notes:
  Snapshots live in ${config.SNAPSHOTS_DIR}
  Report is written to ${config.REPORT_PATH}
  Secret files (.env / *.pem / *.key / credentials / secrets ...) are NEVER captured.
`;

/**
 * Parse `--flag value` and `--flag=value` pairs out of args.
 * @param {string[]} args
 * @returns {{flags:object, positional:string[]}}
 */
function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
          i += 1;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/**
 * `snapshot` command.
 * @param {object} flags
 * @returns {number} exit code
 */
function cmdSnapshot(flags) {
  const label = typeof flags.label === 'string' ? flags.label : undefined;
  const { snapshot: snap, filePath } = snapshot.createSnapshot({ label });
  process.stdout.write(`${terminal.c('green', '✓ snapshot created')}\n`);
  process.stdout.write(`  id:    ${terminal.c('bold', snap.id)}${snap.label ? terminal.c('yellow', ` [${snap.label}]`) : ''}\n`);
  process.stdout.write(`  files: ${snap.fileCount} tracked, ${snap.skippedCount} skipped\n`);
  process.stdout.write(`  tree:  ${snap.treeHash.slice(0, 16)}\n`);
  process.stdout.write(`  path:  ${terminal.c('gray', filePath)}\n`);
  return 0;
}

/**
 * `list` command.
 * @returns {number}
 */
function cmdList() {
  const metas = snapshot.listSnapshots();
  process.stdout.write(`${terminal.renderList(metas)}\n`);
  return 0;
}

/**
 * `roots` command — show tracked directories and existence.
 * @returns {number}
 */
function cmdRoots() {
  const fs = require('fs');
  process.stdout.write(`${terminal.c('bold', 'Tracked config roots:')}\n`);
  config.DEFAULT_ROOTS.forEach((r) => {
    const exists = fs.existsSync(r.dir);
    const mark = exists ? terminal.c('green', '✓') : terminal.c('gray', '·');
    process.stdout.write(`  ${mark} ${terminal.c('bold', r.id)}  ${r.dir}${exists ? '' : terminal.c('gray', ' (not present)')}\n`);
  });
  process.stdout.write(`\nExtensions: ${config.TRACKED_EXTENSIONS.join(' ')}\n`);
  return 0;
}

/**
 * Load base + target snapshots from positional selectors.
 * One arg => base=snapshot(arg), target=current live config.
 * Two args => base=arg0, target=arg1.
 * @param {string[]} positional
 * @returns {{base:object, target:object}}
 */
function resolvePair(positional) {
  if (positional.length === 1) {
    return { base: snapshot.loadSnapshot(positional[0]), target: snapshot.snapshotCurrent() };
  }
  if (positional.length >= 2) {
    return { base: snapshot.loadSnapshot(positional[0]), target: snapshot.loadSnapshot(positional[1]) };
  }
  // Zero args: latest snapshot vs current config (most common "what changed since I last saved?")
  const list = snapshot.listSnapshots();
  if (list.length === 0) {
    throw new Error('No snapshots exist yet. Run: promptdiff snapshot');
  }
  return { base: snapshot.loadSnapshot(list[0].filePath), target: snapshot.snapshotCurrent() };
}

/**
 * `diff` command.
 * @param {object} flags
 * @param {string[]} positional
 * @returns {number}
 */
function cmdDiff(flags, positional) {
  const { base, target } = resolvePair(positional);
  const context = flags.context ? Number(flags.context) : 3;
  const report = differ.compareSnapshots(base, target, { context });
  process.stdout.write(`${terminal.renderReport(report, { showUnchanged: Boolean(flags.all) })}\n`);
  return report.identical ? 0 : 1;
}

/**
 * `report` command.
 * @param {object} flags
 * @param {string[]} positional
 * @returns {number}
 */
function cmdReport(flags, positional) {
  const { base, target } = resolvePair(positional);
  const report = differ.compareSnapshots(base, target, { context: flags.context ? Number(flags.context) : 3 });
  const outPath = htmlReport.writeReport(report, {
    timeline: snapshot.listSnapshots(),
    outPath: typeof flags.out === 'string' ? flags.out : undefined,
  });
  process.stdout.write(`${terminal.c('green', '✓ HTML report written')}\n`);
  process.stdout.write(`  ${outPath}\n`);
  process.stdout.write(`  ${terminal.c('gray', `open ${outPath}`)}\n`);
  return 0;
}

/**
 * `restore` command — write a snapshot's files back onto the live config tree.
 * Always takes a pre-restore safety snapshot first (unless --dry-run).
 * @param {object} flags
 * @param {string[]} positional
 * @returns {number}
 */
function cmdRestore(flags, positional) {
  const selector = positional[0];
  if (!selector) {
    process.stderr.write(`${terminal.c('red', 'restore needs a snapshot selector: promptdiff restore <id> [--dry-run]')}\n`);
    return 2;
  }
  const dryRun = Boolean(flags['dry-run'] || flags.dryRun || flags.n);
  const result = snapshot.restoreSnapshot(selector, { dryRun });
  const { plan } = result;

  const writes = plan.actions.filter((a) => a.action === 'write');
  const blocked = plan.actions.filter((a) => a.action === 'blocked');
  const unchanged = plan.actions.filter((a) => a.action === 'unchanged');
  const skipped = plan.actions.filter((a) => a.action === 'skip');

  process.stdout.write(`${terminal.c('bold', dryRun ? 'restore plan (dry-run)' : 'restore')} for ${terminal.c('bold', result.snapshot.id)}${result.snapshot.label ? terminal.c('yellow', ` [${result.snapshot.label}]`) : ''}\n`);

  writes.forEach((a) => {
    const verb = dryRun ? 'would write' : 'wrote';
    process.stdout.write(`  ${terminal.c('green', verb)} ${a.root}/${a.relPath} ${terminal.c('gray', `(${a.reason})`)}\n`);
  });
  blocked.forEach((a) => {
    process.stdout.write(`  ${terminal.c('red', 'blocked')} ${a.root}/${a.relPath} ${terminal.c('gray', `(${a.reason} — never restored)`)}\n`);
  });
  skipped.forEach((a) => {
    process.stdout.write(`  ${terminal.c('yellow', 'skipped')} ${a.root}/${a.relPath} ${terminal.c('gray', `(${a.reason})`)}\n`);
  });

  process.stdout.write(
    `\n  ${writes.length} ${dryRun ? 'to write' : 'written'}, ${unchanged.length} unchanged`
    + `${blocked.length ? `, ${terminal.c('red', `${blocked.length} blocked`)}` : ''}`
    + `${skipped.length ? `, ${skipped.length} skipped` : ''}\n`,
  );

  if (dryRun) {
    process.stdout.write(`  ${terminal.c('gray', 'dry-run: nothing was written. Re-run without --dry-run to apply.')}\n`);
  } else if (result.preRestore) {
    process.stdout.write(`  ${terminal.c('gray', `safety snapshot of prior state: ${result.preRestore.id} (restore it to undo)`)}\n`);
  }
  return 0;
}

/**
 * Main dispatcher.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {number} exit code
 */
function main(argv) {
  const [command, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);

  try {
    switch (command) {
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        process.stdout.write(HELP);
        return 0;
      case 'version':
      case '--version':
      case '-v':
        process.stdout.write(`${VERSION}\n`);
        return 0;
      case 'snapshot':
      case 'snap':
        return cmdSnapshot(flags);
      case 'list':
      case 'ls':
        return cmdList();
      case 'roots':
        return cmdRoots();
      case 'diff':
        return cmdDiff(flags, positional);
      case 'report':
        return cmdReport(flags, positional);
      case 'restore':
        return cmdRestore(flags, positional);
      default:
        process.stderr.write(`${terminal.c('red', `Unknown command: ${command}`)}\n\n${HELP}`);
        return 2;
    }
  } catch (error) {
    process.stderr.write(`${terminal.c('red', `Error: ${error.message}`)}\n`);
    if (process.env.PROMPTDIFF_DEBUG) {
      process.stderr.write(`${error.stack}\n`);
    }
    return 1;
  }
}

module.exports = Object.freeze({ main, parseArgs, VERSION });
