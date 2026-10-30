// lib/scorer.js
// Aggregate per-rule results into a 0-100 weighted score per file, and roll up
// directory-level statistics.

import { runRules, TYPE_LABELS } from './rules.js';
import { loadFile } from './discover.js';

// Score a single already-loaded file object ({ path, type, content, bytes }).
export function scoreFile(file) {
  const findings = runRules(file);
  const totalWeight = findings.reduce((sum, f) => sum + f.weight, 0) || 1;
  const earned = findings.reduce((sum, f) => sum + f.weight * f.score, 0);
  const score = Math.round((earned / totalWeight) * 100);

  // Top issues = failing/warning rules, worst (lowest score × highest weight) first.
  const issues = findings
    .filter((f) => !f.pass)
    .sort((a, b) => b.weight * (1 - b.score) - a.weight * (1 - a.score));

  return {
    path: file.path,
    type: file.type,
    typeLabel: TYPE_LABELS[file.type] || file.type,
    bytes: file.bytes,
    score,
    findings,
    issues,
  };
}

// Load + score a discovery entry. Returns a result or an error-shaped result.
export async function scoreEntry(entry) {
  try {
    const file = await loadFile(entry);
    return scoreFile(file);
  } catch (error) {
    return {
      path: entry.path,
      type: entry.type,
      typeLabel: TYPE_LABELS[entry.type] || entry.type,
      bytes: 0,
      score: 0,
      findings: [],
      issues: [],
      error: error.message,
    };
  }
}

// Score many entries (sequential — these are tiny files; IO is the cost and
// sequential keeps memory flat and output deterministic).
export async function scoreAll(entries) {
  const results = [];
  for (const entry of entries) {
    results.push(await scoreEntry(entry));
  }
  return results;
}

// Roll up an overall summary across scored files.
export function summarize(results) {
  if (results.length === 0) {
    return { count: 0, average: 0, byType: {}, worst: null, best: null };
  }
  const sorted = [...results].sort((a, b) => a.score - b.score);
  const average = Math.round(
    results.reduce((s, r) => s + r.score, 0) / results.length
  );
  const byType = {};
  for (const r of results) {
    const key = r.typeLabel;
    if (!byType[key]) byType[key] = { count: 0, total: 0 };
    byType[key].count += 1;
    byType[key].total += r.score;
  }
  for (const key of Object.keys(byType)) {
    byType[key].average = Math.round(byType[key].total / byType[key].count);
  }
  return {
    count: results.length,
    average,
    byType,
    worst: sorted[0],
    best: sorted[sorted.length - 1],
    totalIssues: results.reduce((s, r) => s + r.issues.length, 0),
  };
}
