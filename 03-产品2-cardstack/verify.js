/**
 * verify.js — 最小自验脚本（node verify.js）
 *
 * 校验不依赖浏览器的核心逻辑：
 *  1. templates.js 数据完整、不可变、变量齐全
 *  2. export.js 的文件名生成逻辑健壮
 *  3. 不可变更新模式（map/filter 生成新数组）正确
 *  4. HTML 转义逻辑正确
 * 浏览器侧（实时预览 + 真实 PNG 导出）需在浏览器手测。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
const ok = (name, fn) => {
  fn();
  pass += 1;
  console.log(`  ✓ ${name}`);
};

console.log('CardStack 自验开始\n');

// ---- 1. templates.js ----
console.log('[1] templates.js');
const { TEMPLATES, SIZES, getTemplate, getSize } = require('./templates.js');

// 每个模板必须声明的 CSS 变量
const REQUIRED_VARS = [
  '--card-bg', '--card-fg', '--card-muted', '--card-accent',
  '--card-rule', '--card-shadow', '--card-kicker-bg', '--card-kicker-fg',
  '--card-bullet', '--card-quote', '--card-font-title', '--card-font-body',
];

ok('至少 4 套模板', () => assert(TEMPLATES.length >= 4));
ok('每套模板变量齐全', () => {
  TEMPLATES.forEach((t) => {
    assert(t.id && t.name && t.desc, `模板缺字段: ${JSON.stringify(t)}`);
    REQUIRED_VARS.forEach((v) =>
      assert(t.vars[v], `模板 ${t.id} 缺变量 ${v}`)
    );
  });
});
ok('模板 id 唯一', () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});
ok('模板数据不可变(冻结)', () => {
  assert(Object.isFrozen(TEMPLATES));
  assert(Object.isFrozen(TEMPLATES[0]));
  assert(Object.isFrozen(TEMPLATES[0].vars));
});
ok('尺寸预设含竖图与方图', () => {
  assert(SIZES.find((s) => s.id === 'portrait' && s.w === 1080 && s.h === 1440));
  assert(SIZES.find((s) => s.id === 'square' && s.w === 1080 && s.h === 1080));
});
ok('getTemplate 兜底返回首个', () =>
  assert.strictEqual(getTemplate('不存在').id, TEMPLATES[0].id));
ok('getSize 兜底返回首个', () =>
  assert.strictEqual(getSize('不存在').id, SIZES[0].id));

// ---- 2. export.js 文件名逻辑 ----
console.log('\n[2] export.js');
const { buildFilename, EXPORT_PIXEL_RATIO } = require('./export.js');

ok('导出像素比为 2x', () => assert.strictEqual(EXPORT_PIXEL_RATIO, 2));
ok('文件名以 .png 结尾', () => assert(/\.png$/.test(buildFilename('测试标题'))));
ok('文件名清洗非法字符', () => {
  const name = buildFilename('a/b:c*?"<>|d');
  assert(!/[\\/:*?"<>|]/.test(name.replace('.png', '')));
});
ok('空标题兜底为 cardstack', () =>
  assert(/^cardstack-/.test(buildFilename('   '))));
ok('超长标题截断到 20 字内', () => {
  const long = '一'.repeat(100);
  const stem = buildFilename(long).replace(/-\d+\.png$/, '');
  assert(stem.length <= 20, `stem 长度 ${stem.length}`);
});

// ---- 3. 不可变更新模式（模拟 app.js 的 state 操作）----
console.log('\n[3] 不可变更新模式');
ok('要点编辑生成新数组、不 mutate', () => {
  const bullets = Object.freeze(['a', 'b', 'c']);
  const next = bullets.map((b, j) => (j === 1 ? 'B' : b));
  assert.deepStrictEqual(next, ['a', 'B', 'c']);
  assert.deepStrictEqual(bullets, ['a', 'b', 'c']); // 原数组不变
  assert(next !== bullets);
});
ok('要点删除生成新数组', () => {
  const bullets = Object.freeze(['a', 'b', 'c']);
  const next = bullets.filter((_, j) => j !== 1);
  assert.deepStrictEqual(next, ['a', 'c']);
  assert.deepStrictEqual(bullets, ['a', 'b', 'c']);
});
ok('setState 模式返回新冻结对象', () => {
  const s1 = Object.freeze({ title: 'x', n: 1 });
  const s2 = Object.freeze({ ...s1, title: 'y' });
  assert.strictEqual(s2.title, 'y');
  assert.strictEqual(s1.title, 'x');
  assert(s1 !== s2);
});

// ---- 4. HTML 转义逻辑（与 app.js 同实现）----
console.log('\n[4] HTML 转义');
const escapeHtml = (str) =>
  String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

ok('转义尖括号防注入', () =>
  assert.strictEqual(
    escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  ));
ok('转义引号与 &', () =>
  assert.strictEqual(escapeHtml(`a&b"c'd`), 'a&amp;b&quot;c&#39;d'));
ok('null/undefined 转空串', () => {
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
});

// ---- 5. 文件齐全 + 关键引用存在 ----
console.log('\n[5] 文件与引用');
const must = ['index.html', 'styles.css', 'templates.js', 'export.js', 'app.js'];
ok('所有交付文件存在', () =>
  must.forEach((f) =>
    assert(fs.existsSync(path.join(__dirname, f)), `缺文件 ${f}`)
  ));

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok('index.html 引用了三个脚本与样式', () => {
  ['styles.css', 'templates.js', 'export.js', 'app.js'].forEach((f) =>
    assert(html.includes(f), `index.html 未引用 ${f}`)
  );
  assert(html.includes('html-to-image'), 'index.html 未引入导出库');
});
ok('index.html 含必要的挂载点 id', () => {
  ['id="card"', 'id="preview"', 'id="export-btn"', 'id="template-grid"',
   'id="size-grid"', 'id="bullet-list"'].forEach((sel) =>
    assert(html.includes(sel), `缺挂载点 ${sel}`)
  );
});

// ---- 6. 浏览器布局：预览卡片必须完整落在视口内、页面不可横向滚动 ----
// 需要 playwright(或 playwright-core)。未安装时明确提示「未执行」，
// 设 CARDSTACK_REQUIRE_BROWSER=1 则未安装也算失败。
// 可选环境变量：CARDSTACK_CHROMIUM=<chromium/headless-shell 可执行文件路径>
console.log('\n[6] 浏览器布局（预览卡片 bounding box 在视口内）');
const runBrowserChecks = async () => {
  let pw = null;
  for (const name of ['playwright', 'playwright-core']) {
    try { pw = require(name); break; } catch (e) { /* 试下一个 */ }
  }
  if (!pw) {
    if (process.env.CARDSTACK_REQUIRE_BROWSER === '1') {
      throw new Error('CARDSTACK_REQUIRE_BROWSER=1 但未安装 playwright');
    }
    console.log('  - 未执行：未安装 playwright / playwright-core（npm i playwright-core 后重跑）');
    return;
  }
  const http = require('http');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(__dirname, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(__dirname) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const launchOpts = process.env.CARDSTACK_CHROMIUM
    ? { executablePath: process.env.CARDSTACK_CHROMIUM } : {};
  const browser = await pw.chromium.launch(launchOpts);
  try {
    for (const [w, h] of [[1280, 800], [390, 844]]) {
      for (const sizeId of ['portrait', 'square']) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        await page.goto(url);
        await page.click(`#size-grid [data-size="${sizeId}"]`);
        await page.waitForTimeout(300);
        const r = await page.evaluate(() => {
          const b = document.getElementById('card').getBoundingClientRect();
          const d = document.documentElement;
          return { left: b.left, right: b.right, sw: d.scrollWidth, cw: d.clientWidth };
        });
        await page.close();
        ok(`${w}px/${sizeId}：卡片 [${Math.round(r.left)}, ${Math.round(r.right)}] 在 0..${w} 内，无横向滚动`, () => {
          assert(r.left >= 0 && r.right <= r.cw + 0.5, `卡片越界 left=${r.left} right=${r.right} 视口=${r.cw}`);
          assert(r.sw <= r.cw, `页面可横向滚动 scrollWidth=${r.sw} > ${r.cw}`);
        });
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
};

runBrowserChecks()
  .then(() => console.log(`\n全部通过：${pass} 项 ✓`))
  .catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
