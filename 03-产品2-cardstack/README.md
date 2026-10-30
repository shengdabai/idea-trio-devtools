# CardStack · 一句话生成精美知识卡片

> 输入标题 + 几个要点，一键生成风格统一、有高级感的知识卡片 / 长图，导出高清 PNG。
> 纯前端、零后端、不上传，打开 `index.html` 即用。

![type](https://img.shields.io/badge/type-pure%20frontend-111315)
![deps](https://img.shields.io/badge/deps-html--to--image%20(CDN)-36e6c0)
![privacy](https://img.shields.io/badge/privacy-local%20only-c0633a)

---

## 1. 产品定位

公众号 / 小红书 / 知识星球作者，天天要把观点做成「好看的卡片」发出去。但是：

- 不会设计，自己排出来廉价、土、不统一；
- 现成工具要么贵（订阅制设计软件），要么风格乱（模板太多反而选不出来），要么要登录、要上传、有隐私顾虑。

**CardStack 的解法**：内置 4 套精心调过的高级模板，作者只管写文字，工具负责出图。
小而锋利——只做「文字 → 精美卡片」这一件事，做到顺手到离不开。

## 2. 对应的刘小排方法论

| 刘小排原则 | CardStack 怎么落地 |
|---|---|
| **Make something people love，不是 like** | 不堆功能，把「一句话出好看卡片」这一个体验打磨到爽，让自媒体作者愿意天天用 |
| **小而锋利 > 大而全** | 只做卡片生成，不做社区、不做云存储、不做账号体系。一两天能做完、能上线 |
| **给普通人用** | 零学习成本：左边填字、右边实时看、一键导出。不需要懂设计、不需要懂工具 |
| **翻石头 / 需求倒推** | 从「作者已经在手动做卡片」这个真实高频动作倒推，需求是现成的，不是臆想的 |
| **隐私即信任** | 纯本地运行、不上传、不登录，降低使用门槛与心理负担，本身就是卖点 |

## 3. 功能清单

- ✅ **左侧编辑区**：小标签(kicker) / 标题 / 副标题 / 要点(可增删，最多 8 条) / 署名水印
- ✅ **右侧实时预览**：所有输入即时反映到卡片，所见即所得
- ✅ **4 套高级模板**：暗色科技 / 暖色编辑 / 极简留白 / 知识卡渐变，一键切换
- ✅ **2 种尺寸预设**：竖图长卡 1080×1440（3:4）、方图 1080×1080（1:1）
- ✅ **一键导出高清 PNG（2x）**：真实像素渲染，朋友圈/公众号/小红书直接发不糊
- ✅ **纯本地、不上传**：所有处理在浏览器内完成，文字不出本机
- ✅ **输入安全**：用户文字全部 HTML 转义，避免破坏排版 / XSS
- ✅ **响应式**：窄屏自动切换为上下布局

## 4. 安装 / 运行

零依赖、零构建。两种方式：

**方式 A：直接打开（最快）**
```bash
open index.html        # macOS
# 或在文件管理器里双击 index.html
```

**方式 B：本地起个静态服务器（推荐，避免个别浏览器对 file:// 的字体/CORS 限制）**
```bash
# 任选其一
python3 -m http.server 8080
npx serve .
```
然后浏览器访问 `http://localhost:8080`。

> 导出库 `html-to-image` 与全部字体（Inter / Noto Sans SC / Noto Serif SC）均**本地内置**，
> 不依赖任何 CDN：**完全离线可用、墙内可用**，导出图字体也会被内嵌进 PNG，不会回退。

## 5. 用法

1. 左侧填写标题、要点、署名（标题/副标题支持换行）；
2. 选模板主题、选尺寸；
3. 右侧实时预览满意后，点 **「导出高清 PNG（2x）」**；
4. 浏览器自动下载 `标题-时间戳.png`。

## 6. 变现思路

CardStack 本体免费引流，按刘小排「先让一群人爱上它」的节奏分层变现：

1. **免费版（获客）**：4 套模板 + 基础导出，带 `@CardStack` 默认水印 → 自带传播。
2. **Pro 一次性买断 / 订阅**：
   - 解锁 20+ 高级模板、自定义品牌色与字体；
   - 去水印；
   - 批量模式：粘贴一篇文章，自动切成系列卡片（小红书图文必备）；
   - 导出 4x / SVG / 透明背景。
3. **品牌模板包**：为 MCN、自媒体工作室定制专属模板套装，按套售卖。
4. **API / 嵌入**：给排版工具、公众号编辑器做「生成卡片」插件，按调用量计费。

核心壁垒不是技术，是**模板审美 + 持续上新的模板库**——这正是「小而锋利」可以长期打磨的护城河。

## 7. 后续路线

- [ ] 模板市场：社区投稿模板，作者可一键套用
- [ ] 批量模式：长文 → 系列卡片（自动断句 + 编号）
- [ ] 自定义品牌：上传 logo、设定主色，生成专属风格
- [ ] 本地草稿：`localStorage` 保存最近编辑，刷新不丢
- [ ] 更多尺寸：横图 16:9（PPT 配图）、微信公众号头图 900×383
- [ ] 字体扩展：可选思源宋体/黑体/手写体，强化「编辑感」
- [ ] PWA：装到桌面，完全离线可用

## 8. 文件结构

```
产品2-cardstack/
├── index.html      # 页面骨架 + 本地字体/脚本引入
├── styles.css      # App 外壳样式 + .card 卡片样式（CSS 变量换肤 + 溢出缩字 --card-fit-scale）
├── templates.js    # 4 套模板 + 2 种尺寸的纯数据定义（不可变）
├── export.js       # 克隆节点 → 内联本地字体 → html-to-image → 高清 PNG 导出
├── app.js          # 主控制器：不可变 state + 渲染 + 事件 + localStorage 持久化 + 溢出缩字
├── verify.js       # 最小自验脚本（node 跑，校验数据与逻辑）
├── vendor/         # 本地内置 html-to-image.js（无 CDN 依赖）
├── fonts/          # 本地内置字体：fonts.css + 209 个 woff2 子集（同源，离线/墙内可用）
├── README.md       # 本文件
└── SPEC.md         # 需求 / MVP 范围 / 技术决策
```

## 9. 隐私声明

CardStack 不收集任何数据，不发送任何网络请求——字体与导出库都已本地内置，**页面打开后零外联**。
你输入的所有文字与生成的图片都只存在于你的浏览器与你点击下载得到的本地文件中。

---

无任何硬编码密钥。如未来接入需要 key 的服务，请用环境变量占位（如 `YOUR_API_KEY_HERE`），切勿写入明文。

---

## 10. 开发记录

### 2026-06-05 · 评审 mustFix 修复（82 → 目标 100）

按评审意见逐条修复了 6 个必须修复项，并做了浏览器端最小自验：

- **[P0] 导出 PNG 字体内嵌失败（SecurityError）** — 根因是 `html-to-image` 去读跨域 Google Fonts 样式表的 `cssRules` 被浏览器拦截，导致导出图字体回退。
  修复：把 Inter / Noto Sans SC / Noto Serif SC 全部**本地化为同源 woff2**（`fonts/` 下 209 个子集 + 离线化的 `fonts.css`，由原 Google CSS 重写而来），并在 `export.js` 里**主动 fetch 同源字体 → 转 data:URI → 拼成 `fontEmbedCSS`** 传给 `toPng`，html-to-image 不再去读 `document.styleSheets`，彻底绕开 SecurityError。导出图字体现在被真实内嵌。
- **[P1] SecurityError 被静默吞掉** — `export.js` 不再静默：字体内联失败时 `console.warn` 并通过返回值 `{ ok, fontWarning }` 上报；`app.js` 在导出成功但字体未内嵌时 Toast 提示「字体可能回退」；若仍命中 SecurityError，给出可读、可行动的报错（提示用本地服务器打开）。
- **[P1] CDN 强依赖（墙内/离线全废）** — `html-to-image` 改为**本地内置** `vendor/html-to-image.js`，字体也本地内置。`index.html` 不再引用任何 `cdn.jsdelivr.net` / `fonts.googleapis.com`，**完全离线 / 墙内可用**。
- **[P2] 长内容溢出被裁切** — 卡片新增 `--card-fit-scale` 变量驱动所有字号/间距；`app.js` 的 `fitContent()` 在每次渲染后检测溢出并**二分逼近自动缩字**（1 → 最低 0.6），保证超长标题/要点不被裁切。
- **[P2] 无持久化，刷新即丢** — 新增 `localStorage` 持久化（key `cardstack.state.v1`）：每次状态变更落盘，启动时带白名单校验恢复，「重置示例」会清空草稿。隐私模式/禁用时静默降级。
- **[P2] 模板小样辨识度差** — `.picker__swatch` 加 `1px` 实色描边 + 内描边，纯白的「极简留白」模板小样在白底上也清晰可辨。
- **补充** — favicon 404 已修（inline 空 `data:` icon）；删除 `app.js` 中的死代码 `renderScheduled`。

**自验结果**：`node verify.js` 21 项全过；`node --check` 三个 JS 文件语法通过；Playwright 无头浏览器端到端验证（本地 `http.server`）：当前页面 **0 error / 0 warning**，`exportCardToPng` 返回 `{ ok:true, fontWarning:null }` 且 `fontEmbedCSS`（woff2 内联）成功传入、PNG 实际下载；长内容压测 fit-scale 自动降到 0.70 且不再溢出；localStorage 刷新后标题 + 8 条要点完整恢复；swatch 描边生效。

### 运行方式（推荐本地静态服务器）

```bash
cd 产品2-cardstack
python3 -m http.server 8080   # 或 npx serve .
# 浏览器打开 http://localhost:8080
```

> 直接双击 `index.html`（`file://`）在多数现代浏览器也能用，但个别浏览器对 `file://`
> 的字体/`fetch` 有限制；如导出报 SecurityError，按上面用静态服务器打开即可。
