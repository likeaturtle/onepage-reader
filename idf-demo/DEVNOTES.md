# OnePage C61 — 开发记录

`README.md` 讲怎么用这个 demo；这份讲**为什么这样写、环境是什么、哪些坑踩过了**，
以及后面基于它继续开发时从哪里接。硬件相关的结论都来自厂商 BSP
(`../firmware/open-onepage-sdk`) 和真机验证，不是推测。

最后更新：2026-11-09

------

## 1. 当前状态

**2026-10-14：真机自测通过**（面板、按键、SD 卡、电池/USB、深睡全部按预期工作）。

2026-10-14 在 ESP-IDF 6.0.1 下确认；2026-10-17 又在 ESP-IDF 6.1 下重新做了一次
从零构建，结论相同：

- `idf.py build` 从零（删掉 `build/` 和 `sdkconfig/`）可以完整编译 + 链接，
  产出 `bootloader.bin` / `partition-table.bin` / `onepage_c61_idf_demo.bin`
  （6.0.1 与 6.1 均通过）。
- eFuse 校验绕过确实进了 bootloader 的链接（`objdump` 看到校验路径 `jal` 到包装函数）。
- `sdkconfig.defaults` 里的 flash / PSRAM / 控制台设置在生成的 `sdkconfig` 中生效。

**2026-10-20：新增 PDM 麦克风音量检测（构建通过，尚未真机验证）。**
CONFIRM 点按一次开始采集、再点按一次结束；录音过程中屏幕显示 0..100% 电平条、dBFS、
峰值/平均值和最近 13 秒的柱状历史。C61 没有 PDM-to-PCM 硬件滤波器，转换、
dBFS 基准和表头刻度都在 `onepage_mic.c` / `onepage_mic.h` 里用软件实现，
首次上板时重点核对串口打印的 PDM 配置和实际听感（见第 9、10 节）。
I2S 通道**在第一次按 CONFIRM 时才初始化**，开机路径保持和之前已验证的版本一致，
这样麦克风初始化失败不会影响面板/SD 的自检。

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
| ESP-IDF | **6.1**，`/Users/fujd/.espressif/v6.1/esp-idf` |
| 激活脚本 | `. /Users/fujd/.espressif/tools/activate_idf_v6.1.sh`（**`idf.py` 不在默认 PATH，每个新终端都要 source**） |
| Python venv | `/Users/fujd/.espressif/tools/python/v6.1/venv`（Python 3.14.8） |
| 交叉工具链 | `riscv32-esp-elf` esp-15.2.0_20251204 |
| esptool | v5.6.0（venv 里，激活后直接可用） |
| 另一份 IDF | 5.5.2 在 `~/.platformio/packages/framework-espidf`，厂商固件用的，仅作对照 |

激活脚本本身会设置 `IDF_PATH`、`IDF_PYTHON_ENV_PATH`，并定义 `idf.py` /
`esptool` / `espefuse` 等命令，同时在 zsh 下注册补全。想省掉每次 source，
可以把那行加进 `~/.zshrc`。

------

## 6. 常用命令

```bash
# 编译（每台机器/每个干净 build 目录先 set-target 一次）
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

## 8. ESP-IDF 6.x 适配点（踩过的坑）

| 位置 | 问题 | 处理 |
|:---|:---|:---|
| `components/onepage_c61/CMakeLists.txt` | 6.0 会因 `esp_timer.h` 未声明依赖直接报错 | 加 `PRIV_REQUIRES esp_timer` |
| `src/board_power.c` | 6.0 删除了 `esp_deep_sleep_enable_gpio_wakeup()`，改名为 `esp_sleep_enable_gpio_wakeup_on_hp_periph_powerdown()` | 用 `ESP_IDF_VERSION` 分支，5.5.x 和 6.x 都能编 |
| `src/board_power.c` | `gpio_deep_sleep_hold_en()` 在 C61 上**不存在**（`SOC_GPIO_SUPPORT_HOLD_SINGLE_IO_IN_DSLP`，芯片自己保持 pad） | 不调用它，只对被拉低的 GPIO27 用 `gpio_hold_en()` |
| `src/sd_card.c` | 6.0 默认 `-Werror`，`snprintf` 拼目录名触发 `format-truncation` | 改成显式精度 `%.62s` |
| `components/onepage_c61/CMakeLists.txt` 里的 `PRIV_REQUIRES` | 6.0 强制检查组件依赖，用哪个组件的头就必须声明 | 新增 API 时记得同步声明，否则编不过 |
| `src/onepage_mic.c` | C61 的 I2S 只有 raw PDM RX，没有 PDM-to-PCM；`I2S_PDM_RX_SLOT_PCM_FMT_DEFAULT_CONFIG` 会返回 `ESP_ERR_NOT_SUPPORTED` | 用 `I2S_PDM_RX_SLOT_RAW_FMT_DEFAULT_CONFIG`，在软件里做 popcount / 128-bit 抽取 / 高通 |
| `components/onepage_c61/CMakeLists.txt` | 新增 I2S 后没有依赖会链接失败 | `REQUIRES` 里加 `esp_driver_i2s` |

### 6.1 的工具行为变化

6.1 没有让本项目需要改代码的破坏性变化（6.1 的外设迁移文档只涉及 UART
wakeup 和 LCD 回调，本项目都没用到）；工具侧唯一相关变化是 `idf.py flash`
的默认行为：build 目录里已有
`*_flashed.bin` 时只写变化的区域（fast reflash）。首次烧写、改了分区表，或者
需要确保整片与 build 产物一致时，用 `idf.py flash -a` 强制全量烧写。

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
- IDF 6.0.1 与 6.1 下从零构建通过；bootloader 里确实链接了 eFuse 包装。
- 麦克风功能在 IDF 6.1 下完整编译通过（raw PDM RX + 软件抽取），**尚未上板实测**。

**未验证 / 待观察**

- 深睡电流没实测（只确认了功能）。
- e-ink 刷新时序的余量（波形/温度相关），以及 `FAST` 差分刷新在低温下的表现。
- 大容量 / 高速 SD 卡的兼容性（代码里首次挂载会重试 5 次）。
- PSRAM 在 80 MHz 下的稳定性（现在固定 40 MHz）。
- **麦克风**：请求 1.024 MHz 的 PDM 时钟（实测 I2S CLK 是配置值的 2 倍，约
  2.048 MHz，对应 ~128 kword/s、16 kHz PCM）是否在 LMD4737T261 的允许范围内，
  自动定标后的底噪/量程是否适合这块板子的灵敏度，
  以及 1-3 Hz 的面板刷新是否足够“实时”。上板时先看串口打印的
  `mic: PDM mic ready: ...`、`mic: noise floor ... -> meter ...` 和每秒的
  `mic: ... level ... dBFS`。2026-10-20 的第一次真机日志显示，配置 2.048 MHz
  时 word rate 为 255,968 Hz（即实际 CLK 约 4.096 MHz），所以把配置值减半到
  1.024 MHz；同一次反馈还显示静音时旧刻度为 74%，因此加了自动底噪定标。
- BLE、Wi-Fi 都还没接。

------

## 10. 后续开发从哪里接

- **绘制**：`components/onepage_c61/src/gfx.c`（`gfx_*` 原语）+ `font5x7.c`（5×7 ASCII 位图字体）
  + `font_cjk.c`（中文方块点阵，`gfx_text_cjk()`，自带极简 UTF-8 解码）；
  `epd_ssd1677.c` 只负责 framebuffer、窗口和三种刷新模式，不参与画什么。
  framebuffer 是 800×480 / 8bpp = 48000 字节，1 bit = 1 像素，置位=白，优先分配在 PSRAM。
- **加中文字**：`font_cjk.c` 是生成的，别手改。改字形或字号：
  `python3 tools/gen_cjk_bitmaps.py --chars 休眠中门目录 [--size 48]`（需要 Pillow 和系统中文字体，
  脚本会同时输出 `tools/preview_cjk.png` 供眼睛检查）。当前字集只有「休眠中」三个字。
- **板级功能**：都在 `components/onepage_c61/`，可以单独复用（`main/` 只是 demo）。
  新功能建议：要么加进这个组件，要么在 `components/` 下新建一个组件，
  并把 `main/main.c` 换成你真正的应用。
- **麦克风**：`components/onepage_c61/src/onepage_mic.c` + `include/onepage_mic.h`。
  引脚 GPIO7（CLK）/ GPIO3（DIN），电源和 SD/面板共用 GPIO27。C61 的 I2S 只有
  raw PDM RX，没有 PDM-to-PCM，所以：
  - `I2S_PDM_RX_CLK_DEFAULT_CONFIG(1024000)` + `I2S_PDM_RX_SLOT_RAW_FMT_DEFAULT_CONFIG`；
  - 每个 16-bit word 是 16 个 PDM bit，用 `__builtin_popcount` 变密度计数；
  - 8 个 word（128 bit）抽成一个 16 kHz PCM 样本，减 50% 直流后过 50 Hz 一阶高通；
  - 100 ms 一帧算 RMS/峰值，200 ms 一条历史，UI 每 250 ms + 一次面板刷新更新一次。
  - 采集跑在独立任务（优先级 6，高于 app_main），这样面板刷新阻塞主循环时 I2S DMA
    仍有人排空；静止时通道 disable，PDM 时钟停住。
  - **必须主动让出 CPU**（2026-10-20 真机踩坑）：PDM 数据可能比任务消费得快，
    `i2s_channel_read()` 会连续立即返回；优先级 6 的任务一直 ready 会饿死 IDLE，
    15 s 后触发 task watchdog（日志里 `CPU 0: onepage_mic`、IDLE 未喂狗）。每个循环
    末尾必须 `vTaskDelay(1)`（100 Hz tick 下就是 10 ms）；**不要用
    `pdMS_TO_TICKS(1)`**，100 Hz 下它等于 0，等于没让。电平表只取一部分数据即可，
    丢数据不影响显示。
  - **点击切换 + 独立按键扫描**：第一次点击（按下再抬起）开始，第二次点击结束。
    CONFIRM 在 ADC 电阻梯上，面板刷新时 UI 任务可能几百毫秒不采样，所以 `main.c`
    有一个 20 ms 的 `key_scan_task` 专门采样 CONFIRM 点击，通过二值信号量交给 UI 任务，
    避免点击整个落在刷新窗口里被丢掉；`onepage_adc.c` 的 ADC 读加了互斥锁，
    两个任务同时读电阻梯不会因 `adc_oneshot_read` 的 try-lock 而丢样本。
  - **延迟初始化**：`main.c` 不在 `app_main` 里调用 `onepage_mic_init()`，而是在第一次
    按 CONFIRM 时才初始化（`start_recording()`）。这样开机流程（电源轨、面板、SD）与
    加入麦克风之前完全一致；初始化失败只影响麦克风，屏幕会显示 `MIC UNAVAILABLE`。
  - 表头**每次录音自动定标**：前 1 帧丢弃（高通稳定），接着 4 帧（约 400 ms）取**最高**
    帧当环境底噪（保守估计，避免单次 DMA 丢数据把底噪拉低），0% 放在底噪 +
    `ONEPAGE_MIC_NOISE_MARGIN_DB`(3 dB) 处，100% 再往上
    `ONEPAGE_MIC_METER_RANGE_DB`(30 dB)，上限 0 dBFS、下限不低于回退顶 -20 dBFS。
    这样安静房间接近 0%，而不是把
    -33 dBFS 底噪显示成 74%。定标期间屏幕提示 `CALIBRATING NOISE FLOOR - STAY QUIET`。
    未定标或录音短于定标时间时，回退到 `ONEPAGE_MIC_METER_FLOOR_DB` / `_TOP_DB`
    （-70 / -20 dBFS）。LEVEL/PEAK/AVG 的 dBFS 仍是绝对值。
  - 2026-10-20 真机反馈：静音时显示 74%，说明环境底噪约 -33 dBFS（按旧的固定
    -70..-20 映射），所以改成上面的自动定标。
  - **音频不落盘**：当前只做实时电平检测，没有 WAV。要加录音，可在这个任务里把
    PCM 样本写进环形缓冲，再由单独的写卡任务落成 WAV，避免 SD 写阻塞 DMA。
- **刷新模式选择**：`EPD_REFRESH_FULL`（~2 s，干净）、`EPD_REFRESH_HALF`（写双 RAM、高温快波形，
  画面同样干净但闪得少）、`EPD_REFRESH_FAST`（差分，快但有残影）。
  进深睡前调 `epd_sleep()` 把面板 park 住（图像留在屏上），唤醒后重新 init。
  2026-11-10 真机反馈「休眠/唤醒时屏幕黑白闪好几次」：原因是这两处都走 FULL，每次要黑白反转
  三四下；现在和厂商固件一致，**冷启动用 FULL，唤醒首帧和锁屏用 HALF**（厂商 `displayBuffer()`
  对「panel was off」也是强制 HALF）。要更干净可以把这两处改回 `EPD_REFRESH_FULL`。
- **唤醒耗时拆分（2026-11-10 实测，`I (ms)` 是复位后时间）**：
  `2072` 才走到 `esp_psram`，说明复位后前约 2 s 花在 ROM/bootloader 和 **PSRAM 全片自检**上；
  `2264` 进 `app_main`；`2531` 电源轨起来（GPIO27 那 20+120+120 ms 脉冲）；`2564` 开始画第一帧；
  `4169` HALF 刷新结束。也就是说：**PSRAM 自检 ~1.5 s、电源脉冲 260 ms、面板 HALF 本身 ~1.6 s**。
  `CONFIG_SPIRAM_MEMTEST=n` 已经关掉自检（深睡唤醒=复位，每次都要付这 1.5 s；换新板验证 PSRAM
  时可以临时打开）。面板那 1.6 s 是 SSD1677 的波形时间，只能靠换 FAST/自定义 LUT 再压。
  另外 BLE 控制器 bring-up 实测只有 ~45 ms，所以它排在第一帧前还是后对唤醒影响很小。
- **重绘策略（踩过的坑）**：早期版本每 2 秒必然重绘一次 —— 电池是**单次 ADC 采样**（抖动远超 1 mV），
  而主循环用 `previous_mv != bat_mv` 精确比较，于是"活值更新"变成了"每两秒闪一次"，残影也跟着累积。
  现在：`ONEPAGE_BATTERY_SAMPLES=8` 平均 + 变化 ≥ `BAT_REDRAW_MV`(25 mV) 才算变 + 慢变量最多每
  `SLOW_REDRAW_US`(30 s) 重绘一次；按键重绘仍是 120 ms 节流。**新增任何"活值"显示时，请照这个约定来**
  （带阈值 + 限频），否则面板会一直闪。
- **版式系统（2026-11-10 统一）**：480x800 画布统一 30px 左右边距（内容宽 420px），
  正文只有 24px 一档（ASCII 5x7 scale 3 + CJK 24px 位图），只有锁屏标题 48px、
  时钟 32px 例外；垂直节奏用 24/8/12/16，表头分隔线 52、页脚分隔线 736、页脚基线
  752，内容最高到 720。月历网格固定 420px 高（5x84 / 6x70，7x60 正好填满 420
  内容宽），所以换月、换选中日时下方日程卡不会跳动。改版式先动
  `calendar_ui.c` 顶部的常量，再同步 `tools/preview_calendar.py`。
- **周末底纹**：周六/周日两列用 `gfx_dither_rect(..., 1)`（1/16 Bayer 点阵）铺浅灰底；
  底纹先画，网格线、选中黑格、日期数字和事件圆点都画在它上面，所以圆点仍是
  实心黑（选中格上是实心白），不会被底纹打花。
- **月历日程卡**：选中日期的事件不再压在网格上，而是固定在网格正下方
  （`PEEK_CARD_Y = 140 + 420 + 12 = 572`）的一张白底双边框卡片：日期/星期 +
  当天总条数 + 最多 3 条（开始时间 + 标题），高度 `58 + 30*n`；没有日程时
  高度 88，显示「这天没有日程」。网格固定 420px 高（5 行 84 / 6 行 70），
  卡片不会随选中格移动，也不会挡住任何日期。总条数取 `s_month_counts`，
  事件拷前 5 条到 `s_peek_events`，卡片只列前 3 条；确认键仍进当天列表。
- **底部按键提示**：缩成一行，按前面板物理布局排——左 `返回:…`、中间 `左右:…`、
  右 `确认:…`（`draw_footer(back, left_right, confirm)`），不再显示上下/PWR 提示；
  详情页的按钮条也改成左边返回、右边黑色确认按钮，和这条规则一致。
- **休眠交互**：`POWER` 单击或长按 2 s 都进深睡（长按到 2 s 立即开始锁屏，但会等按键松开再
  真正 `esp_deep_sleep_start()`：POWER 是低电平唤醒源，攥着不放会让设备刚睡下就被自己叫醒）。
  按下时长 < `POWER_CLICK_MIN_US`(30 ms) 视为毛刺忽略。进深睡前先 `onepage_mic_stop()` 停掉 PDM 采集，
  再用 `EPD_REFRESH_HALF` 画好「休眠中」画面、`epd_sleep()`，这样静止图像能挂几个小时不掉字、不留残影。
- **加组件依赖**：6.x 里用了谁的头就必须在 `idf_component_register` 的
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
| PDM 配置 / PCM rate | 第一次录音的 `mic: PDM mic ready: ...` 行 | |
| 正常说话时的 level / peak | 录音时每秒的 `mic: ... level ... dBFS` | |

------

## 12. 相关文件

- 厂商固件（**只读参照，不要修改**）：`../firmware/` —— PlatformIO + Arduino，
  是 git submodule，指向 `crosspoint-onepage`。面板时序、按键窗口这些值都是从
  它的板级支持包 `open-onepage-sdk` 抄过来的。
- 硬件原始资料：`../electronics/`、`../mechanical/`、`../web/`。
- 本 demo 的说明：`README.md`（含烧写、回滚、排障表）。

------

## 13. 2026-11-09：BLE 日历应用

`main/` 从 bring-up 自测换成了日历应用；板级组件 `onepage_c61` 保持不变（面板、
按键、电源、ADC、SD、麦克风都还在，只是新应用不用 SD/麦克风）。原来的自测说明
移到了 `docs/bringup-demo.md`，里面有面板时序、按键窗口、GPIO27/SD 约束和 eFuse
包装的历史记录，仍然有效。

### 13.1 结构

| 位置 | 职责 |
|:---|:---|
| `main/main.c` | 状态机、按键任务、自动锁屏/深睡、BLE 回调、时间/电池 |
| `main/calendar_ui.c` | 月历、当天列表、详情、删除确认、锁屏画面的纯绘制 |
| `components/calendar/` | 数据模型、NVS 持久化、公历日期工具、时区/时钟 |
| `components/ble_calendar/` | NimBLE GATT 服务、JSON 协议、分块收发 |
| `components/cjson/` | 厂商 cJSON 1.7.19（MIT，仅 vendored cJSON.c/h） |
| `components/onepage_c61/font_gb2312_24.bin` | 7445 个 GB2312 字形的 24px 位图（566KB，闪烁内嵌） |

### 13.2 为什么是 NVS，而不是 SD / SPIFFS

- SD 卡要挂载、会耗电，而且 GPIO27 与面板共用电源；不挂 SD 就不会触发“挂载后
  再脉冲 GPIO27 把卡锁死”的坑。日历在无卡时也必须能用。
- `spiffs` 分区是官方固件放字体/书的地方，格式化或覆盖有丢用户数据的风险。
- NVS 分区 20KB，日历按单条 blob 存：`namespace=calstore`，key `db`，另有
  `epoch`/`tz`。96 条事件、标题 47B、备注 95B 的最坏情况约 15KB。NVS 满时
  `save_db_locked()` 从最旧的**过去**事件开始删，`add` 的 ack 里带 `pruned`；
  如果全是未来事件就返回 `calendar full`，不做静默丢弃。
- blob 头 16B（magic/version/计数/next_id/CRC32），payload 是变长记录；读取时
  先校验 CRC32，损坏/版本不符就退回默认日历。NVS 自己的 entry CRC 不够跨 entry。
- 每条变更重写整个 blob。日历写入频率很低，NVS 的磨损均衡足够；不要把它改成
  每次按键都写。

### 13.3 时钟

- 事件存的是**本地公历日 + 当天分钟数**，没有 UTC 转换，所以换时区不会把已有
  日程挪走。
- 手机每次连接都会发 `time`（epoch + 分钟偏移）。NVS 里也存 `epoch`/`tz`；
  冷启动时如果 RTC 时间无效就恢复上次的时钟（`time_synced=false`，屏幕上仍会
  显示时间，但手机连上后会纠正）。
- IDF 默认 `LIBC_TIME_SYSCALL_USE_RTC_HRT`，深睡期间 RTC 走 32.768kHz 晶振，
  `time()` 会继续；这是不外加 RTC 电池也能保持日期的前提。
- 屏幕上的时钟**不按分钟重绘**：e-ink 每次刷新都耗电并留残影，锁屏前的 3 分钟
  内时间最多差几分钟，可接受。任何按键/BLE 变更都会重绘。

### 13.4 BLE

- 服务/特征 UUID 和 canonical 字符串见 `components/ble_calendar/include/ble_calendar.h`
  与 `docs/ble-protocol.md`。`BLE_UUID128_INIT` 收的是**小端**字节序，写反了
  手机会扫不到服务。
- 广播包放 128-bit service UUID，扫描响应放名字 `Mochen CalCal`；广播间隔
  300–350ms，连接间隔 30–50ms（手机提交表单的体验优先）。
- 手机写入按 20 字节分块，设备按换行重组（2KB RX buffer）；设备通知按
  `min(MTU-3, 180)` 分块，网页按换行重组。协议是“行 JSON”，没有 request id，
  客户端必须串行发命令。
- 连接订阅后设备主动发 `hello`；网页也发一次 `hello` 作为兜底。
- `sleep` 命令先 ack，再回调主任务锁屏；主任务先 `ble_calendar_shutdown()`
  （terminate + adv stop + `nimble_port_stop` + `nimble_port_deinit`），再画锁屏，
  避免锁屏的 2 秒里还有 BLE 中断/通知。
- 没有配对/加密：附近任何 central 都能读写。个人桌面设备可以接受；如果要做
  可信设备，应该加应用层 PIN 或 LE Secure Connections + 绑定，别只靠“UUID 不公开”。

### 13.5 低功耗配置（重要）

`sdkconfig.defaults` 里新增：

```
CONFIG_RTC_CLK_SRC_EXT_CRYS=y
CONFIG_BT_LE_SLEEP_ENABLE=y
CONFIG_BT_LE_LP_CLK_SRC_DEFAULT=y
CONFIG_PM_ENABLE=y
CONFIG_FREERTOS_USE_TICKLESS_IDLE=y
CONFIG_FREERTOS_HZ=1000
CONFIG_PM_POWER_DOWN_CPU_IN_LIGHT_SLEEP=y
CONFIG_PM_POWER_DOWN_PERIPHERAL_IN_LIGHT_SLEEP=n
CONFIG_ESP_MODEM_CLOCK_ENABLE_CHECKING=y
CONFIG_ESP_SLEEP_CACHE_SAFE_ASSERTION=y
```

- **为什么 peripheral power-down 必须关掉，且 light sleep 目前也关闭**：C61 的
  SAR ADC（前面板电阻梯、电池分压）和 USB-Serial/JTAG 不在 light-sleep retention
  列表里。2026-11-09 真机实测：`light_sleep_enable=true` 时空闲一段时间后按键无
  响应、网页 add 有 ack 但屏幕不刷新、USB 串口消失；关掉后按键/网页/重绘全部恢复。
  详见 13.9。
- PSRAM 用默认的 half-sleep（`PM_SLP_SPIRAM_HALFSLEEP_ENABLED`），事件数组和
  blob 在 PSRAM 里；当前 light sleep 关闭，PSRAM 一直保持供电。
- `esp_pm_configure()` 在 `app_main` 里显式调用，`max=CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ`
  （160），`min=40`，**`light_sleep_enable=false`**。自动 light sleep 在本板上实测会
  让前面板 ADC 按键、USB-Serial/JTAG 和屏幕刷新在空闲后一起“假死”（见 13.9），
  所以只保留 DFS；低功耗主要靠 3 分钟后的深睡。
- 空闲锁屏：未连接 3 分钟、已连接 10 分钟、POWER 单击/2 秒长按、网页 `sleep`
  命令都会进深睡。插着 USB 时跳过自动锁屏（用外部供电，也方便串口调试和桌面常显），
  POWER/网页仍可主动锁。深睡前 `epd_sleep()` 把面板 park，`board_power_enter_deep_sleep()`
  拉低 GPIO27 并 hold，屏幕图像留在屏上。
- **顶部状态栏**：左侧蓝牙图标 + 电量百分比，右侧时钟；不再显示“日历”标题和
  “已连接/可连接/蓝牙失败”文字。蓝牙图标三态：广告中=细线轮廓、已连接=黑底（3 px 圆角）白线反白、
  射频失败=50% 棋盘抖动假装浅灰（1-bit 面板没有真灰度），并在图标左侧加一个
  同样抖动的感叹号（此时图标和电量整体右移 8 px，和感叹号只隔 4 px）；图标用新增的
  `gfx_line()` 画（Bresenham + 方形笔刷）。
- 醒着时只做表头走时，不做整屏周期重绘：每分钟一次 FAST 差分（只动时钟数字，
  不计入 HALF 计数）；电池每 60 秒采样一次，只有变化 ≥5% 才重绘；按键重绘
  120ms 节流；每 30 次内容刷新插一次 HALF 清残影。
- **电池分压是 5.1 M + 5.1 M 的高阻节点，GPIO5 又是 LP/RTC 引脚**：ADC 配置后
  显式 `rtc_gpio_set_direction(DISABLED)` + `rtc_gpio_pullup_dis()` /
  `rtc_gpio_pulldown_dis()`（5.5 的 `gpio_config_as_analog()` 本来就这样做，
  6.1 只调 `rtc_gpio_deinit()`，后者在 LP IO 不忙时不清 RTC 上/下拉）。
- **上电后的第一次电池采样不可信（实测踩坑）**：充电/上电瞬态会让第一次读数
  偏高（约 5.1 V，×2 后 0%），而 60 秒后的周期采样回到 4.16 V/100%。现在
  `refresh_battery()` 在读数超出 1S 范围时按 2/4/8/16/32 秒重试，表头在拿到
  合理值前显示 `--%`，不会先假装 0%；重试到合理值后自动重绘。第一次上电不要
  用 0% 判断电池好坏。

### 13.6 字体

- `tools/gen_cjk_bitmaps.py` 现在生成两个东西：
  - `components/onepage_c61/font_gb2312_24.bin`：GB2312 全表（含 A1–A9 符号区，
    7445 字形），24px，二进制格式 `OPF1` + 16B header + 76B/字形，Unicode
    排序，二分查找。用 `EMBED_FILES` 链进 app。字形来自 Noto Sans CJK SC
    （OFL 1.1，见 `tools/fonts/OFL.txt`），不是系统字体。
  - `components/onepage_c61/src/font_cjk_large.c/.h`：48px 的「休眠中」子集。
- 字体不是 C 数组而是二进制，原因是 7445 字形的 C 源约 3MB，编译慢且 review
  噪音大；生成脚本和预览图都在仓库里，改字集时重新跑脚本即可。
- **汉字底部被裁的坑（2026-11-10 修复）**：生成脚本原来用 Pillow 的
  `anchor="mm"`（按行框居中），24px 汉字的下沿会落到第 24 行之外，点阵只保留
  0..23 行，于是底部 1~2 行直接丢失（7445 个字形里 7115 个最后一行有墨，几乎
  所有汉字都贴着格子底边）。现在改成 `anchor="ms"` + 按全角汉字的 ink 范围
  计算基线，汉字底部完整，24px 格子里留 0~2px 余量；48px 的「休眠中」同样
  处理。**这不是行高问题**：`gfx_text_utf8` 不做纵向裁剪，行距也一直大于
  24px。重新生成用 `tools/gen_cjk_bitmaps.py --font <Noto TTC> --font-index 2`。
- 混合排版在 `gfx.c`：ASCII 用 5x7 scale 3（18px 宽），CJK 用 24px，字距 1px；
  `gfx_text_utf8_*` 负责裁剪/省略号/自动换行。缺字画空心框，不会静默消失。
- `tools/check_font_coverage.py` 会扫所有 C 源文件的非 ASCII 字符，确认都在
  GB2312 表里，并检查 header/网页的 UUID 是否同步；当前 0 缺失。改 UI 文案后
  先跑它。

### 13.7 构建状态

2026-11-09 用 IDF 6.1 从干净 `sdkconfig` 构建通过：

```
onepage_c61_idf_demo.bin binary size 0x1419f0 bytes
smallest app partition 0x640000 bytes, 80% free
DIRAM 138041 / 256624 bytes (54%), 118583 free
```

注意：`sdkconfig.defaults` 只对**新生成**的 `sdkconfig` 生效。加/改低功耗或 BLE
选项后，要么 `rm sdkconfig` 重新生成，要么 menuconfig 里手动改。

### 13.8 验证状态 / 风险

- 2026-11-09 上板验证过：擦除/烧写、面板初始化、前后左右/确认/返回按键、
  手机网页 BLE 连接、`add` 后自动重绘、差分刷新约 460–480 ms。验证中定位到
  light sleep 会导致按键/刷新/串口假死，已关闭（13.9）。
- **仍未验证**：深睡电流、锁屏画面在真实面板上的保持时间、NVS 满时的 prune、
  真实手机的分块极限（大标题/长列表）、USB 拔掉后纯电池的 3 分钟自动锁屏。
- 如果以后重新启用 light sleep，按 13.9 的检查项先验证前面板 ADC、USB 串口和
  网页 add 后重绘；不要只看 BLE 还能广播。
- `CONFIG_ESP_SLEEP_CACHE_SAFE_ASSERTION=y` 是调试期保护；如果它在某些 light
  sleep 路径上触发 panic，需要定位是哪个驱动在睡眠中访问 cache，而不是直接关掉。
- 96 条事件和 20KB NVS 的关系是估算；真实 NVS 还有 PHY calibration 等数据。
  如果 `add` 频繁返回 `calendar full`，优先减小 `CAL_MAX_EVENTS` 或改存 SD。
- Web Bluetooth 在 iOS Safari 不可用；Android 上必须 HTTPS/localhost。
- 本应用不碰 SD 卡；如果以后要加“导出到 SD”，注意 DEVNOTES 第 4 节的 GPIO27
  时序约束仍然成立。

### 13.9 2026-11-09：light sleep 导致按键/刷新/串口假死（已定位）

现象：

- 空闲几分钟后按前后左右/确认/返回，屏幕没有变化；
- 手机网页能连上并收到 `add` 的 ack，但设备屏幕不重绘；
- `/dev/cu.usbmodem*` 有时直接消失。

诊断固件把 `esp_pm_configure(..., .light_sleep_enable=false)`，同时给按键边沿、
BLE 回调、`draw_current` 和 BLE `add/list` 加日志。真机日志：

```
calendar-app: key CONFIRM down
calendar-app: handle CONFIRM view=0
calendar-app: draw view=1 mode=0
calendar-app: draw done in 476 ms
ble_cal: add id=4 cal=4 day=20766 start=1140 end=1200
calendar-app: BLE data changed
calendar-app: draw done in 463 ms
```

结论：问题不在按键硬件、面板 BUSY 或 NVS，而是自动 light sleep。C61 的
SARADC/USB-Serial-JTAG 不做 light-sleep 上下文保持；本板的按键扫描和 USB 控制台
都依赖它们。最终固件在 `init_power_management()` 里把 `light_sleep_enable` 固定为
`false`，保留 DFS、BLE 广播/连接和深睡。深睡前仍然 `epd_sleep()` +
`board_power_enter_deep_sleep()`，长期功耗主要由深睡决定。

以后如果要重新启用 light sleep，先做三件事：前面板 ADC 连续扫描、USB 串口在线、
网页 add 后重绘；三者都通过再考虑，不要只看 BLE 还能广播。

------

## 14. 2026-11-09：单一日历 + 竖版 UI

按使用反馈做了两处结构性调整：

### 14.1 只保留一个日历

- `calendar.c` 的默认日历从 5 个（个人/工作/家庭/学习/提醒）改成 1 个「日历」。
- `calendar_init()` 新增 `normalize_single_calendar()`：老数据库里如果还有多个日历，
  把所有事件的 `cal` 强制改成 0，日历数改成 1，名称改成「日历」，然后保存回 NVS。
  这样升级固件不会丢已有日程，只是分类被合并。
- BLE 的 `add`/`list` 忽略 `cal` 字段；`addcal`/`delcal`/`rencal` 已从协议中移除。
  `hello` 仍带一个 `cals:["日历"]` 以兼容旧客户端，但网页不再显示分类。
- UI 顶部不再有分类 chips；月历的 UP/DOWN 改成“上一周/下一周”，不再切换日历。
- 网页删除了“目标日历”下拉框和“日历分类”卡片，添加日程只发日期/时间/标题/备注。

### 14.2 竖版 480x800

面板原生显存仍是 800x480。为了不改 SSD1677 初始化/窗口时序，UI 在 **480x800
逻辑坐标系**里绘制，`gfx.c` 的 `set_pixel()` 负责把它旋转进 800x480 framebuffer：

- `ONEPAGE_UI_WIDTH=480`、`ONEPAGE_UI_HEIGHT=800`、`ONEPAGE_UI_ROTATION=270`，
  定义在 `onepage_pins.h`。
- 270 表示“设备顺时针转 90° 后看正”，映射为 `px=y, py=479-x`。
  如果实际图像上下颠倒/方向不对，把 `ONEPAGE_UI_ROTATION` 改成 90 再编译烧写。
- `gfx_clear()` 仍然清整个 800x480 物理 buffer；所有图元通过 `set_pixel()` 变换，
  所以 `epd_refresh()`、三种刷新模式和睡眠画面都不用改。
- 竖版布局：30px 边距、420px 内容宽；月历 7 列 x 5/6 行、固定 420px 高
  （单元格 60x84 或 60x70）；当天列表最多显示 8 行；详情页备注最多 8 行；
  锁屏显示 5 条。不再有分类栏，纵向空间更充足。
- `tools/preview_calendar.py` 改为 480x800，预览图可直接检查竖版排版。

### 14.3 验证

- 构建通过：`0x1419f0`，app 分区 80% 空闲。
- 2026-11-09 真机确认：竖版方向正确（270 映射）、旧 5 条日程合并为 1 个日历、
  按键导航和网页添加后自动刷新均正常。
- 若换一台面板装配方向相反的机器，只需把 `ONEPAGE_UI_ROTATION` 改成 90。
- 原有的 light sleep 修复（13.9）继续有效：`light_sleep_enable=false`。
