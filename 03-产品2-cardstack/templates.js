/**
 * templates.js — CardStack 主题/模板定义
 *
 * 每个模板是一个不可变的纯数据对象，描述卡片的视觉风格。
 * 渲染逻辑统一在 app.js，模板只声明 CSS 变量与少量结构开关，
 * 保证「换皮不换骨」——新增模板只需在这里 push 一个对象。
 *
 * 设计取向：克制（Vercel/Notion/Stripe）。靠字号层级、间距、
 * 单一强调色、细腻阴影制造高级感，拒绝廉价渐变 + 花哨描边的 AI 感。
 */

// 冻结工具：深冻结，保证模板数据全程不可变
const deepFreeze = (obj) => {
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  });
  return Object.freeze(obj);
};

const TEMPLATES = deepFreeze([
  {
    id: 'dark-tech',
    name: '暗色科技',
    desc: '深色背景 + 青色强调，理性、克制、适合技术与商业观点',
    // CSS 变量：注入到 .card 的 inline style
    vars: {
      '--card-bg': 'radial-gradient(120% 120% at 0% 0%, #16181d 0%, #0b0c0f 60%)',
      '--card-fg': '#f4f5f7',
      '--card-muted': '#9aa3af',
      '--card-accent': '#36e6c0',
      '--card-rule': 'rgba(255,255,255,0.08)',
      '--card-shadow': '0 24px 60px -20px rgba(0,0,0,0.55)',
      '--card-kicker-bg': 'rgba(54,230,192,0.12)',
      '--card-kicker-fg': '#36e6c0',
      '--card-bullet': '#36e6c0',
      '--card-quote': 'rgba(255,255,255,0.05)',
      '--card-font-title': "'Noto Serif SC', Georgia, serif",
      '--card-font-body': "'Inter', 'Noto Sans SC', system-ui, sans-serif",
    },
  },
  {
    id: 'warm-editorial',
    name: '暖色编辑',
    desc: '米白纸感 + 赭石强调，杂志编辑风，适合人文、随笔、深度长文',
    vars: {
      '--card-bg': 'linear-gradient(180deg, #fbf7f0 0%, #f5ede1 100%)',
      '--card-fg': '#2b2521',
      '--card-muted': '#8a7c6d',
      '--card-accent': '#c0633a',
      '--card-rule': 'rgba(43,37,33,0.12)',
      '--card-shadow': '0 24px 60px -24px rgba(120,90,60,0.35)',
      '--card-kicker-bg': 'rgba(192,99,58,0.12)',
      '--card-kicker-fg': '#a8512c',
      '--card-bullet': '#c0633a',
      '--card-quote': 'rgba(43,37,33,0.04)',
      '--card-font-title': "'Noto Serif SC', Georgia, serif",
      '--card-font-body': "'Noto Serif SC', Georgia, serif",
    },
  },
  {
    id: 'minimal-white',
    name: '极简留白',
    desc: '纯白大留白 + 黑色文字，Notion/Stripe 式克制，万能百搭',
    vars: {
      '--card-bg': '#ffffff',
      '--card-fg': '#111315',
      '--card-muted': '#6b7280',
      '--card-accent': '#111315',
      '--card-rule': 'rgba(17,19,21,0.10)',
      '--card-shadow': '0 18px 50px -22px rgba(17,19,21,0.22)',
      '--card-kicker-bg': 'rgba(17,19,21,0.06)',
      '--card-kicker-fg': '#111315',
      '--card-bullet': '#111315',
      '--card-quote': 'rgba(17,19,21,0.035)',
      '--card-font-title': "'Inter', 'Noto Sans SC', system-ui, sans-serif",
      '--card-font-body': "'Inter', 'Noto Sans SC', system-ui, sans-serif",
    },
  },
  {
    id: 'gradient-knowledge',
    name: '知识卡渐变',
    desc: '深靛到紫的柔和渐变 + 暖白文字，适合小红书知识卡、金句卡',
    vars: {
      '--card-bg': 'linear-gradient(150deg, #3b3a72 0%, #5b4b8a 45%, #7a5ea0 100%)',
      '--card-fg': '#fdfdff',
      '--card-muted': 'rgba(253,253,255,0.72)',
      '--card-accent': '#ffd56b',
      '--card-rule': 'rgba(255,255,255,0.18)',
      '--card-shadow': '0 28px 70px -24px rgba(60,50,110,0.6)',
      '--card-kicker-bg': 'rgba(255,213,107,0.18)',
      '--card-kicker-fg': '#ffe39a',
      '--card-bullet': '#ffd56b',
      '--card-quote': 'rgba(255,255,255,0.08)',
      '--card-font-title': "'Noto Serif SC', Georgia, serif",
      '--card-font-body': "'Inter', 'Noto Sans SC', system-ui, sans-serif",
    },
  },
]);

// 尺寸预设。导出像素是逻辑像素，导出时按 scale(2x) 提清晰度。
const SIZES = deepFreeze([
  { id: 'portrait', name: '竖图长卡', w: 1080, h: 1440, ratio: '3:4' },
  { id: 'square', name: '方图', w: 1080, h: 1080, ratio: '1:1' },
]);

const getTemplate = (id) =>
  TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];

const getSize = (id) => SIZES.find((s) => s.id === id) || SIZES[0];

// 同时支持浏览器 <script> 全局引入和 node require（用于自验）。
// 浏览器里 top-level const 不会自动挂到 window，必须显式挂载。
if (typeof window !== 'undefined') {
  window.TEMPLATES = TEMPLATES;
  window.SIZES = SIZES;
  window.getTemplate = getTemplate;
  window.getSize = getSize;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TEMPLATES, SIZES, getTemplate, getSize, deepFreeze };
}
