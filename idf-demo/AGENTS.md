# Working in `idf-demo/`

`idf-demo` 是这套 OnePage C61 阅读器的**自有 ESP-IDF 应用**，用来替代厂商的
PlatformIO/Arduino 固件。开始改代码之前先读 `DEVNOTES.md`（硬件事实、环境路径、
已验证结论、已知坑），`README.md` 讲怎么编译烧写和排障。

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
- `bootloader_components/` 里的东西是链进 bootloader 的，不是 app；eFuse 绕过为什么
  必须在那儿，见 `DEVNOTES.md` 第 8 节。

## 改完怎么验

```bash
idf.py build                      # 至少保证能编过
idf.py -p /dev/cu.usbmodemXXXX flash monitor
```

期望的屏幕内容 / 串口输出见 `README.md` 的 "Verifying on hardware"。
