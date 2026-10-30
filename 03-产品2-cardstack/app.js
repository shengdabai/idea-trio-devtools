/**
 * app.js — CardStack 主控制器
 *
 * 职责：
 *  - 维护一个不可变的 state（编辑内容 + 当前模板 + 当前尺寸）
 *  - 把 state 渲染成右侧预览卡片
 *  - 监听编辑区输入、模板/尺寸切换、要点增删、导出
 *
 * 不可变风格：所有 state 变更都返回新对象（{...state, ...patch}），
 * 由 setState 统一驱动重渲染。没有任何就地 mutation。
 *
 * 依赖：templates.js（window TEMPLATES/SIZES/getTemplate/getSize）
 *      export.js（window exportCardToPng）
 */

(() => {
  'use strict';

  // ---------- 0. 安全 HTML 转义（防止用户输入破坏结构 / XSS） ----------
  const escapeHtml = (str) =>
    String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // 把换行转成 <br>（已转义后再处理）
  const nl2br = (safeStr) => safeStr.replace(/\n/g, '<br>');

  // ---------- 1. 初始 state（不可变） ----------
  const DEFAULT_STATE = Object.freeze({
    kicker: 'PRODUCT THINKING',
    title: '不要做用户想要的，\n要做用户离不开的',
    subtitle: '——一个关于「锋利」的小提醒',
    bullets: Object.freeze([
      '功能再多，不解决核心痛点也是负担',
      '小而锋利 > 大而全：先让一群人爱上它',
      'Make something people love，而不是 like',
    ]),
    signature: '@CardStack · 知识卡片生成器',
    templateId: 'dark-tech',
    sizeId: 'portrait',
  });

  let state = DEFAULT_STATE;

  // ---------- 1b. localStorage 持久化（刷新不丢编辑） ----------
  const STORAGE_KEY = 'cardstack.state.v1';

  // 把当前 state 序列化存盘。localStorage 不可用（隐私模式/禁用）时静默降级。
  const persist = () => {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* 配额满/隐私模式：放弃持久化，不影响主流程 */
    }
  };

  // 读取上次编辑并与默认值合并、做基本校验，返回一个冻结的 state（无效则返回 null）。
  const loadPersisted = () => {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;

      // 字段白名单 + 类型/兜底校验，避免脏数据破坏渲染。
      const bullets = Array.isArray(data.bullets)
        ? data.bullets.filter((b) => typeof b === 'string').slice(0, 8)
        : DEFAULT_STATE.bullets.slice();
      const validTpl = window.getTemplate(data.templateId).id;
      const validSize = window.getSize(data.sizeId).id;

      return Object.freeze({
        kicker: typeof data.kicker === 'string' ? data.kicker : DEFAULT_STATE.kicker,
        title: typeof data.title === 'string' ? data.title : DEFAULT_STATE.title,
        subtitle:
          typeof data.subtitle === 'string' ? data.subtitle : DEFAULT_STATE.subtitle,
        bullets: Object.freeze(bullets.length ? bullets : DEFAULT_STATE.bullets.slice()),
        signature:
          typeof data.signature === 'string' ? data.signature : DEFAULT_STATE.signature,
        templateId: validTpl,
        sizeId: validSize,
      });
    } catch (_) {
      return null;
    }
  };

  // 清空持久化（重置示例时用）。
  const clearPersisted = () => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* 忽略 */
    }
  };

  // ---------- 2. DOM 引用 ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const els = {
    kicker: $('#in-kicker'),
    title: $('#in-title'),
    subtitle: $('#in-subtitle'),
    signature: $('#in-signature'),
    bulletList: $('#bullet-list'),
    addBullet: $('#add-bullet'),
    templateGrid: $('#template-grid'),
    sizeGrid: $('#size-grid'),
    preview: $('#preview'),
    card: $('#card'),
    exportBtn: $('#export-btn'),
    resetBtn: $('#reset-btn'),
    toast: $('#toast'),
  };

  // ---------- 3. setState：唯一的状态入口 ----------
  const setState = (patch) => {
    state = Object.freeze({ ...state, ...patch });
    render();
  };

  // ---------- 4. Toast 提示 ----------
  let toastTimer = null;
  const showToast = (msg, isError = false) => {
    els.toast.textContent = msg;
    els.toast.classList.toggle('toast--error', isError);
    els.toast.classList.add('toast--show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('toast--show');
    }, 2600);
  };

  // ---------- 5. 渲染卡片预览 ----------
  const renderCard = () => {
    const tpl = window.getTemplate(state.templateId);
    const size = window.getSize(state.sizeId);
    const card = els.card;

    // 注入模板 CSS 变量
    Object.entries(tpl.vars).forEach(([k, v]) => card.style.setProperty(k, v));

    // 设定真实尺寸 + 比例 class（影响内边距/字号 via CSS）
    card.style.width = `${size.w}px`;
    card.style.height = `${size.h}px`;
    card.dataset.size = size.id;

    const bulletsHtml = state.bullets
      .filter((b) => b.trim() !== '')
      .map(
        (b) =>
          `<li class="card__bullet"><span class="card__dot"></span><span class="card__btext">${nl2br(
            escapeHtml(b)
          )}</span></li>`
      )
      .join('');

    const kickerHtml = state.kicker.trim()
      ? `<div class="card__kicker">${escapeHtml(state.kicker)}</div>`
      : '';
    const subtitleHtml = state.subtitle.trim()
      ? `<p class="card__subtitle">${nl2br(escapeHtml(state.subtitle))}</p>`
      : '';
    const bulletsBlock = bulletsHtml
      ? `<ul class="card__bullets">${bulletsHtml}</ul>`
      : '';
    const signatureHtml = state.signature.trim()
      ? `<div class="card__signature">${escapeHtml(state.signature)}</div>`
      : '';

    card.innerHTML = `
      <div class="card__inner">
        <header class="card__head">
          ${kickerHtml}
          <h1 class="card__title">${nl2br(escapeHtml(state.title))}</h1>
          ${subtitleHtml}
        </header>
        <div class="card__body">
          ${bulletsBlock}
        </div>
        <footer class="card__foot">
          <span class="card__rule"></span>
          ${signatureHtml}
        </footer>
      </div>
    `;

    fitContent(); // 超长内容时自动缩字，保证不裁切
    fitPreview(size);
  };

  // 内容溢出检测 + 自动缩字。
  // .card__inner 是绝对定位、固定画布；内容过长会溢出被 overflow:hidden 裁掉。
  // 这里二分逼近一个 --card-fit-scale（0.6~1），让内容恰好放进画布。
  const fitContent = () => {
    const card = els.card;
    const inner = card.querySelector('.card__inner');
    if (!inner) return;

    const MIN = 0.6;
    const isOverflow = () =>
      inner.scrollHeight > inner.clientHeight + 1 ||
      inner.scrollWidth > inner.clientWidth + 1;

    // 先复位到 1 量一次；不溢出就直接结束。
    card.style.setProperty('--card-fit-scale', '1');
    if (!isOverflow()) return;

    // 二分查找最大的不溢出 scale（10 次足够收敛到 <0.001 精度）。
    let lo = MIN;
    let hi = 1;
    let best = MIN;
    for (let i = 0; i < 10; i += 1) {
      const mid = (lo + hi) / 2;
      card.style.setProperty('--card-fit-scale', String(mid));
      if (isOverflow()) {
        hi = mid;
      } else {
        best = mid;
        lo = mid;
      }
    }
    card.style.setProperty('--card-fit-scale', String(best));
  };

  // 等比缩放卡片以适配预览容器（仅影响显示，不影响导出）
  const fitPreview = (size) => {
    const wrap = els.preview;
    const pad = 48; // 预览区内边距
    const availW = wrap.clientWidth - pad;
    const availH = wrap.clientHeight - pad;
    if (availW <= 0 || availH <= 0) return;
    const scale = Math.min(availW / size.w, availH / size.h, 1);
    els.card.style.transform = `scale(${scale})`;
    // 用包裹盒撑开缩放后的真实占位，避免 scale 后留白错位
    const frame = els.card.parentElement;
    if (frame) {
      frame.style.setProperty('--scaled-h', `${size.h * scale}px`);
      frame.style.setProperty('--scaled-w', `${size.w * scale}px`);
    }
  };

  // ---------- 6. 渲染模板选择器 ----------
  const renderTemplateGrid = () => {
    els.templateGrid.innerHTML = window.TEMPLATES.map((t) => {
      const active = t.id === state.templateId ? ' is-active' : '';
      const swatch = t.vars['--card-bg'];
      const accent = t.vars['--card-accent'];
      return `
        <button class="picker${active}" data-tpl="${t.id}" type="button" title="${escapeHtml(
        t.desc
      )}">
          <span class="picker__swatch" style="background:${swatch}">
            <span class="picker__accent" style="background:${accent}"></span>
          </span>
          <span class="picker__label">${escapeHtml(t.name)}</span>
        </button>`;
    }).join('');
  };

  // ---------- 7. 渲染尺寸选择器 ----------
  const renderSizeGrid = () => {
    els.sizeGrid.innerHTML = window.SIZES.map((s) => {
      const active = s.id === state.sizeId ? ' is-active' : '';
      return `
        <button class="picker picker--size${active}" data-size="${s.id}" type="button">
          <span class="picker__ratio picker__ratio--${s.id}"></span>
          <span class="picker__label">${escapeHtml(s.name)} · ${s.ratio}</span>
        </button>`;
    }).join('');
  };

  // ---------- 8. 渲染要点编辑列表 ----------
  const renderBulletEditors = () => {
    els.bulletList.innerHTML = state.bullets
      .map(
        (b, i) => `
        <div class="bullet-row" data-index="${i}">
          <span class="bullet-row__num">${i + 1}</span>
          <input class="field bullet-row__input" data-bullet="${i}"
            type="text" value="${escapeHtml(b)}" placeholder="输入一个要点…" maxlength="120" />
          <button class="bullet-row__del" data-del="${i}" type="button"
            title="删除" aria-label="删除要点">×</button>
        </div>`
      )
      .join('');
  };

  // ---------- 9. 顶层 render ----------
  const render = () => {
    // 编辑器输入框只在结构变化时重建，避免输入时光标跳动；
    // 这里 renderCard / picker 总是重画，编辑列表按需重建。
    renderCard();
    persist(); // 每次状态变更后落盘到 localStorage
  };

  // 完整重绘（含编辑器结构），用于初始化/增删要点/重置
  const fullRender = () => {
    renderTemplateGrid();
    renderSizeGrid();
    renderBulletEditors();
    syncTextInputs();
    renderCard();
  };

  // 把 state 文本同步回普通输入框（重置时用）
  const syncTextInputs = () => {
    els.kicker.value = state.kicker;
    els.title.value = state.title;
    els.subtitle.value = state.subtitle;
    els.signature.value = state.signature;
  };

  // ---------- 10. 事件绑定 ----------
  const bindEvents = () => {
    // 文本字段（实时）
    els.kicker.addEventListener('input', (e) => setState({ kicker: e.target.value }));
    els.title.addEventListener('input', (e) => setState({ title: e.target.value }));
    els.subtitle.addEventListener('input', (e) => setState({ subtitle: e.target.value }));
    els.signature.addEventListener('input', (e) =>
      setState({ signature: e.target.value })
    );

    // 要点：输入（事件委托，实时改 state，不重建编辑器避免丢焦点）
    els.bulletList.addEventListener('input', (e) => {
      const idx = e.target.getAttribute('data-bullet');
      if (idx === null) return;
      const i = Number(idx);
      const next = state.bullets.map((b, j) => (j === i ? e.target.value : b));
      setState({ bullets: Object.freeze(next) });
    });

    // 要点：删除（委托）
    els.bulletList.addEventListener('click', (e) => {
      const idx = e.target.getAttribute('data-del');
      if (idx === null) return;
      const i = Number(idx);
      if (state.bullets.length <= 1) {
        showToast('至少保留一个要点');
        return;
      }
      const next = state.bullets.filter((_, j) => j !== i);
      setState({ bullets: Object.freeze(next) });
      renderBulletEditors(); // 结构变化，需重建
    });

    // 新增要点
    els.addBullet.addEventListener('click', () => {
      if (state.bullets.length >= 8) {
        showToast('要点最多 8 条，保持卡片克制');
        return;
      }
      const next = [...state.bullets, ''];
      setState({ bullets: Object.freeze(next) });
      renderBulletEditors();
      const inputs = $$('#bullet-list .bullet-row__input');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
    });

    // 模板切换（委托）
    els.templateGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tpl]');
      if (!btn) return;
      setState({ templateId: btn.getAttribute('data-tpl') });
      renderTemplateGrid();
    });

    // 尺寸切换（委托）
    els.sizeGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-size]');
      if (!btn) return;
      setState({ sizeId: btn.getAttribute('data-size') });
      renderSizeGrid();
    });

    // 导出
    els.exportBtn.addEventListener('click', async () => {
      const size = window.getSize(state.sizeId);
      els.exportBtn.disabled = true;
      els.exportBtn.classList.add('is-loading');
      const original = els.exportBtn.textContent;
      els.exportBtn.textContent = '正在生成…';
      try {
        const result = await window.exportCardToPng(els.card, size, state.title);
        // 字体内联失败时不静默：导出成功但提示字体可能回退，让用户有感知。
        if (result && result.fontWarning) {
          showToast('已导出，但字体未能内嵌，图中字体可能回退', true);
        } else {
          showToast('PNG 已导出 ✓');
        }
      } catch (err) {
        showToast(err.message || '导出失败', true);
      } finally {
        els.exportBtn.disabled = false;
        els.exportBtn.classList.remove('is-loading');
        els.exportBtn.textContent = original;
      }
    });

    // 重置：回到示例内容并清除本地草稿
    els.resetBtn.addEventListener('click', () => {
      state = DEFAULT_STATE;
      clearPersisted();
      fullRender();
      persist();
      showToast('已重置为示例内容');
    });

    // 窗口尺寸变化时重新适配预览缩放
    window.addEventListener('resize', () => fitPreview(window.getSize(state.sizeId)));
  };

  // ---------- 11. 启动 ----------
  const init = () => {
    // 防御：必要依赖检查
    if (!window.TEMPLATES || !window.exportCardToPng) {
      console.error('依赖未加载：templates.js / export.js');
      showToast('脚本加载失败，请检查文件完整性', true);
      return;
    }
    // 有本地草稿就恢复，否则用默认示例（刷新不丢编辑）。
    const restored = loadPersisted();
    if (restored) state = restored;
    bindEvents();
    fullRender();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
