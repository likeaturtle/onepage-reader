# 墨程CalCal 小程序 · 样式改版方向稿

| 文件 | 内容 |
|---|---|
| `dir-1.html` → `shots/dir-1.png` | 方向一「一张纸」：原研哉式白纸、细线表格、一个实心墨条。 |
| `dir-2.html` → `shots/dir-2.png` | 方向二「日程簿」：Timepage 式日期栏，米色账本纸，回执式配对。 |
| `dir-3.html` → `shots/dir-3.png` | 方向三「节令」：月份色带 + 12 段节令色，卡片式内容。 |
| `directions.md` | 六个候选（含三个未做完整版的备选）、三版 form 五问。 |
| `spec.md` | 共同简报：受众、场景、信息层级、输出格式、约束。 |
| `brand-spec.md` | 真实资产、现有颜色令牌、字体与图标约束。 |
| `product-facts.md` | 从仓库核对的产品事实与文案边界。 |
| `polish-log.md` | 两轮打磨看到的问题、修法、认得出测试结论。 |
| `refs/` | App Store 参考板（Timepage / Things 3）、并排认得出图。**本地参考，未入库**（见同目录 `.gitignore`）。 |
| `build/` | 生成三张板的 Node 脚本（`node build/build.mjs all`）。 |

三张板都是 1440 宽，直接双击 HTML 可看；手机按 375×812 画，截图按 1:1 逐屏看过。
方向选定后才动 `miniprogram/` 的 WXML / WXSS。

备选三版也做了完整版：`dir-4.html`（A2 刻度）、`dir-5.html`（B2 纸上清单）、`dir-6.html`（C1 日卡），
对应截图 `shots/dir-4.png` … `dir-6.png`。

## 已落地

2026-11-23 选定 A1「一张纸」（见 `direction-approved.md`），已落到 `miniprogram/`：
`app.wxss` 全局纸面令牌、四个页面的 WXML/WXSS、tabBar 图标（`miniprogram/images/tab-*.png`），
以及 `utils/format.js` 的 `todayMeta` / `monthMeta` / 分组日期字段。真实 WXSS 的 375 宽浏览器预览在
`preview/mini-preview.png`；方向板仍是 `dir-1.html`。

## 横线过多的三个收敛方案（2026-11-23）

用户在实现后反馈「所有页面横线太多、感觉乱」，在现有 A1 上做了三版**只改线条规则**的对照稿，
页面内容、配色、字号、间距都不变：

- `preview/lines-a.html` → `preview/lines-a.png`：**A 只留分组线**。删掉设备、字段、kv、事件的横线，
  只保留每段标题、月头、页尾退出三条。
- `preview/lines-b.html` → `preview/lines-b.png`：**B 短淡线**。保留行节奏，但每条字段线从标签右侧起、
  颜色降到 `#EFEAE0`，设备与备注的线去掉。
- `preview/lines-c.html` → `preview/lines-c.png`：**C 竖线代横线**。表单只留一条竖线分隔标签与内容，
  日程列表只留时间列右侧的竖线；横线只保留段标题、月头、退出。

三张都是同一份实现预览的 CSS 覆盖，不是新的方向。选定后再落到 `app.wxss` / 页面 WXSS。

2026-11-23 用户选定 **B 短淡线**，已落到真实 WXSS 并重截 `preview/mini-preview.png`。
