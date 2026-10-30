#!/usr/bin/env node
// test/self-test.js
// Minimal dependency-free assertion harness validating core behavior:
// - good fixture scores high, bad fixture scores low (the headline guarantee)
// - discovery + classification work
// - parser, token estimate, and HTML builder behave

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { discover, classify, loadFile, FILE_TYPES } from '../lib/discover.js';
import { scoreFile, summarize } from '../lib/scorer.js';
import {
  estimateTokens,
  splitFrontmatter,
  parseSimpleYaml,
  hasExample,
} from '../lib/parse.js';
import { buildHtml } from '../lib/html-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures');

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

async function run() {
  console.log('SkillLint self-test\n');

  // 1. Classification
  ok(classify('/x/SKILL.md') === FILE_TYPES.SKILL, 'classify SKILL.md → skill');
  ok(
    classify('/x/CLAUDE.md') === FILE_TYPES.CLAUDE_MEMORY,
    'classify CLAUDE.md → claude-memory'
  );
  ok(
    classify('/x/agents/foo.md') === FILE_TYPES.AGENT,
    'classify agents/foo.md → agent'
  );
  ok(
    classify('/x/commands/bar.md') === FILE_TYPES.COMMAND,
    'classify commands/bar.md → command'
  );
  ok(
    classify('/x/rules/baz.md') === FILE_TYPES.RULE,
    'classify rules/baz.md → rule'
  );
  ok(classify('/x/readme.txt') === null, 'classify random .txt → null');

  // 2. Token estimate
  ok(estimateTokens('') === 0, 'estimateTokens("") === 0');
  ok(estimateTokens('一二三四五') === 5, 'estimateTokens CJK ≈ 1/char');
  ok(estimateTokens('abcd'.repeat(10)) > 0, 'estimateTokens latin > 0');

  // 3. Frontmatter parsing
  const fm = splitFrontmatter('---\nname: x\ndescription: hello\n---\n# Body');
  ok(fm.hasFrontmatter === true, 'splitFrontmatter detects fence');
  ok(fm.frontmatter.name === 'x', 'frontmatter name parsed');
  ok(fm.frontmatter.description === 'hello', 'frontmatter description parsed');
  ok(fm.body.includes('# Body'), 'body separated from frontmatter');

  const noFm = splitFrontmatter('# Just a heading\ntext');
  ok(noFm.hasFrontmatter === false, 'splitFrontmatter handles no-frontmatter');

  // 4. Discovery over fixtures
  const entries = await discover(FIXTURES);
  ok(entries.length >= 2, `discover found ${entries.length} fixture files (>=2)`);

  // 5. THE HEADLINE GUARANTEE: good > bad, by a clear margin
  const goodEntry = { path: path.join(FIXTURES, 'good', 'SKILL.md'), type: FILE_TYPES.SKILL };
  const badEntry = { path: path.join(FIXTURES, 'bad', 'SKILL.md'), type: FILE_TYPES.SKILL };
  const goodFile = await loadFile(goodEntry);
  const badFile = await loadFile(badEntry);
  const goodScore = scoreFile(goodFile).score;
  const badScore = scoreFile(badFile).score;

  console.log(`\n  good fixture score = ${goodScore}, bad fixture score = ${badScore}\n`);
  ok(goodScore >= 80, `good SKILL.md scores high (${goodScore} >= 80)`);
  ok(badScore <= 45, `bad SKILL.md scores low (${badScore} <= 45)`);
  ok(goodScore - badScore >= 40, `clear gap between good and bad (${goodScore - badScore} >= 40)`);

  // 5b. ANTI-GAMING GUARANTEE: a "gamer" shell (stuffed description, empty code
  //     block, heading-only body) must NOT pass as healthy.
  const gamerEntry = { path: path.join(FIXTURES, 'gamer', 'SKILL.md'), type: FILE_TYPES.SKILL };
  const gamerScore = scoreFile(await loadFile(gamerEntry)).score;
  console.log(`  gamer shell score = ${gamerScore}`);
  ok(gamerScore < 70, `gamer shell does NOT score healthy (${gamerScore} < 70)`);
  ok(goodScore - gamerScore >= 20, `real file clearly beats gamer shell (${goodScore - gamerScore} >= 20)`);

  // 5c. hasExample rejects EMPTY code fences (a gaming trick).
  ok(hasExample('```\n```') === false, 'empty code fence does not count as example');
  ok(hasExample('```js\nconst x = 1;\n```') === true, 'non-empty code fence counts as example');

  // 5d. estimateTokens handles surrogate pairs (CJK Ext-B + emoji) as 1 unit.
  ok(estimateTokens('\u{20000}\u{20001}\u{20002}') === 3, 'CJK Ext-B surrogate pairs ≈ 1 token each');
  ok(estimateTokens('🚀🎉') === 2, 'emoji ≈ 1 token each (not 2 latin chars)');

  // 5e. parseSimpleYaml supports one level of nested mapping without a parseError.
  const nested = parseSimpleYaml('name: foo\ndescription: bar\nmetadata:\n  author: t\n  version: 2\n');
  ok(nested.error === null, 'nested mapping does not raise a parseError');
  ok(nested.value.name === 'foo', 'parent field parsed alongside nested block');
  ok(nested.value.metadata && nested.value.metadata.author === 't', 'nested child parsed');

  // 6. Findings are explainable: bad file must surface fixes
  const badResult = scoreFile(badFile);
  ok(badResult.issues.length > 0, 'bad file surfaces issues');
  ok(
    badResult.issues.every((i) => i.title && i.message),
    'every issue has title + message'
  );
  ok(
    badResult.issues.some((i) => i.id === 'description'),
    'bad file flags description quality'
  );

  // 7. Summary roll-up
  const results = [goodResultPlaceholder(goodFile), badResult];
  const summary = summarize(results);
  ok(summary.count === 2, 'summarize counts files');
  ok(summary.average > 0, 'summarize computes average');
  ok(summary.worst.score <= summary.best.score, 'summarize identifies worst/best');

  // 8. HTML build produces valid, self-contained output
  const html = buildHtml(results, summary, FIXTURES);
  ok(html.startsWith('<!DOCTYPE html>'), 'HTML starts with doctype');
  ok(html.includes('SkillLint'), 'HTML includes product name');
  ok(!/src=["']https?:/.test(html), 'HTML has no external script/style src (self-contained)');
  ok(html.includes('<style>'), 'HTML embeds inline styles');

  // Write the HTML to a throwaway temp dir: the test must not rewrite the
  // checked-in test/sample-report.html (absolute paths + timestamp churn).
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-lint-selftest-'));
  try {
    const tmpHtml = path.join(tmpDir, 'sample-report.html');
    await fs.writeFile(tmpHtml, html, 'utf8');
    ok((await fs.stat(tmpHtml)).size > 1000, 'sample report written to disk');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // 9. CI gate: a missing/malformed --min-score must fail loudly (exit 2),
  // never silently disable the gate and exit 0.
  const cli = path.join(ROOT, 'bin', 'skill-lint.js');
  const badDir = path.join(FIXTURES, 'bad');
  const exitOf = (extra) =>
    spawnSync(process.execPath, [cli, 'scan', badDir, ...extra], { encoding: 'utf8' }).status;
  ok(exitOf(['--min-score', 'abc']) === 2, '--min-score abc is rejected (exit 2)');
  ok(exitOf(['--min-score']) === 2, '--min-score without value is rejected (exit 2)');
  ok(exitOf(['--min-score', '50abc']) === 2, '--min-score 50abc is rejected (exit 2)');
  ok(exitOf(['--min-score', '101']) === 2, '--min-score above 100 is rejected (exit 2)');
  ok(exitOf(['--min-score', '99']) === 1, 'valid --min-score above average fails the gate (exit 1)');
  ok(exitOf(['--min-score', '0']) === 0, 'valid --min-score below average passes (exit 0)');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function goodResultPlaceholder(file) {
  return scoreFile(file);
}

run().catch((err) => {
  console.error('self-test crashed:', err);
  process.exit(1);
});
