# Working in `idf-demo/`

`idf-demo` 是这套 OnePage C61 阅读器的**自有 ESP-IDF 应用**（BLE 日历），用来替代
厂商的 PlatformIO/Arduino 固件。开始改代码之前先读 `DEVNOTES.md`（硬件事实、环境
路径、已验证结论、已知坑），`README.md` 讲怎么编译烧写和排障，`docs/ble-protocol.md`
是手机网页与设备之间的协议。

## 环境

- ESP-IDF **6.1**：`/Users/fujd/.espressif/v6.1/esp-idf`
- `idf.py` 不在默认 PATH，先 `. /Users/fujd/.espressif/tools/activate_idf_v6.1.sh`
- 目标芯片固定 `esp32c61`；换机器或删掉 `sdkconfig` 后先跑一次 `idf.py set-target esp32c61`

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
