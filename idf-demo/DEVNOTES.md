# OnePage C61 — 开发记录

`README.md` 讲怎么用这个 demo；这份讲**为什么这样写、环境是什么、哪些坑踩过了**，
以及后面基于它继续开发时从哪里接。硬件相关的结论都来自厂商 BSP
(`../firmware/open-onepage-sdk`) 和真机验证，不是推测。

最后更新：2026-10-14

------

## 1. 当前状态

**2026-10-14：真机自测通过**（面板、按键、SD 卡、电池/USB、深睡全部按预期工作）。

同一天在 ESP-IDF 6.0.1 下确认：

- `idf.py build` 从零（删掉 `build/` 和 `sdkconfig/`）可以完整编译 + 链接，
  产出 `bootloader.bin` / `partition-table.bin` / `onepage_c61_idf_demo.bin`。
- eFuse 校验绕过确实进了 bootloader 的链接（`objdump` 看到校验路径 `jal` 到包装函数）。
- `sdkconfig.defaults` 里的 flash / PSRAM / 控制台设置在生成的 `sdkconfig` 中生效。

Git：`idf-demo/` 已提交并推送 —— 提交 `eefdc60`
（`feat(idf-demo): 新增 ESP-IDF 板级 bring-up demo…`），位于 fork
`likeaturtle/onepage-reader` 的 `main`，`origin` 指向该 fork、`upstream` 指向
`MoveCall/onepage-reader`，两者在本提交前是同一个 commit。
`firmware/` 子模块工作区干净（曾被删的 `sdkconfig.onepage` 已按 `23dec9d` 里的版本恢复）。

------

## 2. 目标硬件

| 项 | 值 |
|:---|:---|
| MCU | ESP32-C61（板载型号 C61HR2，单核 RISC-V） |
| Flash | 16 MB SPI —— PY25Q128HA，DIO，80 MHz |
| PSRAM | 2 MB，**四线模式跑到 40 MHz**（这颗 C61HR2 在 80 MHz 初始化不可靠） |
| 面板 | SSD1677，800×480，4.26"，40 MHz SPI mode 0，BUSY 高有效 |
| 晶振 | 40 MHz 主晶振 + 32.768 kHz（接专用 XTAL_32K 引脚） |
| 电池 | 单节锂电，板上分压比 1:1（所以读数 ×2）；充电使能可拉低以暂停充电采样 |
| 麦克风 | PDM，CLK=GPIO7，DIN=GPIO3 |
| 存储卡 | microSD，SPI 20 MHz，与面板共用 SCLK/MOSI/MISO |
| 控制台 | 只有 USB-Serial/JTAG 可用（见第 4 节） |

------

## 3. 引脚

| 功能 | 引脚 | 备注 |
|:---|:---|:---|
| EPD SCLK / MOSI / MISO | 22 / 23 / 24 | MISO 与 microSD 共用，只驱动面板时也必须保持连接 |
| EPD CS / DC | 25 / 8 | |
| EPD RST | 27 | **同时是面板 + SD + 麦克风的电源使能**（高=通电） |
| EPD BUSY | 29 | 高电平=控制器忙 |
| microSD CS | 26 | 与面板同一 SPI2 总线 |
| 前面板 4 键 | 4 | ADC1 电阻梯：BACK ~2592 mV、LEFT ~1956 mV、RIGHT ~1316 mV、CONFIRM ~0 mV、空闲 ~3100 mV |
| 侧键 UP / DOWN | 6 / 9 | 低有效，内部上拉（= PREV / NEXT） |
| 侧键 POWER | 2 | 低有效，**同时是深睡唤醒源** |
| 电池采样 | 5 | ADC1，1:1 分压 |
| 充电使能 | 10 | 低=暂停充电；**默认 UART0 TX，别用作串口** |
| USB 检测 | 11 | LM66200 开漏，低=USB 插入；**默认 UART0 RX** |
| PDM 麦克风 | 7 / 3 | CLK / DIN |

------

## 4. 两条永久性硬件约束

这两条是硬件决定的，不是代码风格问题，改动前先想清楚：

1. **GPIO27 的电平脉冲只能做一次，而且必须在 SD 挂载之前。**
   它同时是面板复位和整条 SD/面板/麦克风电源轨的使能，所以一次低脉冲等于
   "电源循环 + 面板硬复位"。SD 挂载之后再脉冲会把正在工作的卡打挂（锁死），
   必须重新上电才能恢复。因此 `board_power_init()` 里做那唯一一次脉冲，
   而 `epd_ssd1677.c` **从不**自己复位面板。

2. **控制台必须走 USB-Serial/JTAG，不能用 UART0。**
   GPIO10/11 是充电使能和 USB 检测，而它们恰好是 C61 的默认 UART0 TX/RX。
   `sdkconfig.defaults` 里已经强制 `CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y`
   并把 UART 控制台关掉，改代码时别把它改回去。

------

## 5. 本机开发环境

| 项 | 路径 / 值 |
|:---|:---|
| ESP-IDF | **6.0.1**，`/Users/fujd/.espressif/v6.0.1/esp-idf` |
| 激活脚本 | `. /Users/fujd/.espressif/tools/activate_idf_v6.0.1.sh`（**`idf.py` 不在默认 PATH，每个新终端都要 source**） |
| Python venv | `/Users/fujd/.espressif/tools/python/v6.0.1/venv` |
| 交叉工具链 | `riscv32-esp-elf` esp-15.2.0_20251204 |
| esptool | v5.3.0（venv 里，激活后直接可用） |
| 另一份 IDF | 5.5.2 在 `~/.platformio/packages/framework-espidf`，厂商固件用的，仅作对照 |

激活脚本本身会设置 `IDF_PATH`、`IDF_PYTHON_ENV_PATH`，并定义 `idf.py` /
`esptool` / `espefuse` 等命令，同时在 zsh 下注册补全。想省掉每次 source，
可以把那行加进 `~/.zshrc`。

------

## 6. 常用命令

```bash
# 编译（set-target 只需一次，已经做过）
idf.py build

# 备份官方固件（强烈建议先做，回滚用）
esptool --chip esp32c61 -p /dev/cu.usbmodemXXXX read-flash 0 0x1000000 stock-backup.bin

# 烧写 + 清掉官方固件残留的 OTA 选择 + 看日志
idf.py -p /dev/cu.usbmodemXXXX flash
esptool --chip esp32c61 -p /dev/cu.usbmodemXXXX erase-region 0xe000 0x2000
idf.py -p /dev/cu.usbmodemXXXX monitor        # 退出：Ctrl+]

# 回滚到官方固件
esptool --chip esp32c61 -p /dev/cu.usbmodemXXXX write-flash 0 stock-backup.bin

# 只有不看板子时用的排版预览（需要 Pillow）
python3 tools/preview_screen.py
```

Flash 型号可以先查：`esptool --chip esp32c61 -p <port> flash-id`。
厂商是 `85`（Puya）时标准烧写会失败，要绕开 stub：

```bash
esptool --chip esp32c61 --no-stub -p <port> -b 115200 write-flash @build/flash_args
```

------

## 7. 分区表

沿用官方固件的偏移，所以可以原地覆盖、也能原地回滚：

| 名称 | 类型 | 偏移 | 大小 |
|:---|:---|:---|:---|
| nvs | data nvs | 0x9000 | 0x5000 |
| otadata | data ota | 0xe000 | 0x2000 |
| factory | app factory | **0x10000** | 0x640000 |
| spiffs | data spiffs | 0xc90000 | 0x360000 |
| coredump | data coredump | 0xff0000 | 0x10000 |

app 放在 `factory`/0x10000（不是 IDF 默认的 ota_0），是为了和官方固件同一位置。
**副作用**：官方固件在 app1 槽且 `otadata` 里有有效选择，`factory` 分区只在
`otadata` 无效时才会被使用，所以第一次烧写后必须
`erase-region 0xe000 0x2000`，否则还是会启动官方固件。

------

## 8. ESP-IDF 6.0 适配点（踩过的坑）

| 位置 | 问题 | 处理 |
|:---|:---|:---|
| `components/onepage_c61/CMakeLists.txt` | 6.0 会因 `esp_timer.h` 未声明依赖直接报错 | 加 `PRIV_REQUIRES esp_timer` |
| `src/board_power.c` | 6.0 删除了 `esp_deep_sleep_enable_gpio_wakeup()`，改名为 `esp_sleep_enable_gpio_wakeup_on_hp_periph_powerdown()` | 用 `ESP_IDF_VERSION` 分支，5.5.x 和 6.x 都能编 |
| `src/board_power.c` | `gpio_deep_sleep_hold_en()` 在 C61 上**不存在**（`SOC_GPIO_SUPPORT_HOLD_SINGLE_IO_IN_DSLP`，芯片自己保持 pad） | 不调用它，只对被拉低的 GPIO27 用 `gpio_hold_en()` |
| `src/sd_card.c` | 6.0 默认 `-Werror`，`snprintf` 拼目录名触发 `format-truncation` | 改成显式精度 `%.62s` |
| `components/onepage_c61/CMakeLists.txt` 里的 `PRIV_REQUIRES` | 6.0 强制检查组件依赖，用哪个组件的头就必须声明 | 新增 API 时记得同步声明，否则编不过 |

### eFuse 校验绕过（重点，容易搞错位置）

厂商固件用 `-Wl,--wrap=bootloader_common_check_efuse_blk_validity` 绕过第二级
bootloader 的 eFuse block revision 检查，否则这块硅上镜像会被判定不合格而拒绝启动。

**这个 flag 必须作用在 bootloader 的链接上**：检查发生在镜像验证阶段，那时候
app 还不存在，挂在 app 上没有意义（本项目早期版本就犯过这个错，flag 打在了 app ELF
上，实际上一点作用都没有）。现在放在 `bootloader_components/onepage_efuse_gate/`，
用 `INTERFACE "-Wl,--wrap=..."` 加 flag，再加 `-u __wrap_...` 把包装对象从静态库
里强制拉出来（不加 `-u` 时链接器不会去拿它，会报 undefined reference）。

顺带记一下**走不通的路**：`CONFIG_ESP_EFUSE_BLOCK_REV_MAX_FULL` 在 Kconfig 里
没有 prompt（注释写着 "Only Espressif can change it"），从 `sdkconfig` 改成 65535
会被 mconf 直接改回 199，所以只能走 bootloader wrapper 这条路。

以后如果给 app 加 OTA / `esp_image_verify()`，app 侧也会做同样的校验，那就需要
把同一个包装源码编译进 app 并给 app 的链接加同样的 flag。

------

## 9. 已验证 / 未验证

**已验证**

- 与真机一致的全套功能：面板显示与刷新、7 个按键、SD 挂载 + 读写校验、电池/USB 读数、深睡与唤醒。
- IDF 6.0.1 下从零构建通过；bootloader 里确实链接了 eFuse 包装。

**未验证 / 待观察**

- 深睡电流没实测（只确认了功能）。
- e-ink 刷新时序的余量（波形/温度相关），以及 `FAST` 差分刷新在低温下的表现。
- 大容量 / 高速 SD 卡的兼容性（代码里首次挂载会重试 5 次）。
- PSRAM 在 80 MHz 下的稳定性（现在固定 40 MHz）。
- 麦克风、BLE、Wi-Fi 都还没接。

------

## 10. 后续开发从哪里接

- **绘制**：`components/onepage_c61/src/gfx.c`（`gfx_*` 原语）+ `font5x7.c`（5×7 位图字体）；
  `epd_ssd1677.c` 只负责 framebuffer、窗口和三种刷新模式，不参与画什么。
  framebuffer 是 800×480 / 8bpp = 48000 字节，1 bit = 1 像素，置位=白，优先分配在 PSRAM。
- **板级功能**：都在 `components/onepage_c61/`，可以单独复用（`main/` 只是 demo）。
  新功能建议：要么加进这个组件，要么在 `components/` 下新建一个组件，
  并把 `main/main.c` 换成你真正的应用。
- **刷新模式选择**：`EPD_REFRESH_FULL`（~2 s，干净）、`EPD_REFRESH_HALF`、`EPD_REFRESH_FAST`（差分，快但有残影）。
  进深睡前调 `epd_sleep()` 把面板 park 住（图像留在屏上），唤醒后重新 init。
- **加组件依赖**：6.0 里用了谁的头就必须在 `idf_component_register` 的
  `REQUIRES`/`PRIV_REQUIRES` 里声明，否则直接构建失败（这正是最初那个报错的原因）。
- **改配置**：`sdkconfig.defaults` 只对新生成的 `sdkconfig` 生效；已经存在的
  `sdkconfig`（gitignored）不会自动更新，改完要么 `rm sdkconfig` 重新生成，要么直接在 menuconfig 里改。

------

## 11. 待补：本机实测值

下面这些是**单板相关**的值，填上以后对后续调试很有用（留空 = 还没记）：

| 项目 | 怎么读 | 实测 |
|:---|:---|:---|
| 芯片 revision | 开机的 `demo: chip: ...` 行 | |
| Flash 厂商/型号 | `esptool --chip esp32c61 -p <port> flash-id` | |
| PSRAM 实际容量 | 开机日志 / 屏幕 `FLASH .. PSRAM ..KB` | |
| eFuse block revision | `espefuse --chip esp32c61 -p <port> summary` | |
| 首屏整屏刷新耗时 | 串口时间戳（`FULL` 那次） | |
| 空闲电流 / 深睡电流 | 外部表计 | |
| SD 卡型号 + 根目录条目数 | 开机 `sd: mounted at /sdcard` 之后那几行 | |
| 满电/低电时的电池读数 | 屏幕 `BAT ...MV ...%` | |

------

## 12. 相关文件

- 厂商固件（**只读参照，不要修改**）：`../firmware/` —— PlatformIO + Arduino，
  是 git submodule，指向 `crosspoint-onepage`。面板时序、按键窗口这些值都是从
  它的板级支持包 `open-onepage-sdk` 抄过来的。
- 硬件原始资料：`../electronics/`、`../mechanical/`、`../web/`。
- 本 demo 的说明：`README.md`（含烧写、回滚、排障表）。
