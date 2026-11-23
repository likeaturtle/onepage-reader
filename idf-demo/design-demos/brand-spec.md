# 墨程CalCal · 品牌与设计资产

## 资产（真实文件）

| 资产 | 路径 | 说明 |
|---|---|---|
| 主标志 | `idf-demo/miniprogram/CalCal_logo.png` | 640×640 PNG，透明底，图形为深藏青 `#1E3050` 的抽象笔画；与 `web/CalCal_logo.png` 为同一份。 |
| 设备端月历/锁屏预览 | `idf-demo/tools/preview_month.png`、`preview_sleep.png`、`preview_boot.png` | 480×800 墨水屏实拍级预览，是本产品视觉语言的源头。 |
| 设备端品牌位图 | `components/brand/src/brand_logo.c` | 由 logo 生成的 1-bit 位图，说明标志在纸面上如何被「印」出来。 |
| 小程序二维码 | `idf-demo/miniprogram/miniprogram_qrcode.jpg` | 锁屏空日程时设备端展示的码。 |
| 导航与页面标题 | `app.json` / `pages/*/*.json` | 统一「墨程CalCal」。 |

标志用法：只使用原始 PNG，不重绘、不改比例；深色底上允许反白（把非透明像素统一
改为纸色），不拉伸、不加描边、不加投影。最小显示高度 32 px（手机），设备端 21 px 墨高。

## 现有界面令牌（从代码中读出的真实值）

| 令牌 | 值 | 来源 |
|---|---|---|
| 纸色 | `#F4F0E6` | `app.json` window / `app.wxss` |
| 卡片纸 | `#FFFDF8` | `app.wxss .card` |
| 正文墨 | `#26251F` | `app.wxss page` |
| 主墨蓝（品牌） | `#22345A` | 主按钮、选中日、tabBar selectedColor |
| 深墨蓝（字标） | `#1B2A44` | `.brand-name` |
| 次级灰 | `#8B8778` | `.hint` |
| 状态绿 | `#2C8A6F` | 已连接指示灯 |
| 警示朱 | `#9C3427` | 删除/错误 |
| 圆角 | 20/24/28 rpx（按钮/输入/卡片） | `app.wxss` |
| 正文字号 | 30 rpx（15 px） | `app.wxss` page |

## 设计约束

- 小程序画布 375 宽（750 rpx，1 px = 2 rpx）；正文 ≥12 px，常用 13–15 px；
  触控热区 ≥44 px；右上角胶囊 87×32、距顶 48、距右 7，周围不放可点元素。
- 字体只用系统字：苹方（PingFang SC）、宋体（Songti SC，仅用于日期/月份等数字与
  标题，不用于正文）、Menlo（配对码与协议日志）。不引入需要下载的字体。
- 不用 emoji 当图标；线性图标用内联 SVG 画，tabBar 图标在实现时输出 81×81 PNG。
- 不用 `background-image` 引本地图；图片一律 `<image>`。
- 颜色可以扩展，但必须从「纸、墨、藏青、印泥」四个来源推导，不用紫渐变、
  玻璃拟态、霓虹色。

## 品牌语气

克制、具体、像说明书而不是广告：说清楚「设备会怎样」「数据在哪里」。
不卖萌、不喊口号、不用感叹号。中文为主，拉丁只出现在产品名 CalCal、固件号、
协议版本与配对码里。
