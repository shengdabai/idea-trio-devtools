// lib/parse.js
// Minimal, dependency-free Markdown + YAML-frontmatter parser.
// We only need a shallow understanding of the file, not a full AST.

// Estimate token count. Heuristic tuned for mixed English + CJK content:
// - CJK chars (Han / Kana / Hangul, incl. SMP extensions) ~1 token each.
// - Emoji and other astral-plane symbols ~1 token each; Latin ~1 token/4 chars.
// This intentionally avoids a tokenizer dependency; it is an estimate, labeled as such.
//
// Iterates by Unicode code point (for..of) so surrogate pairs — CJK
// Extension B+ and emoji — count as ONE unit, not two Latin chars. Uses
// \p{Script=Han} + script/property escapes instead of a fixed BMP range so
// extended CJK is covered correctly. Still an estimate, labeled as such.
const CJK_RE =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function estimateTokens(text) {
  if (!text) return 0;
  let cjkLike = 0;
  let latin = 0;
  for (const ch of text) {
    // `ch` is a full code point here (surrogate pairs already combined).
    if (CJK_RE.test(ch) || EMOJI_RE.test(ch)) {
      cjkLike += 1;
    } else if (ch.codePointAt(0) > 0xffff) {
      // Other astral-plane code points (rare symbols): 1 unit, not 2.
      cjkLike += 1;
    } else {
      latin += 1;
    }
  }
  return Math.round(cjkLike + latin / 4);
}


// Split frontmatter from body. Supports the standard `---\n...\n---` fence.
// Returns { hasFrontmatter, raw, frontmatter (object|null), parseError, body }.
export function splitFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {
      hasFrontmatter: false,
      raw: null,
      frontmatter: null,
      parseError: null,
      body: normalized,
    };
  }
  const raw = match[1];
  const body = match[2] || '';
  const { value, error } = parseSimpleYaml(raw);
  return {
    hasFrontmatter: true,
    raw,
    frontmatter: value,
    parseError: error,
    body,
  };
}

// A deliberately small YAML subset parser: top-level `key: value` pairs,
// simple block scalars (`|`, `>`), inline `[a, b]` lists, block lists, and
// ONE level of nested mapping (`metadata:` then indented `  sub: val`).
// Enough to read SKILL.md / agent frontmatter without pulling in js-yaml.
//
// Nested-mapping support is deliberate: real frontmatter often has a
// `metadata:` block with indented children. Previously these tripped a
// parseError and the file got penalized — a false positive on a perfectly
// legal file. We now parse one level of nesting; deeper structures still
// degrade gracefully (recorded as a soft note, no hard penalty downstream).
export function parseSimpleYaml(raw) {
  const result = {};
  const lines = raw.split('\n');
  let i = 0;
  let error = null;

  // Indent of a line's leading whitespace (tabs count as 1 each — good enough).
  const indentOf = (l) => (l.match(/^[ \t]*/)[0] || '').length;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i += 1;
      continue;
    }
    const kv = line.match(/^([ \t]*)([A-Za-z0-9_-]+):\s?(.*)$/);
    if (!kv) {
      // Unrecognized structure. Record once as a soft note, keep going.
      if (!error) error = `无法解析的 frontmatter 行: "${line.trim()}"`;
      i += 1;
      continue;
    }
    const lineIndent = kv[1].length;
    const key = kv[2];
    let rest = kv[3];

    // Nested mapping: `key:` (empty value) followed by deeper-indented `sub: val`.
    if (
      rest === '' &&
      lines[i + 1] !== undefined &&
      indentOf(lines[i + 1]) > lineIndent &&
      /^[ \t]*[A-Za-z0-9_-]+:\s?/.test(lines[i + 1])
    ) {
      const childIndent = indentOf(lines[i + 1]);
      const child = {};
      i += 1;
      while (
        i < lines.length &&
        (lines[i].trim() === '' ||
          (indentOf(lines[i]) >= childIndent &&
            /^[ \t]*[A-Za-z0-9_-]+:\s?/.test(lines[i])))
      ) {
        if (lines[i].trim() === '') {
          i += 1;
          continue;
        }
        const m = lines[i].match(/^[ \t]*([A-Za-z0-9_-]+):\s?(.*)$/);
        if (!m) break;
        let v = m[2].replace(/\s+#.*$/, '').trim();
        child[m[1]] = stripQuotes(v);
        i += 1;
      }
      result[key] = child;
      continue;
    }

    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const block = [];
      i += 1;
      const baseIndent = lines[i] ? lines[i].match(/^\s*/)[0].length : 0;
      while (
        i < lines.length &&
        (lines[i].trim() === '' || lines[i].match(/^\s*/)[0].length >= baseIndent)
      ) {
        block.push(lines[i].slice(baseIndent));
        i += 1;
      }
      const joiner = rest.startsWith('>') ? ' ' : '\n';
      result[key] = block.join(joiner).trim();
      continue;
    }

    if (rest === '' && lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
      // Block list form:
      //   key:
      //     - a
      //     - b
      const items = [];
      i += 1;
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(stripQuotes(lines[i].replace(/^\s*-\s+/, '').trim()));
        i += 1;
      }
      result[key] = items;
      continue;
    }

    rest = rest.replace(/\s+#.*$/, '').trim();
    if (rest.startsWith('[') && rest.endsWith(']')) {
      result[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => stripQuotes(s.trim()))
        .filter(Boolean);
    } else {
      result[key] = stripQuotes(rest);
    }
    i += 1;
  }

  return { value: result, error };
}

function stripQuotes(s) {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

// Extract ATX headings (`#`, `##`, ...) from a markdown body.
export function extractHeadings(body) {
  const headings = [];
  const lines = body.split('\n');
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      headings.push({ level: m[1].length, text: m[2].trim() });
    }
  }
  return headings;
}

// Does the body contain a *real* example — a NON-EMPTY fenced code block, a
// non-empty <example> block, or an explicit example marker that is followed by
// actual content? An empty ```...``` (a gaming trick to "have an example"
// without writing one) does NOT count.
export function hasExample(body) {
  // Fenced code blocks: capture inner content, require it to be non-trivial.
  const fenceRe = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = fenceRe.exec(body)) !== null) {
    if (m[1].trim().length >= 3) return true; // non-empty code block
  }
  // Single-line / inline fence form: ```code``` on one line.
  const inlineRe = /```([^\n`]+)```/g;
  while ((m = inlineRe.exec(body)) !== null) {
    if (m[1].trim().length >= 3) return true;
  }
  const ex = body.match(/<example>([\s\S]*?)<\/example>/i);
  if (ex && ex[1].trim().length >= 3) return true;
  // An explicit marker only counts if it's followed by real text on/after it.
  const marker = body.match(
    /(^|\n)\s*(例如|示例|Example|For example|e\.g\.)[:：]?\s*([\s\S]{8,})/i
  );
  if (marker && marker[3].trim().length >= 8) return true;
  return false;
}

// Estimate the token weight of *visible prose* in a body — headings text +
// paragraph text + code-block contents — used to detect "shell" files that are
// structurally fine but have almost no actual content. Markdown punctuation
// (`#`, fences, list bullets) is stripped so a heading-only file reads as near-empty.
export function bodyContentTokens(body) {
  if (!body) return 0;
  const stripped = body
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/```[^\n]*/g, '') // keep code text, drop the fence lines
    )
    .replace(/^#{1,6}\s+/gm, '') // heading markers
    .replace(/^\s*[-*+]\s+/gm, '') // list bullets
    .replace(/[#*`>_~|-]/g, ' ') // residual md punctuation
    .replace(/\s+/g, ' ')
    .trim();
  return estimateTokens(stripped);
}
