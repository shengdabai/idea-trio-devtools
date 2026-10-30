// lib/rules.js
// The scoring ruleset. Each rule is pure: it takes a parsed file context and
// returns { id, title, weight, pass, score (0..1), severity, message, fix }.
//
// Design principle (刘小排 "可观测/可量化"): every rule must be explainable —
// it states WHAT it checked, WHY it matters, and HOW to fix it. No black boxes.

import { FILE_TYPES } from './discover.js';
import {
  estimateTokens,
  splitFrontmatter,
  extractHeadings,
  hasExample,
  bodyContentTokens,
} from './parse.js';

// PASS_THRESHOLD — a rule "passes" at >= 0.85, not at floating-point 1.0.
// Real, good-but-not-perfect files earn 0.85-0.99 on individual rules and we
// want those to register as PASS (green), reserving WARN/ERROR for genuine
// gaps. The old `>= 0.999` strict equality dropped every partial score into
// FAIL, collapsing the middle of the distribution.
const PASS_THRESHOLD = 0.85;

// Vague quantifiers that signal an under-specified rule/skill ("有时""一些""尽量").
const VAGUE_TERMS = [
  '尽量', '尽可能', '适当', '一些', '若干', '有时', '通常', '一般来说',
  '某些', '相关的', '合适的', '酌情', '视情况',
  'maybe', 'somewhat', 'generally', 'usually', 'appropriate', 'as needed',
  'sometimes', 'a few', 'several', 'try to', 'when relevant', 'if possible',
];

// Trigger / activation keywords we hope to see in a SKILL description.
const TRIGGER_HINTS = [
  'use when', 'when the user', 'trigger', 'activate', 'invoke',
  '当用户', '当需要', '触发', '使用场景', '适用于', '用于',
];

const severityOf = (score) => {
  if (score >= PASS_THRESHOLD) return 'ok';
  if (score >= 0.5) return 'warn';
  return 'error';
};

function mkRule(id, title, weight, score, message, fix) {
  const s = Math.max(0, Math.min(1, score));
  const pass = s >= PASS_THRESHOLD;
  return {
    id,
    title,
    weight,
    score: s,
    pass,
    severity: severityOf(s),
    message,
    fix: pass ? null : fix,
  };
}

// ---- Shared rule builders ---------------------------------------------------

function ruleStructure(headings, body) {
  const count = headings.length;
  // Don't just count `##` — measure whether the sections actually carry prose.
  // A "## A / ## B / ## C" shell with empty sections is structure theatre.
  const contentTokens = bodyContentTokens(body);
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#{1,6}\s/.test(p) && p.replace(/[#*`>_~|\s-]/g, '').length > 0);
  const hasRealParagraphs = paragraphs.length >= 2;

  // Headings present but the body is hollow → structure is cosmetic only.
  if (count >= 2 && contentTokens < 15) {
    return mkRule('structure', '有清晰的标题结构', 10, 0.4,
      `有 ${count} 个标题，但小节几乎没有正文（约 ${contentTokens} tokens 实质内容）。`,
      '标题不是内容。每个 `##` 下要写出真正的步骤/说明/示例，空标题骗不过模型。');
  }
  if (count >= 2 && (hasRealParagraphs || contentTokens >= 40)) {
    return mkRule('structure', '有清晰的标题结构', 10, 1,
      `检测到 ${count} 个标题层级且小节有实质内容，结构清晰。`);
  }
  if (count >= 2) {
    return mkRule('structure', '有清晰的标题结构', 10, 0.7,
      `有 ${count} 个标题，但正文偏薄。`,
      '在各小节补充可执行内容（步骤、示例、边界情况），让结构承载信息。');
  }
  if (count === 1 || hasRealParagraphs) {
    return mkRule('structure', '有清晰的标题结构', 10, 0.5,
      `仅 ${count} 个标题。`,
      '用 `##` / `###` 把内容拆成可扫读的小节，便于模型与人类定位。');
  }
  return mkRule('structure', '有清晰的标题结构', 10, 0,
    '几乎没有标题结构，正文是一大块。',
    '至少加 2-3 个 `##` 小节（如「使用场景」「步骤」「示例」「反例」）。');
}

function ruleLength(tokens, body) {
  // Penalize both bloat and emptiness. Emptiness is judged on BODY PROSE, not
  // total tokens — a fat frontmatter (description stuffed with trigger words)
  // must not paper over an empty body. The old `tokens < 20` floor measured
  // the whole file, so a shell with a long description sailed past it.
  const contentTokens = bodyContentTokens(body);
  if (contentTokens < 40) {
    const score = contentTokens < 15 ? 0.1 : 0.3;
    return mkRule('length', 'token 体量合理', 10, score,
      `正文实质内容仅约 ${contentTokens} tokens（frontmatter 不算），几乎是空的。`,
      '补充正文：触发条件、步骤、示例、边界情况。空壳文件不会让 Claude 更强。');
  }
  if (tokens <= 1500) {
    return mkRule('length', 'token 体量合理', 10, 1,
      `约 ${tokens} tokens，体量精炼。`);
  }
  if (tokens <= 2500) {
    return mkRule('length', 'token 体量合理', 10, 0.9,
      `约 ${tokens} tokens，体量合理（理想 < 1500，可再精简）。`,
      '主文件保持精炼，把扩展内容挪到 references/*.md 渐进披露。');
  }
  if (tokens <= 5000) {
    return mkRule('length', 'token 体量合理', 10, 0.6,
      `约 ${tokens} tokens，偏长。`,
      '把细节挪到 references/*.md 渐进披露，主文件保持精炼（理想 < 2500 tokens）。');
  }
  return mkRule('length', 'token 体量合理', 10, 0.2,
    `约 ${tokens} tokens，明显臃肿，每次加载都在烧 context。`,
    '强烈建议拆分：主文件只放「何时用 + 核心步骤」，长内容走 references/ 渐进披露。');
}

function ruleVague(text) {
  const lower = text.toLowerCase();
  const hits = VAGUE_TERMS.filter((t) =>
    lower.includes(t.toLowerCase())
  );
  if (hits.length === 0) {
    return mkRule('vague', '无模糊量词/含糊表述', 8, 1, '未发现明显的模糊量词。');
  }
  const score = hits.length >= 4 ? 0.2 : hits.length >= 2 ? 0.5 : 0.7;
  return mkRule('vague', '无模糊量词/含糊表述', 8, score,
    `发现 ${hits.length} 处模糊表述: ${[...new Set(hits)].slice(0, 6).join('、')}`,
    '把「尽量/适当/一些」换成可执行的具体条件或数字，规则才可观测、可验证。');
}

function ruleExample(body) {
  if (hasExample(body)) {
    return mkRule('example', '包含示例/反例', 8, 1, '检测到代码块或示例标记。');
  }
  return mkRule('example', '包含示例/反例', 8, 0,
    '没有任何示例或反例。',
    '加 1-2 个 ```代码块``` 或 <example>，给模型一个可模仿的锚点（正例 + 反例最佳）。');
}

function ruleBytes(bytes) {
  const kb = bytes / 1024;
  if (kb <= 8) {
    return mkRule('filesize', '文件体积健康', 6, 1, `${kb.toFixed(1)} KB，体积精简。`);
  }
  if (kb <= 24) {
    return mkRule('filesize', '文件体积健康', 6, 0.9, `${kb.toFixed(1)} KB，体积健康（< 8KB 更佳）。`,
      '体积尚可；若内容可按主题拆分会更易维护。');
  }
  if (kb <= 48) {
    return mkRule('filesize', '文件体积健康', 6, 0.6, `${kb.toFixed(1)} KB，偏大。`,
      '考虑拆分，超大单文件难维护且加载慢。');
  }
  return mkRule('filesize', '文件体积健康', 6, 0.2, `${kb.toFixed(1)} KB，过大。`,
    '把内容按主题拆成多个小文件（< 24KB / 文件），高内聚低耦合。');
}

// ---- Frontmatter rules (skill / agent) -------------------------------------

function ruleFrontmatterFields(fm, parseError, requiredFields) {
  if (!fm) {
    return mkRule('frontmatter', 'frontmatter 必填字段完整', 18, 0,
      '缺少 YAML frontmatter（`---` 包裹的元数据块）。',
      `在文件开头加 frontmatter，至少包含: ${requiredFields.join(', ')}。`);
  }
  const isEmpty = (v) =>
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0);
  const missing = requiredFields.filter((f) => isEmpty(fm[f]));

  if (missing.length === 0) {
    // All required fields present. A parseError here means our minimal parser
    // hit a structure it could not fully model (e.g. deep nesting) — that is a
    // limitation of the linter, NOT a defect in the file. Don't penalize: the
    // required fields parsed fine, so this rule is satisfied. We surface the
    // limitation as a non-blocking note via a near-perfect score.
    if (parseError) {
      return mkRule('frontmatter', 'frontmatter 必填字段完整', 18, 0.95,
        `必填字段齐全: ${requiredFields.join(', ')}。（注: 部分高级 YAML 结构未被本工具检查，不计扣分）`);
    }
    return mkRule('frontmatter', 'frontmatter 必填字段完整', 18, 1,
      `必填字段齐全: ${requiredFields.join(', ')}。`);
  }

  const ratio = (requiredFields.length - missing.length) / requiredFields.length;
  return mkRule('frontmatter', 'frontmatter 必填字段完整', 18,
    Math.max(0.1, ratio),
    `缺少字段: ${missing.join(', ')}`,
    `补上缺失字段。name/description 是触发的关键，缺了 Claude 可能根本不加载。`);
}

// Measure how many DISTINCT trigger phrases appear, not just whether one does.
// A description that names exactly one "use when" reads as a real cue; one that
// carpet-bombs every hint word is keyword-stuffing, which we detect separately.
function countTriggerHints(lower) {
  return TRIGGER_HINTS.reduce(
    (n, t) => n + (lower.includes(t.toLowerCase()) ? 1 : 0),
    0
  );
}

// Stop-words / connectives that repeat naturally in real prose. Repetition of
// these (or of the single domain keyword) is NOT a stuffing signal, so we
// exclude them when measuring "the same content word hammered over and over".
const STOPWORDS = new Set([
  'the', 'a', 'an', 'or', 'and', 'to', 'of', 'in', 'on', 'for', 'with', 'into',
  'is', 'are', 'be', 'this', 'that', 'it', 'as', 'at', 'by', 'from',
  '的', '了', '和', '或', '与', '把', '将', '是', '在', '用',
]);

// Information density: ratio of distinct words to total words, plus the worst
// repetition of a *content* word. A real sentence reuses connectives but
// introduces many distinct content words; a stuffed keyword list is either
// low-diversity or hammers the same non-stopword token repeatedly.
function describeDensity(desc) {
  const words = (desc.toLowerCase().match(/[a-z0-9]+|[一-鿿]/g) || []);
  const total = words.length;
  if (total === 0) return { total: 0, uniqueRatio: 0, hasVerbStructure: false, repeatRun: 0 };
  const uniq = new Set(words);
  const uniqueRatio = uniq.size / total;

  // Worst repetition among CONTENT words (stopwords + the dominant domain noun
  // excluded). "trigger trigger activate invoke" trips this; "invoice ... or ...
  // or ... invoice" in normal prose does not.
  const counts = {};
  for (const w of words) {
    if (STOPWORDS.has(w) || w.length <= 1) continue;
    counts[w] = (counts[w] || 0) + 1;
  }
  const contentCounts = Object.values(counts).sort((x, y) => y - x);
  // Ignore the single most-frequent content word (the legit domain keyword);
  // a stuffed description repeats MANY words, a real one repeats just its topic.
  const repeatRun = contentCounts.length >= 2 ? contentCounts[1] : 0;

  // Sentence structure: presence of clause punctuation or a copula/verb cue —
  // a flat keyword bag lacks these. Cheap heuristic, not a parser.
  const hasVerbStructure =
    /[.。!?！？]/.test(desc) ||
    /\b(extract|parse|convert|generate|create|review|analyze|turn|produce|build|use when|when the user)\b/i.test(
      desc
    ) ||
    /(把|将|生成|提取|转成|分析|当用户|当需要)/.test(desc);

  return { total, uniqueRatio, hasVerbStructure, repeatRun };
}

function ruleDescriptionQuality(fm) {
  const desc = fm && fm.description ? String(fm.description) : '';
  if (!desc) {
    return mkRule('description', 'description 含触发场景与关键词', 22, 0,
      'description 为空或缺失——这是 skill 最容易被忽视、却最致命的字段。',
      'description 决定 Claude 何时加载这个 skill。写清「做什么 + 何时用(Use when...) + 触发关键词」。');
  }
  const tokens = estimateTokens(desc);
  const lower = desc.toLowerCase();
  const triggerCount = countTriggerHints(lower);
  const { total, uniqueRatio, hasVerbStructure, repeatRun } = describeDensity(desc);

  const longEnough = desc.length >= 40;
  const notTooLong = tokens <= 250;

  // Keyword-stuffing detection: a description that crams MANY distinct trigger
  // hints (a real one names one or two cues, not the whole hint vocabulary), OR
  // hammers multiple content words, OR is a low-diversity bag of nouns with no
  // verb structure, is gaming the trigger match. Core anti-gaming gate.
  const stuffed =
    triggerCount >= 5 ||
    repeatRun >= 3 ||
    (total >= 12 && uniqueRatio < 0.5 && !hasVerbStructure);

  let score = 0;
  const reasons = [];

  // (1) Has a genuine trigger cue (but not stuffed).
  if (triggerCount >= 1 && !stuffed) score += 0.35;
  else if (triggerCount >= 1 && stuffed) reasons.push('触发词堆砌(像关键词清单而非说明)');
  else reasons.push('缺触发场景描述(如「Use when…」「当用户…」)');

  // (2) Reads like a real description: has sentence/verb structure.
  if (hasVerbStructure && !stuffed) score += 0.3;
  else if (!hasVerbStructure) reasons.push('没有动词/句子结构，更像名词堆叠');

  // (3) Information density is healthy (distinct, non-repetitive vocabulary).
  if (total >= 8 && uniqueRatio >= 0.6) score += 0.2;
  else if (total < 8) reasons.push('信息量太少');
  else reasons.push(`词汇重复度高(独立词占比 ${(uniqueRatio * 100).toFixed(0)}%)`);

  // (4) Length sane.
  if (longEnough && notTooLong) score += 0.15;
  else if (!longEnough) reasons.push('过短，信息量不足');
  else reasons.push(`过长(约 ${tokens} tokens)，会拖累每次匹配`);

  // Hard cap: anything detected as stuffed cannot pass, regardless of partials.
  if (stuffed) score = Math.min(score, 0.45);

  if (score >= PASS_THRESHOLD) {
    return mkRule('description', 'description 含触发场景与关键词', 22, score,
      '描述包含真实触发场景、有句子结构、长度适中。');
  }
  return mkRule('description', 'description 含触发场景与关键词', 22, score,
    `description 可优化: ${reasons.join('；')}。`,
    '黄金公式: 「<能力一句话>. Use when <具体场景1>, <场景2>…」。要写成给人读的说明，而非塞满触发词的清单。');
}

// ---- Per-type rule sets -----------------------------------------------------

function scoreSkill(ctx) {
  const { fm, parseError, headings, body, tokens, bytes } = ctx;
  return [
    ruleFrontmatterFields(fm, parseError, ['name', 'description']),
    ruleDescriptionQuality(fm),
    ruleStructure(headings, body),
    ruleLength(tokens, body),
    ruleVague(ctx.fullText),
    ruleExample(body),
    ruleBytes(bytes),
  ];
}

function scoreAgent(ctx) {
  const { fm, parseError, headings, body, tokens, bytes } = ctx;
  return [
    ruleFrontmatterFields(fm, parseError, ['name', 'description']),
    ruleDescriptionQuality(fm),
    ruleStructure(headings, body),
    ruleLength(tokens, body),
    ruleVague(ctx.fullText),
    ruleBytes(bytes),
  ];
}

function scoreCommand(ctx) {
  const { fm, parseError, headings, body, tokens, bytes } = ctx;
  const rules = [
    ruleStructure(headings, body),
    ruleLength(tokens, body),
    ruleVague(ctx.fullText),
    ruleExample(body),
    ruleBytes(bytes),
  ];
  // Commands usually carry a short frontmatter description; reward it but don't hard-require name.
  if (fm) {
    rules.unshift(ruleDescriptionQuality(fm));
  } else {
    rules.unshift(mkRule('frontmatter', '建议加 description frontmatter', 10, 0.4,
      '命令没有 frontmatter description。',
      '加 `description:` 让命令在 `/` 菜单里自解释。'));
  }
  return rules;
}

function scoreClaudeMemory(ctx) {
  const { headings, body, tokens, bytes } = ctx;
  // CLAUDE.md / rules have no frontmatter requirement, but bloat is the #1
  // problem (injected EVERY turn). We also reward *actionable* directives:
  // a rule that shows concrete do/don't, code, or numbered steps drives
  // behavior far better than pure prose — and this dimension gives the
  // scorer real discrimination across otherwise-tidy rule files (instead of
  // every clean file flatly scoring 100).
  return [
    ruleStructure(headings, body),
    ruleClaudeBloat(tokens),
    ruleVague(ctx.fullText),
    ruleActionable(body),
    ruleBytes(bytes),
  ];
}

// Reward concrete, enforceable directives over vague prose. A high-signal rule
// file shows the model exactly what to do/avoid: code blocks, explicit do/don't
// (✅/❌/不要/禁止/必须/正确/错误), or numbered/bulleted steps. Pure narrative
// without any of these is weaker guidance.
function ruleActionable(body) {
  const hasCode = hasExample(body);
  const hasDoDont = /(✅|❌|✓|✗|→|\bdo\b|\bdon't\b|不要|禁止|必须|应当|正确做法|错误做法|反例|anti-?pattern)/i.test(
    body
  );
  const hasSteps = /(^|\n)\s*(\d+[.)、]|[-*+]\s)/.test(body);
  const signals = [hasCode, hasDoDont, hasSteps].filter(Boolean).length;

  if (signals >= 2) {
    return mkRule('actionable', '含可执行/可观测的具体指令', 8, 1,
      '包含示例、明确 do/don\'t 或分步指令，指导性强。');
  }
  if (signals === 1) {
    return mkRule('actionable', '含可执行/可观测的具体指令', 8, 0.7,
      '有一些具体指令，但可更可执行。',
      '补充示例代码块或明确的「✅ 正确 / ❌ 错误」对照，让规则可观测、可验证。');
  }
  return mkRule('actionable', '含可执行/可观测的具体指令', 8, 0.3,
    '几乎全是叙述性文字，缺少可执行的具体指令。',
    '加示例、`do/don\'t` 对照或编号步骤——模型照着抽象描述执行远不如照着具体例子。');
}

function ruleClaudeBloat(tokens) {
  // CLAUDE.md is loaded every single turn — stricter budget than skills.
  if (tokens <= 800) {
    return mkRule('length', 'CLAUDE.md token 预算', 24, 1,
      `约 ${tokens} tokens，预算精简（每轮都加载，越精简越省钱）。`);
  }
  if (tokens <= 1500) {
    return mkRule('length', 'CLAUDE.md token 预算', 24, 0.85,
      `约 ${tokens} tokens，预算健康但仍有压缩空间（理想 < 800）。`,
      '把低频内容挪到 `rules/*.md` 懒加载，主文件只留高频铁律。');
  }
  if (tokens <= 3000) {
    return mkRule('length', 'CLAUDE.md token 预算', 24, 0.6,
      `约 ${tokens} tokens，偏重。CLAUDE.md 每轮注入，直接乘以对话轮数烧钱。`,
      '把按需规则挪到 `rules/*.md` 用 `@import` 懒加载，主文件只留高频铁律。');
  }
  return mkRule('length', 'CLAUDE.md token 预算', 24, 0.25,
    `约 ${tokens} tokens，过重。每轮对话都在重算这些 token。`,
    '强烈建议瘦身：核心铁律留主文件，其余拆 rules/ 按场景 import，可省 30-50% context。');
}

const DISPATCH = {
  [FILE_TYPES.SKILL]: scoreSkill,
  [FILE_TYPES.AGENT]: scoreAgent,
  [FILE_TYPES.COMMAND]: scoreCommand,
  [FILE_TYPES.RULE]: scoreClaudeMemory,
  [FILE_TYPES.CLAUDE_MEMORY]: scoreClaudeMemory,
};

export const TYPE_LABELS = Object.freeze({
  [FILE_TYPES.SKILL]: 'SKILL.md',
  [FILE_TYPES.AGENT]: 'Agent',
  [FILE_TYPES.COMMAND]: 'Command',
  [FILE_TYPES.RULE]: 'Rule',
  [FILE_TYPES.CLAUDE_MEMORY]: 'CLAUDE.md',
});

// Build the parse context once, then run the type-specific rule set.
export function buildContext(file) {
  const { hasFrontmatter, frontmatter, parseError, body } = splitFrontmatter(
    file.content
  );
  const headings = extractHeadings(body);
  return {
    fm: frontmatter,
    hasFrontmatter,
    parseError,
    body,
    headings,
    fullText: file.content,
    tokens: estimateTokens(file.content),
    bytes: file.bytes,
  };
}

export function runRules(file) {
  const fn = DISPATCH[file.type];
  if (!fn) return [];
  const ctx = buildContext(file);
  return fn(ctx);
}
