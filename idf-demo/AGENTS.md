# Working in `idf-demo/`

`idf-demo` 是 **墨程CalCal**（OnePage C61 墨水屏日历）的**自有 ESP-IDF 应用**，用来替代
厂商的 PlatformIO/Arduino 固件。开始改代码之前先读 `DEVNOTES.md`（硬件事实、环境
路径、已验证结论、已知坑），`README.md` 讲怎么编译烧写和排障，`docs/ble-protocol.md`
是手机网页与设备之间的协议。

## 环境

- ESP-IDF **6.1**：`/Users/fujd/.espressif/v6.1/esp-idf`
- `idf.py` 不在默认 PATH，先 `. /Users/fujd/.espressif/tools/activate_idf_v6.1.sh`
- 目标芯片固定 `esp32c61`；换机器或删掉 `sdkconfig` 后先跑一次 `idf.py set-target esp32c61`

## 品牌与命名

- 产品展示名统一写 **`墨程CalCal`**（墨程和 CalCal 之间不要空格），简称 `CalCal`；
  不要写 `墨程 CalCal`、`OnePage 日历` 或 `蓝牙日历`。硬件平台名仍是 OnePage C61。
- BLE 广播/GAP 名保留 ASCII 别名 **`Mochen CalCal`**（部分系统对 UTF-8 设备名支持
  不稳定，小程序也按 `Mochen` 前缀扫描）；连接后的 `hello` / INFO `name` 用
  `墨程CalCal`。字符串的唯一来源是 `components/brand/include/brand.h`。
- logo 源文件是 `miniprogram/CalCal_logo.png`；固件 logo 位图和顶栏 wordmark 都由
  `tools/gen_brand_assets.py` 生成到 `components/brand/src/brand_logo.c`，不要手改
  （wordmark 从 `brand.h` 的名称 + Noto Sans CJK SC 渲染）。换 logo 或名称后重新跑
  生成脚本和 `tools/preview_calendar.py`。
- 电子墨水屏的三处品牌露出：冷启动 splash、锁屏、月/日/详情页顶栏；
  改布局时先用预览图确认 logo 不糊、名称不被挤压。
- 顶栏固定用 30 px logo + 22 px wordmark（两者墨迹高都是 21 px，与 5x7 scale 3
  电量/时钟一致，`brand_wordmark`，左侧），右侧是
  电池 → 时钟 → 蓝牙图标（蓝牙最右）的右对齐组，间距 14 px；电量/时钟保持
  5x7 scale 3（21 px ink）。不要再把 24 px CJK 文本塞回顶栏。5x7 与 CJK 的底对齐由
  `gfx_text()` 的 scale 行偏移统一处理，不要在各页面手写补偿。

## 规矩

- 不要改 `../firmware/`（厂商固件 submodule，只有参考价值，它本身有既有的脏状态）。
  板级数值要从那儿抄时，抄到这边来。
- 代码注释用英文，不写 license header，改动保持小而聚焦。
- 引用其它组件的头文件时，**必须**在 `idf_component_register` 的
  `REQUIRES`/`PRIV_REQUIRES` 里声明，否则 ESP-IDF 6.x 直接构建失败。
- 动 `sdkconfig.defaults` 要记得：已存在的 `sdkconfig` 不会自动跟进。
- 别把控制台改回 UART0（GPIO10/11 被充电使能和 USB 检测占用），也别在 SD 挂载后
  再脉冲 GPIO27 —— 这两条是硬件约束，详见 `DEVNOTES.md` 第 4 节。
- `CONFIG_PM_POWER_DOWN_PERIPHERAL_IN_LIGHT_SLEEP` 必须保持 `n`，并且
  `init_power_management()` 里的 `light_sleep_enable` 必须保持 `false`：C61 的
  SAR ADC（按键/电池）和 USB-Serial/JTAG 不在 light-sleep retention 列表里，
  实测会让按键/刷新/串口假死。
- BLE 服务/特征 UUID 同时出现在 `components/ble_calendar/include/ble_calendar.h`
  和 `web/index.html`，改一处必须同步另一处。
- `font_gb2312_24.bin` / `font_cjk_large.c` 是 `tools/gen_cjk_bitmaps.py` 生成的，
  不要手改；改 UI 文案后跑一遍脚本和 `tools/preview_calendar.py`。
- 当前是**单一日历、竖版 480x800**：不要重新引入分类选择；`ONEPAGE_UI_ROTATION`
  在 `onepage_pins.h`，方向不对时改 90/270，不要在 UI 代码里硬编码旋转。
- `bootloader_components/` 里的东西是链进 bootloader 的，不是 app；eFuse 绕过为什么
  必须在那儿，见 `DEVNOTES.md` 第 8 节。

## 改完怎么验

```bash
idf.py build                      # 至少保证能编过
idf.py -p /dev/cu.usbmodemXXXX flash monitor
```

期望的屏幕内容 / 串口输出见 `README.md` 的 "Hardware checklist"；BLE/低功耗项必须上板验证，
不能只看编译通过。
