// lib/colors.js
// Zero-dependency ANSI color helpers. Respects NO_COLOR and non-TTY output.

const enabled =
  process.env.NO_COLOR === undefined &&
  process.env.FORCE_COLOR !== '0' &&
  (process.stdout.isTTY || process.env.FORCE_COLOR === '1');

const wrap = (open, close) => (text) =>
  enabled ? `[${open}m${text}[${close}m` : String(text);

export const colors = Object.freeze({
  enabled,
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
});

// Map a 0-100 score to a color function + a letter grade.
export function scoreColor(score) {
  if (score >= 85) return colors.green;
  if (score >= 70) return colors.cyan;
  if (score >= 50) return colors.yellow;
  return colors.red;
}

export function grade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
