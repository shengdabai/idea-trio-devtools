'use strict';

const os = require('os');
const path = require('path');

/**
 * Central configuration for promptdiff.
 *
 * Everything here is pure data + helpers. No side effects, no mutation of
 * passed-in objects. The scanner/snapshot/differ modules import these to know
 * WHAT to scan, what to skip (secrets firewall), and where to store state.
 */

const HOME = os.homedir();

// Directories whose config we track. Each entry is a logical "root".
// We resolve them lazily so a missing ~/.codex doesn't break ~/.claude scans.
//
// `include` (optional) restricts the scan to *authored config* and skips
// runtime/installed data. When present, we capture:
//   - top-level tracked files directly under `dir`
//   - everything under each named subdirectory
// When absent (e.g. ~/.codex), the whole tree is scanned (minus SKIP_DIRS).
// This keeps snapshots about the config the USER writes, not installed plugins
// or session logs that would drown real diffs in noise.
const DEFAULT_ROOTS = Object.freeze([
  {
    id: 'claude',
    label: 'Claude Code (~/.claude)',
    dir: path.join(HOME, '.claude'),
    include: Object.freeze([
      'agents',
      'skills',
      'rules',
      'commands',
      'hooks',
      'output-styles',
      'cli-modes',
      'mcp-templates',
      'design-systems',
    ]),
  },
  {
    id: 'codex',
    label: 'Codex (~/.codex)',
    dir: path.join(HOME, '.codex'),
    include: Object.freeze([
      'prompts',
      'agents',
      'skills',
      'hooks',
    ]),
  },
]);

// File extensions we consider "config worth tracking".
const TRACKED_EXTENSIONS = Object.freeze(['.md', '.json', '.toml', '.yaml', '.yml']);

// SECRETS FIREWALL — file name / path patterns we MUST NOT read or snapshot.
// Matched case-insensitively against both the basename and the full relative path.
const SECRET_PATTERNS = Object.freeze([
  /(^|[._-])env($|[._-])/i, // .env, .env.local, env.production
  /\.env\b/i,
  /\.pem$/i,
  /\.key$/i,
  /\.crt$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /id_dsa/i,
  /id_ecdsa/i,
  /credentials/i,
  /secrets?\b/i,
  /\.netrc$/i,
  /\.pgpass$/i,
  /\.npmrc$/i,
  /\.htpasswd$/i,
  /token/i,
  /apikey/i,
  /api[_-]key/i,
  /password/i,
  // Auth / session credential stores. ~/.codex/auth.json holds OPENAI_API_KEY +
  // id_token/access_token/refresh_token — must never be captured.
  /(^|[._-])auth($|[._-])/i, // auth.json, .auth, user-auth.json
  /\.auth\b/i,
  /session/i,
  /oauth/i,
]);

// Directory names we never descend into (noise / heavy / runtime data).
// These are still honored even inside an `include`d subdirectory.
const SKIP_DIRS = Object.freeze(new Set([
  'node_modules',
  '.git',
  'cache',
  'caches',
  'logs',
  'backups',
  'downloads',
  'paste-cache',
  'file-history',
  'debug',
  'ide',
  'tmp',
  'temp',
  '.DS_Store',
  // Runtime / installed-data trees — not authored config, would flood diffs.
  'projects', // per-project session jsonl + memory
  'plugins', // installed marketplace plugins (third-party)
  'data', // plugin/runtime state
  'statsig',
  'todos',
  'shell-snapshots',
  'history',
  'sessions',
  'usage',
]));

// Content-level secret patterns. A defense-in-depth layer: even when a file's
// NAME is innocent (a .md doc, a settings.json), if a LIVE credential value
// appears in its body we redact that value before storing it in a snapshot.
// We deliberately target value SHAPES (long high-entropy tokens), not the mere
// word "sk-", so documentation that merely mentions "sk-..." is left intact.
const SECRET_CONTENT_PATTERNS = Object.freeze([
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic
  /sk-proj-[A-Za-z0-9_-]{20,}/g, // OpenAI project
  /sk-[A-Za-z0-9]{32,}/g, // generic OpenAI-style
  /ghp_[A-Za-z0-9]{30,}/g, // GitHub PAT
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /AIza[0-9A-Za-z_-]{35}/g, // Google API key
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
  // OAuth/JWT token VALUES in JSON config: "access_token":"<long>", etc.
  // Redacts the value, keeps the structure visible so diffs still show the key
  // existed/changed without exposing it.
  /("(?:access_token|refresh_token|id_token|client_secret|bearer)"\s*:\s*")[^"]{16,}(")/gi,
  // Bare JWTs (three base64url segments).
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
]);

const REDACTION = '[REDACTED_SECRET]';

// Where snapshots and reports live.
const STORE_DIR = path.join(HOME, '.promptdiff');
const SNAPSHOTS_DIR = path.join(STORE_DIR, 'snapshots');
const REPORT_PATH = path.join(STORE_DIR, 'report.html');

// Skip files larger than this (bytes) to avoid hashing huge blobs.
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Decide whether a given relative path / basename is a secret we must skip.
 * @param {string} relPath - path relative to a root
 * @param {string} baseName - just the file name
 * @returns {boolean}
 */
function isSecretPath(relPath, baseName) {
  const haystacks = [baseName, relPath];
  return SECRET_PATTERNS.some((re) => haystacks.some((h) => re.test(h)));
}

/**
 * Whether a file extension is tracked.
 * @param {string} ext - lowercased extension including dot
 * @returns {boolean}
 */
function isTrackedExtension(ext) {
  return TRACKED_EXTENSIONS.includes(ext.toLowerCase());
}

/**
 * Redact any live-credential-shaped values from file content before it is
 * stored in a snapshot. Returns { text, redactions } where redactions is the
 * count of substitutions made. Pure: never mutates input.
 * @param {string} content
 * @returns {{text:string, redactions:number}}
 */
function redactSecrets(content) {
  return SECRET_CONTENT_PATTERNS.reduce(
    (acc, re) => {
      let count = 0;
      const text = acc.text.replace(re, (match, ...groups) => {
        count += 1;
        // Drop the trailing offset/string args Node passes to the replacer.
        const named = groups.slice(0, Math.max(0, groups.length - 2));
        // Patterns with two capture groups wrap the secret VALUE (e.g.
        // `"access_token":"…"`) — preserve the surrounding structure so the
        // diff still shows the field exists, only the value is masked.
        if (named.length >= 2 && named[0] !== undefined && named[1] !== undefined) {
          return `${named[0]}${REDACTION}${named[1]}`;
        }
        return REDACTION;
      });
      return { text, redactions: acc.redactions + count };
    },
    { text: content, redactions: 0 },
  );
}

module.exports = Object.freeze({
  HOME,
  DEFAULT_ROOTS,
  TRACKED_EXTENSIONS,
  SECRET_PATTERNS,
  SKIP_DIRS,
  SECRET_CONTENT_PATTERNS,
  REDACTION,
  STORE_DIR,
  SNAPSHOTS_DIR,
  REPORT_PATH,
  MAX_FILE_BYTES,
  isSecretPath,
  isTrackedExtension,
  redactSecrets,
});
