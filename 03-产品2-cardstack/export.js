/**
 * export.js — 卡片导出为高清 PNG
 *
 * 策略：克隆当前 .card 节点，把它放进一个离屏容器，按尺寸预设固定宽高，
 * 用 html-to-image（CDN 引入，window.htmlToImage）以 pixelRatio=2 渲染成 PNG。
 *
 * 为什么克隆而不是直接截预览：预览区为了适配屏幕用了 transform: scale()，
 * 直接截会把缩放也截进去。克隆出干净的、1:1 真实像素的节点再导出，最清晰。
 *
 * 全程本地、不上传、无后端。
 */

const EXPORT_PIXEL_RATIO = 2;

// 缓存内联好的 @font-face CSS（woff2 已转 data:URI），整个会话只算一次。
let _fontEmbedCssCache = null;

/**
 * 把本地 fonts/fonts.css 里引用的 woff2 抓回来转成 data:URI，
 * 拼成一段可直接喂给 html-to-image 的 fontEmbedCSS。
 *
 * 为什么需要它：html-to-image 默认会去遍历 document.styleSheets 读 cssRules
 * 来内联字体。即便我们已把字体做成同源，某些浏览器/协议（file://）下读取
 * 仍可能抛 SecurityError 或读不到子集，导致导出图字体回退。
 * 这里改成「主动同源 fetch + 自己内联」，把字体牢牢嵌进导出图。
 *
 * @returns {Promise<string>} 内联后的 @font-face CSS；失败返回空串（降级，由调用方告警）
 */
const buildFontEmbedCss = async () => {
  if (_fontEmbedCssCache !== null) return _fontEmbedCssCache;

  const cssResp = await fetch('fonts/fonts.css', { cache: 'force-cache' });
  if (!cssResp.ok) throw new Error(`字体表加载失败：fonts/fonts.css (${cssResp.status})`);
  const cssText = await cssResp.text();

  // 收集所有 url(xxx.woff2)
  const urlRe = /url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)/g;
  const woffPaths = Array.from(
    new Set(Array.from(cssText.matchAll(urlRe), (m) => m[1]))
  );

  // 并发抓取并转 base64 data:URI
  const toDataUri = async (rawPath) => {
    // fonts.css 内的相对路径以 fonts/ 为基准
    const resolved = rawPath.startsWith('http') || rawPath.startsWith('data:')
      ? rawPath
      : `fonts/${rawPath.replace(/^\.?\//, '')}`;
    if (resolved.startsWith('data:')) return [rawPath, resolved];
    const resp = await fetch(resolved, { cache: 'force-cache' });
    if (!resp.ok) throw new Error(`字体子集缺失：${resolved} (${resp.status})`);
    const buf = await resp.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    return [rawPath, `data:font/woff2;base64,${b64}`];
  };

  const pairs = await Promise.all(woffPaths.map(toDataUri));
  const dataUriMap = new Map(pairs);

  // 把 css 里的相对 url 全替成 data:URI
  const inlined = cssText.replace(urlRe, (full, p1) => {
    const di = dataUriMap.get(p1);
    return di ? `url(${di})` : full;
  });

  _fontEmbedCssCache = inlined;
  return inlined;
};

/**
 * 触发浏览器下载
 * @param {string} dataUrl
 * @param {string} filename
 */
const triggerDownload = (dataUrl, filename) => {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * 生成安全文件名（取标题前 20 字 + 时间戳）
 * @param {string} title
 * @returns {string}
 */
const buildFilename = (title) => {
  const cleaned = (title || 'cardstack')
    .trim()
    .replace(/[\\/:*?"<>|\n\r]+/g, '')
    .slice(0, 20) || 'cardstack';
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
  return `${cleaned}-${stamp}.png`;
};

/**
 * 导出卡片为 PNG
 * @param {HTMLElement} cardEl 要导出的卡片节点（真实尺寸，无 scale）
 * @param {{ w: number, h: number }} size 目标像素尺寸
 * @param {string} title 用于文件名
 * @returns {Promise<void>}
 */
const exportCardToPng = async (cardEl, size, title) => {
  if (!cardEl) {
    throw new Error('找不到要导出的卡片节点');
  }
  if (!window.htmlToImage || typeof window.htmlToImage.toPng !== 'function') {
    throw new Error('导出库未加载（html-to-image），请检查网络或 CDN 引用');
  }

  // 离屏容器：放到视口外，保证字体/布局以真实像素渲染但用户看不到
  const stage = document.createElement('div');
  stage.style.position = 'fixed';
  stage.style.left = '-99999px';
  stage.style.top = '0';
  stage.style.width = `${size.w}px`;
  stage.style.height = `${size.h}px`;
  stage.style.pointerEvents = 'none';

  // 克隆卡片，清掉预览用的缩放，锁死真实导出尺寸
  const clone = cardEl.cloneNode(true);
  clone.style.transform = 'none';
  clone.style.margin = '0';
  clone.style.width = `${size.w}px`;
  clone.style.height = `${size.h}px`;
  clone.classList.add('card--export');

  stage.appendChild(clone);
  document.body.appendChild(stage);

  // 先确保字体真的就绪（document.fonts.ready），再内联字体，避免导出图字体回退。
  let fontEmbedCSS = '';
  let fontWarning = null;
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    fontEmbedCSS = await buildFontEmbedCss();
  } catch (fontErr) {
    // 字体内联失败：不静默吞掉，记录并向上层返回告警，让用户知道导出图字体可能回退。
    console.warn('字体内联失败，导出图字体可能回退到系统字体：', fontErr);
    fontWarning = fontErr.message || '字体内联失败';
  }

  try {
    // 等待两帧，确保 webfont 应用、布局稳定
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const options = {
      width: size.w,
      height: size.h,
      pixelRatio: EXPORT_PIXEL_RATIO,
      cacheBust: true,
      style: { margin: '0', transform: 'none' },
    };
    // 拿到内联字体就显式传入，html-to-image 不再去读 document.styleSheets（绕开 SecurityError）。
    if (fontEmbedCSS) options.fontEmbedCSS = fontEmbedCSS;

    const dataUrl = await window.htmlToImage.toPng(clone, options);

    triggerDownload(dataUrl, buildFilename(title));
    // 返回告警（成功导出但字体可能未内联），由 UI 决定如何提示。
    return { ok: true, fontWarning };
  } catch (error) {
    console.error('PNG 导出失败：', error);
    // 跨域 cssRules 这类 SecurityError 不再静默：给出可读、可行动的报错。
    const isSecurity =
      error && (error.name === 'SecurityError' || /cssRules|insecure/i.test(String(error.message)));
    if (isSecurity) {
      throw new Error(
        '导出失败：浏览器拦截了跨域样式（SecurityError）。请用本地静态服务器打开（README 方式 B），不要直接双击 file://。'
      );
    }
    throw new Error('PNG 导出失败，请重试。详情见控制台。');
  } finally {
    document.body.removeChild(stage);
  }
};

// 浏览器里显式挂到 window 供 app.js 调用；node 下走 module.exports。
if (typeof window !== 'undefined') {
  window.exportCardToPng = exportCardToPng;
  window.buildFilename = buildFilename;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportCardToPng, buildFilename, EXPORT_PIXEL_RATIO };
}
