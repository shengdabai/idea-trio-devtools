// lib/discover.js
// Recursively discover Claude Code ecosystem files and classify each by type.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const FILE_TYPES = Object.freeze({
  SKILL: 'skill',
  CLAUDE_MEMORY: 'claude-memory',
  AGENT: 'agent',
  COMMAND: 'command',
  RULE: 'rule',
});

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  'vendor',
  '.venv',
  'venv',
]);

const MAX_DEPTH = 12;

// Classify a file by its path. Returns a FILE_TYPES value or null if not a target.
export function classify(absPath) {
  const base = path.basename(absPath);
  const lower = base.toLowerCase();
  const segments = absPath.split(path.sep);
  const parentDir = segments[segments.length - 2] || '';
  const parent = parentDir.toLowerCase();

  if (lower === 'skill.md') return FILE_TYPES.SKILL;
  if (lower === 'claude.md' || lower === 'claude.local.md') {
    return FILE_TYPES.CLAUDE_MEMORY;
  }
  if (!lower.endsWith('.md')) return null;

  // Directory-driven classification for the remaining .md files.
  if (parent === 'agents') return FILE_TYPES.AGENT;
  if (parent === 'commands') return FILE_TYPES.COMMAND;
  if (parent === 'rules') return FILE_TYPES.RULE;

  // Also catch files nested one level deeper, e.g. agents/foo/bar.md
  if (segments.includes('agents')) return FILE_TYPES.AGENT;
  if (segments.includes('commands')) return FILE_TYPES.COMMAND;
  if (segments.includes('rules')) return FILE_TYPES.RULE;

  return null;
}

// Walk a directory tree and yield classified target files.
// Returns an array of { path, type }.
export async function discover(rootPath) {
  const root = path.resolve(rootPath);
  let rootStat;
  try {
    rootStat = await fs.stat(root);
  } catch (error) {
    throw new Error(`路径不存在或无法访问: ${root} (${error.code || error.message})`);
  }

  // Single-file input is allowed too.
  if (rootStat.isFile()) {
    const type = classify(root);
    return type ? [{ path: root, type }] : [];
  }

  const found = [];
  const seen = new Set();

  async function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission denied / vanished — skip silently
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue; // avoid loops
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        const type = classify(full);
        if (type && !seen.has(full)) {
          seen.add(full);
          found.push({ path: full, type });
        }
      }
    }
  }

  await walk(root, 0);
  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
}

// Read a discovered file with its metadata.
export async function loadFile(entry) {
  const content = await fs.readFile(entry.path, 'utf8');
  const stat = await fs.stat(entry.path);
  return {
    ...entry,
    content,
    bytes: stat.size,
  };
}
