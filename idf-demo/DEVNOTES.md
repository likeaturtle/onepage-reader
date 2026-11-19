# 墨程CalCal（OnePage C61）— 开发记录

`README.md` 讲怎么用这个 demo；这份讲**为什么这样写、环境是什么、哪些坑踩过了**，
以及后面基于它继续开发时从哪里接。硬件相关的结论都来自厂商 BSP
(`../firmware/open-onepage-sdk`) 和真机验证，不是推测。

最后更新：2026-11-19

------

## 1. 当前状态

> 2026-11-17：固件版本收敛到工程根目录的 `version.txt`（当前 `1.0.0`），**只有这一处**。
> ESP-IDF 的 `PROJECT_VER` 优先读它，不再退化成 `git describe --always --tags --dirty`
> 的短 hash（仓库没有 tag，之前镜像里的版本是 `475b844-dirty`）；固件里也不再保留第二份
> 拷贝——`hello`/INFO 的 `fw` 由 `ble_calendar.c` 的 `fw_version()` 从
> `esp_app_get_description()->version` 读出（该组件 PRIV_REQUIRES 加了 `esp_app_format`），
> `BRAND_FW_VERSION` 宏已删。于是镜像 metadata、BLE 字段、网页/小程序的“固件”显示同源，
> 发版只改 `version.txt` 一行。改它会自动触发重配（只有第一次新建文件时需要手动
> `idf.py reconfigure`）。注意 `PROTO_VERSION`（`ble_calendar.c`）是**协议**版本，
> 与固件版本无关，两者不要合并。小程序则相反：客户端版本**不进仓库**——微信只在正式版
> 返回线上版本号，所以“我的”页改为运行时读 `wx.getAccountInfoSync()`
> （开发/体验版显示环境名），发布号以上传时填的为准；顺手把 wxml 里写死的
> `proto 1` 改成绑定 `config.protocol`。

> 2026-11-16：产品定名 **墨程CalCal**，CMake 工程/产物改为 `mocheng_calcal`，
> 并新增了品牌 splash/锁屏/顶栏；细节见第 15 节。下面历史记录里出现的
> `onepage_c61_idf_demo.bin` 是改名前的产物名。

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
  POWER/网页仍可主动锁。深睡前 `epd_sleep()` 把面板 park，`board_power_enter_deep_sleep(wake_s)`
  拉低 GPIO27 并 hold，屏幕图像留在屏上。
- **锁屏列表按“内容变化时刻”唤醒，不是定时 30 分钟**（2026-11-17）：锁屏上唯一会
  随时间变旧的东西是“某条日程已经结束、不该再列出来”和“跨天”，两者在睡前都算得准。
  `lock_change_delay_s()` 取「今天那几行里最早的 `end_min + 1` 分钟」和「下一个零点」
  中的较小值，交给 `board_power_enter_deep_sleep(wake_s)` 用
  `esp_sleep_enable_timer_wakeup()` 与 POWER 键一起武装（0 = 只留 POWER）。普通一天
  3～8 次唤醒，每次 2～4 秒（复位 + GPIO27 脉冲 + HALF 刷新），约 0.05 mAh。
- **日程的开始时刻刻意不唤醒**（2026-11-17 用户确认保持现状）：那一行本来就印着开始
  时间，从“未来”变成“已开始”在玻璃上没有任何变化，醒来只会白闪一次。所以一条
  19:00–19:30 的日程是在 **19:31:03** 唤醒（`end_min + 1` 分钟 + 3 秒余量），19:00
  不会醒；当天没有日程就等零点。别拿“开始时刻该闪一下”当验收标准——要确认机制，
  看串口：锁屏时应有 `entering deep sleep; press POWER to wake (schedule timer armed)`，
  醒来应有 `wake from the schedule timer: refreshing the parked list`，且启动行的
  `wake causes` 位图含 `0x10`（`BIT(ESP_SLEEP_WAKEUP_TIMER)`）。
- **定时唤醒必须走短路径**：`app_main()` 里 `wake_causes & (1u << ESP_SLEEP_WAKEUP_TIMER)`
  时先调 `repark_after_timer_wake()` ——不画 splash、不起按键任务、不启动 BLE，
  重算列表 → 重画锁屏 → 回睡。**别让它落进下面的正常启动流程**：那里要闲置 3 分钟
  才自动锁屏，48 次/天就是 ~1.5 mAh/次、1000 mAh 电池两周见底。
- **代价：锁屏那个 HH:MM 时钟只在这些唤醒时刻前进**（2026-11-17 与用户确认：优先
  列表准确，接受时钟陈旧，不做每 30 分钟/整点的时钟刷新）。RTC 走 32.768 kHz 晶振
  （±20 ppm，长时间 park 会漂 1～2 秒），所以边界后留 `LOCK_WAKE_MARGIN_S`(3) 秒；
  `LOCK_WAKE_MIN_S`(60) 是下限，防止算到已经过去的边界后“醒来即睡、睡下即醒”。
- 深睡时 BLE 控制器整块关闭，所以定时唤醒**只能刷新本地已有数据，拿不到手机上的
  新日程**；数据更新仍然只在 BLE 会话（按键唤醒 / 网页连接）里发生。
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
  真实手机的分块极限（大标题/长列表）、USB 拔掉后纯电池的 3 分钟自动锁屏、
  锁屏定时唤醒的实际一天耗电（估算见 13.5，需要外部表计或长期放电实测）。
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

------

## 15. 2026-11-16：品牌化（墨程CalCal）

产品名定为 **墨程CalCal**，logo 用 `miniprogram/CalCal_logo.png`。这次把品牌从
“文档里的名字”落到了固件和各个客户端：

### 15.1 固件

- 新增 `components/brand/`：`brand.h` 是产品名、ASCII 广播别名、tagline、版本号的
  唯一来源；`src/brand_logo.c` 由 `tools/gen_brand_assets.py` 从 logo PNG 生成
  200x140（splash）、96x67（锁屏）、32x22（顶栏 logo）三张 1-bit 位图，另生成
  20 px 的顶栏 wordmark（第 16 节改成紧凑顶栏后使用）。
- `gfx_bitmap()` 负责把 1-bit 行位图画进 framebuffer；位图 MSB 在左，1 = 黑。
- 冷启动先画品牌 splash（logo + 名称 + tagline + 平台行），保持 1.2 s，再画月历；
  splash 和首帧月历都用 FULL，因为两张图没有共同内容，用 HALF 可能留下 logo 残影。
  深睡唤醒不画 splash（玻璃上已有锁屏），仍按原策略用 HALF。
- 锁屏把原来的“休眠中”标题换成大 logo + `墨程CalCal` + tagline，日程列表下移 16 px，
  5 条仍然放得下；页脚改成“按 POWER 唤醒”。
- 月/日/详情页顶栏加上 `logo + 墨程CalCal`，品牌在所有日历页都可见；第 16 节
  进一步把顶栏改成紧凑 wordmark 并调整了高度。
- 5x7 字体补了 ASCII 0x60..0x7A（反引号和 a-z），`gfx_text()` 不再强制转大写，
  这样 `CalCal` 的大小写能正确显示；事件标题里的小写字母也不再被改写。
- BLE 广播/GAP 名保留 ASCII 别名 `Mochen CalCal`；`hello` 和 INFO 的 `name` 改为
  `墨程CalCal`，固件版本改用 `BRAND_FW_VERSION`（2026-11-17 又改成从 `version.txt`
  经 app description 读取，见第 1 节，那个宏已删）。
- CMake 工程名从 `onepage_c61_idf_demo` 改为 `mocheng_calcal`，产物是
  `build/mocheng_calcal.bin`。

### 15.2 客户端与文档

- 小程序：`config.appName` 改为 `墨程CalCal`；登录页、日程页、我的页都用
  `/CalCal_logo.png`；页面标题统一为 `墨程CalCal`；广播名过滤仍是 `Mochen`。
- 网页：标题和页头改为 `墨程CalCal`，把 logo 复制到 `web/CalCal_logo.png` 并在页头显示。
- 服务端/文档：包名、README 标题、BLE 协议示例里的展示名统一；备份魔数、HKDF salt
  等内部兼容常量保持不变。
- 命名规则写进了 `AGENTS.md` 和 README 的 “Brand and naming” 一节。

### 15.3 验证

- `tools/gen_brand_assets.py` 重新生成三张 logo 位图（第 16 节又加了 wordmark）；
  `tools/preview_calendar.py` 增加
  `preview_boot.png`，月历/日/详情/锁屏预览全部重绘。
- `tools/check_font_coverage.py` 通过（品牌字符串里的汉字都在 GB2312 表里）。
- `idf.py build` 重新配置并通过（见构建日志）。

------

## 16. 2026-11-16：去空格、顶栏加高、字号收紧与基线对齐

按使用反馈做了第二轮调整：

### 16.1 产品名去掉空格

- 正式展示名从 `墨程 CalCal` 改为 **`墨程CalCal`**；`brand.h` 的
  `BRAND_NAME` 改为 `BRAND_NAME_ZH BRAND_NAME_EN` 直接拼接。
- 小程序、网页、服务端文档、BLE 文档、测试 fixture 和 AGENTS/README 全部同步。
  注意 BLE 广播别名仍是 `Mochen CalCal`（两个英文词之间保留空格）。

### 16.2 顶栏加高、底栏收窄，内容区不变

- `HEADER_RULE_Y` 52 → 64，`TITLE_Y` 68 → 80，`MONTH_GRID_Y` 140 → 152。
- `FOOTER_TEXT_Y` 752 → 764，`FOOTER_RULE_Y` 736 → 748，`CONTENT_BOTTOM`
  720 → 732。
- 于是中间内容区仍是 64..732（668 px），顶部状态栏从 52 px 变成 64 px，
  底部状态栏从 64 px 变成 52 px；月历 peek card 的底边仍正好落在内容区底部。

### 16.3 顶栏字号收紧

- 顶栏不再用 24 px CJK 文本画品牌名；`gen_brand_assets.py` 用 Noto Sans CJK SC
  额外渲染一张 **20 px 的 1-bit wordmark**（`brand_wordmark`，98x19），
  文字取自 `brand.h`，所以改名不会漂移。
- 顶栏 logo 从 40x28 缩到 32x22；电量/时钟曾试过 scale 2，但观感太差，最终
  恢复 5x7 scale 3（21 px ink）。
- 统一以 `HEADER_BASELINE_Y=48` 为墨迹底边：logo 底、wordmark 底、BLE 图标底和
  电量/时钟墨迹底都对齐到 42，顶栏虽然加高但不显散。

### 16.4 中英文数字基线

- 根因：5x7 ASCII 只有 7 行墨迹（scale 3 时 21 px），CJK 是 24 px；两者都从同一个
  `y` 顶部画，所以英文/数字比中文高 3 px。
- 修复：`gfx_text()` 把 5x7 墨迹整体下移一个 scale 行（scale 3 → +3 px），使最后一行
  墨迹落在 `y + 8*scale - 1`，与 24 px CJK 字形的底部（最多到第 23 行）一致。
- `tools/preview_calendar.py` 的 `text5x7()` 同步加同样的偏移，预览与固件一致。
- 回归检查：月历日期/事件数、日视图时间+中文标题、详情页日期、锁屏日期/时间、
  页脚按键提示都已在预览中确认底对齐。

### 16.5 验证

- `idf.py build` 通过，产物 `0x1437d0` bytes。
- `tools/check_font_coverage.py` 通过。
- 预览图：`preview_month.png`、`preview_day.png`、`preview_detail.png`、
  `preview_delete.png`、`preview_sleep.png` 全部重绘检查。

### 16.6 2026-11-16 稍后：电量/时钟恢复原字号

把电量百分比和时钟从 5x7 scale 2 恢复为 **scale 3（21 px ink）**。顶栏高度、32 px
logo、20 px wordmark 和 64 px 分隔线保持不变；`HEADER_STATUS_Y` 随之从 26 回到 18，
仍与 logo/wordmark 共享 `HEADER_BASELINE_Y=48` 的底边。这样既保留上一轮“顶栏不挤”
的效果，又恢复原有电量/时钟的可读性。

### 16.7 顶栏右侧顺序调整

- 品牌 logo + wordmark 仍固定在左侧。
- 右侧改成一组右对齐状态：**电池 → 时钟 → 蓝牙图标**（蓝牙最右），
  `HEADER_RIGHT_GAP=14`；蓝牙图标槽位 18 px，连接徽标右边缘贴住内容区右边界。
- 蓝牙不可用时只把警告画在时钟和图标之间的空隙里，图标位置不移动，状态组不跳。

### 16.8 顶栏品牌墨迹高度对齐

- 右侧时钟/电量是 5x7 scale 3，墨迹高 **21 px**。
- 顶栏 logo 宽度从 32 改成 **30 px**（高 21 px）；wordmark 字体从 20 px 改成
  **22 px**，Noto 渲染出的墨迹盒正好 21 px。
- 两者仍以 `HEADER_BASELINE_Y=48` 为底边，所以和右侧时钟数字上下完全齐平。

### 16.9 顶栏内容下移

- `HEADER_BASELINE_Y` 42 → **48**，整组品牌/状态下移 6 px。
- 墨迹最后一行从 41 变成 47，顶栏分割线仍在 64，二者间距从 22 px 缩到 **16 px**。
- 顶栏高度、字号、右侧“电池 → 时钟 → 蓝牙”顺序都不变。

### 16.10 蓝牙失败状态去掉感叹号

- `draw_ble_warning()` 和顶栏里的调用一起删除；蓝牙不可用时只保留 50% 棋盘抖动的
  蓝牙图标，不再在左侧画同样抖动的感叹号。
- 图标位置、电池/时钟位置和 14 px 间距都不变，三种状态之间切换不会移动状态组。

### 16.11 peek card 的“X 条”内缩

- 月历下方 peek card 的次数原先用 `draw_right()`，右边缘对齐到屏幕内容边距 x=450，
  但卡片内框在 x=446，最后面的“条”会压到内框线。
- 改为按卡片内边距右对齐：`x + w - GAP_L - text_width`，右边缘落在 x=434，
  与内框留 12 px，和标题左侧的 16 px 内边距对应。
- `tools/preview_calendar.py` 本来就是这个算法，这次只是把固件对齐到预览。

### 16.12 当天日程页去掉日期下的分割线

- 当天日程页（day view）原先在日期和事件列表之间还有一条横线：
  `TITLE_Y + BODY_H + GAP_M` = 116，与 64 px 的顶栏分隔线只隔一条日期，视觉上重复。
- 删除这条线，列表起点从 132 提到 **120**（日期下方 16 px），事件行、选中反白和
  页脚都不变；月历、详情页的线不受影响。

### 16.13 当天日程页日期行增加上下留白

- 新增 `DAY_TITLE_Y = TITLE_Y + 8`（88）和 `DAY_BODY_GAP = 24`。
- 日期行顶部到顶栏分隔线 24 px（原 16），日期到事件列表 24 px（原 16）。
- 列表起点从 120 移到 **136**；8 行事件最后一行结束于 712，内容区底部 732，
  仍留有 20 px。空状态文案位置未动。

### 16.14 蓝牙图标与数字同高、底对齐

- `HEADER_BLE_Y` 从 `HEADER_BASELINE_Y - 25` 改为 `HEADER_BASELINE_Y - 21`，图标
  顶端与 5x7 scale 3 数字的墨迹顶端一致。
- `draw_ble_icon()` 重画为 21 px 高：连接徽标高度 21，轮廓线用 2 px 笔刷时线心
  取 `y+1..y+20`，实际覆盖 `y..y+20`；失效态的棋盘抖动也限制在这 21 行内。
- 三种状态（广播、已连接、蓝牙不可用）的图标底边都是 47，与电量/时钟数字底边一致。

### 16.15 “按 POWER 唤醒”左右空格视觉一致

- 5x7 的 `POWER` 最后一格 `R` 右侧自带 3 px 空白，普通 UTF-8 空格让 POWER 后面
  的视觉间隙是 23 px，前面是 20 px。
- 新增 `draw_power_hint()`：把“按 / POWER / 唤醒”分三段画，前间距 18 px、后间距
  15 px 补偿 R 的尾部空白，两侧墨迹间隙都变成 20 px。
- `tools/preview_calendar.py` 的 `power_hint()` 同步实现。
- 2026-11-19 按键名统一为中文后，`draw_power_hint()` 改为整行居中，这条补偿不再适用（见第 25 节）。

### 16.16 锁屏副标题改为“墨水屏日程表”

- 锁屏名称行右侧原先是 `BRAND_TAGLINE`（“蓝牙墨水屏日历”，24 px，7 字 = 175 px）。
  现在改为新增的 `BRAND_LOCK_SUBTITLE = "墨水屏日程表"`（6 字 = 150 px，右对齐后
  x=300..450），与左侧 `墨程CalCal`（x=30..188）之间留 112 px，不挤压。
- 冷启动 splash 仍然用 `BRAND_TAGLINE`；`BRAND_LOCK_SUBTITLE` 只在锁屏使用，
  两个字符串都只定义在 `brand.h`。
- 时钟/日期保持原样（scale 4 在 y=26、scale 3 在 y=68）。中间试过“删掉副标题、
  时钟/日期放大到 scale 6/5 填满右上角”的方案：右侧墨块过重、和左边 96x67 的 logo
  不均衡，已回退，不要再放大。
- `tools/preview_calendar.py` 的锁屏预览同步。

### 16.17 锁屏空状态加小程序码

- 没有待办日程时，锁屏在“接下来的日程”下方居中显示小程序码（248x248）加原来的
  两行提示；有日程时列表布局完全不变。
- 码源是 `miniprogram/miniprogram_qrcode.jpg`（258x258 的微信小程序码）。新增
  `tools/gen_qrcode.py`，生成 `components/brand/src/brand_qrcode.c`（1-bit，
  7.5 KB）和供眼睛检查的 `tools/preview_qrcode.png`（2x 最近邻放大）。
- 生成脚本先按墨迹 bbox 取正方形（bbox 因右下角绿色小程序角标略偏，直接裁会
  偏心），再按 `gen_brand_assets.py` 的阈值 160 二值化，JPEG 的白边被裁掉——面板上
  码四周的白画布就是扫码需要的静区。
- 版式：`LOCK_TITLE_Y = 148`、`LOCK_LIST_TOP = 172`，码与提示间距 32 px、两行提示
  间距 36 px；整块高 248 + 32 + 36 + 24 = 340，居中于 172..732 得 QR 282..530、
  提示 562/598，上下各留 110 px。`draw_lock_empty()` 只算一次 `top`。
- `brand_qrcode` 在 `brand.h` 声明、由 `components/brand/CMakeLists.txt` 编进
  `brand` 组件；`tools/preview_calendar.py` 改为扫描 `brand/src/*.c`，并新增
  `preview_sleep_empty.png`。
- 未验证：面板 4.26"、480 px 宽约 55.7 mm，248 px 的码约 **2.9 cm**，尺寸够扫码但
  必须真机用微信实测；1-bit 二值化把中间的 logo 和小程序角标画成实心，属于预期。

### 16.18 小程序添加日程改成月历点选日期

- `miniprogram/pages/index` 的“添加日程”里，日期从 `<picker mode="date">`（系统滚轮）改成
  内嵌月历：点日期框展开，`‹ ›` 翻月，直接点格子选日，右上角“今天”一键回到今天；
  开始/结束时间仍是系统时间滚轮。
- 微信没有官方原生 calendar 组件（第三方的 wx-calendar 之类要 npm 构建再引组件），
  所以用 WXML/WXSS 自己画，沿用纸感配色：选中日是深蓝圆点、今天有描边、
  非本月日期淡显。
- 纯逻辑在 `miniprogram/utils/calendar.js`：`monthGrid(year, month, selectedYmd,
  todayYmd)` 固定 42 格（6 周）、周日开头（和设备月历方向一致），另有 `cursorFrom` /
  `monthLabel` / `WEEKDAY_INITIALS`。固定 6 周是为了翻月时面板高度不跳。
- 页面状态 `weekdays / calendarOpen / calendarLabel / calendarCells`，方法
  `toggleCalendar / shiftCalendarMonth / renderCalendar / pickDay / pickToday /
  chooseDate`。选中后写回 `form.date` 并收起面板，`chooseDate` 把光标移到所选日期
  所在月；提交成功后也收起面板。
- 翻月范围限制在 2020-01..2099-12，对齐旧滚轮 picker 的 `start/end` 实用范围，
  避免翻到无意义年份。
- 测试：`miniprogram/test/calendar.test.js`（42 格、周日开头、闰年、跨月选中）+
  `page.mock.test.js`（模拟 Page 的展开/翻月/点选/今天/边界），加上原有的
  `protocol / ble.mock / sync.mock` 用例，全量 28 个用例通过。
- 预览图 `tools/preview_miniprogram_calendar.png` 不是真机截图：把 `app.wxss` +
  `index.wxss` 的 rpx 按 1:1 换成 px，用无头 Chrome 渲染页面版式，只用于检查间距
  （已 gitignore）。真机效果仍需在开发者工具/微信里确认。

### 16.19 添加日程：结束时间跟随开始时间 +30 分钟

- `onStart()` 确认开始时间后同时写 `form.end = fmt.shiftClock(start, 30)`；
  用户之后仍可手动改结束时间，只有再次确认开始时间才会重新按 +30 计算。
- 新增 `fmt.shiftClock(hhmm, minutes)`（`utils/format.js`）：只接受 `HH:MM`，按分钟
  加减并**夹在同一天 00:00..23:59**——日程不跨天，所以 23:40 + 30 得到 23:59，
  非法输入原样返回。
- `defaultForm()` 的默认结束时间从 +60 改成 +30，让表单初始值和“确认开始后”的行为一致；
  默认值也走 `shiftClock`，晚上打开表单不会再出现 end < start 的初始状态。
- 测试：`test/format.test.js`（跨小时、当日边界夹取、非法输入）+
  `test/form.mock.test.js` 的 3 个用例（+30、手选结束保留、23:40 夹到 23:59）。

### 16.20 月历展开时自动滚进屏幕

- 问题：日期栏在“添加日程”卡片顶部，卡片下方还有标题/备注/保存按钮，短屏上展开月历会
  有一部分落在折叠线以下。
- `toggleCalendar()` 打开面板时把 `revealCalendar()` 放在 `setData(..., callback)` 里
  执行（回调在视图更新之后），用 `wx.createSelectorQuery()` 量 `.cal` 的
  `boundingClientRect` 和 `selectViewport().scrollOffset()`，再读
  `wx.getWindowInfo().windowHeight`（旧基础库回退 `wx.getSystemInfoSync()`），
  需要时 `wx.pageScrollTo({ scrollTop, duration: 200 })`。
- 滚动量是纯函数 `cal.revealScrollTop({ top, height, scrollTop, viewport, margin })`
  （`utils/calendar.js`）：已经完整可见（含 12 px 余量）返回 `null` 不滚动；能放下时
  只补足底部的溢出量；整块比屏幕还高时对齐顶部、优先露出月份标题和前几周。
- 面板在测量回调返回前被关掉就不滚动（`if (!this.data.calendarOpen) return`）。
- 测试：`test/calendar.test.js` 的纯函数用例 + `test/form.mock.test.js` 里 4 个
  用例（滚到可见、已可见不滚、超高对齐顶部、关闭不滚），全量 34 个用例通过。

### 16.21 设备卡片连接后自动收起

- 连上板子后“设备”卡片自动收起设备信息（名称/固件/设备日程/设备时间），给下面的添加
  日程/本月日程腾出屏幕；同步/锁屏休眠/断开三个按钮常驻，不随信息一起隐藏。标题行右侧
  显示“展开/收起”，整行可点（`toggleDeviceCard()`），只在 `connected` 时生效——未连接
  时扫描/连接按钮必须一直可见，点标题不做任何事。
- `ble.onState` 回调里按“状态跃迁”决定：`connected` 由 false → true 时置
  `deviceOpen = false`；断开时 `deviceOpen = true`（扫描界面重新出现）。重复的
  connected 事件不会把用户手动展开的卡片再收起来，因为只在 `!this.data.connected`
  时才收起。
- 视图：标题行加 `bindtap="toggleDeviceCard"`、`hover-class`（仅连接时）和
  `head-toggle` 文案；连接后的内容块仍是 `wx:else`，只把 `device-info` 包进
  `wx:if="{{deviceOpen}}"`，按钮行在折叠状态下照常显示；收起时去掉标题行的下边距
  （`.card-head.collapsed`）。
- 测试：`test/page.mock.test.js` 增加 3 个用例（连接收起/断开展开、手动展开后不被
  重复事件收回、未连接时点击无效），`ble.onState` 用假回调触发；全量 37 个用例通过。

### 16.22 设备卡片里扫描状态行的上下留白

- `.empty` 是通用空状态（上下各 56rpx）。用在设备卡片的“正在搜索附近的蓝牙设备…”和
  “没有发现设备…”上时，加上卡片自身 28rpx 的内边距，一行字上下各空 84rpx，看着像
  一块空洞。
- 新增 `.empty.compact { padding: 20rpx 0 6rpx; }`，只给设备卡片这两行加 `compact`；
  本月日程卡片的空状态继续用 `.empty` 的大留白，不受影响。
- 预览 `tools/preview_miniprogram_scan.png`：无头 Chrome 按 `app.wxss` + `index.wxss`
  原值 1:1 渲染的版式检查图（不是真机截图，已 gitignore）。

### 16.23 设备休眠后不再显示过期的扫描结果

- 现象：连接后在设备卡片里点“锁屏”，板子 ack 后立刻关射频 →
  `onBLEConnectionStateChange` 把 `connected` 置 false，页面回到未连接态；但 `devices` /
  `hasScanned` 还留着上一次扫描到的 `Mochen CalCal`，列表里挂着一个已经睡着的设备，
  点“连接”必然失败。
- `ble.onState` 回调里，只有**从已连接变为未连接**时才清空 `devices` / `hasScanned` /
  `scanning`（覆盖锁屏休眠、手动断开、意外掉线）。连接失败时 `connected` 一直是
  false，不清空——用户正在看的列表不该因为一次连接失败就消失。
- 清空后按钮文案回到“扫描设备”，“扫描完成 · N 个设备”提示消失；再点扫描会重新扫
  5 秒，列表只留本轮结果。
- 测试：`test/page.mock.test.js` 增加 2 个用例（连接结束清空、连接失败保留），全量
  39 个用例通过。

### 16.24 小程序拆成三个 tab：添加 / 日程 / 我的

- 原来「日程」tab 一个页面同时放设备卡片、新建表单和本月列表，页面太长；现在拆成：
  「添加」（`pages/index`，设备连接/同步 + 新建日程表单 + 协议日志）、
  「日程」（`pages/calendar`，本月列表 + 翻月 + 删除）、「我的」（`pages/profile`）。
- 新增 `pages/calendar/`（js/wxml/wxss/json）：`loadMonth/shiftMonth/prevMonth/nextMonth/
  remove/doRemove` 和 `monthCursor/monthLabel/groups/eventCount/loading` 从 index 原样搬过去；
  `onShow` 每次重新拉当月（添加页可能刚写过云端），未登录仍 `reLaunch` 登录页。
- 列表相关样式（`.month-bar/.month-btn/.month-label/.day-group/.day-head/.event*`）
  从 `pages/index/index.wxss` 移到 `pages/calendar/calendar.wxss`，index 不再引用。
- index 页面删掉 month 状态、`loadMonth` 调用（onShow/connect/refresh/submit/syncDevice）
  和删除逻辑；`refresh()` 现在只做设备同步；保存成功后不再切月份（列表在日程 tab，
  切过去时 `onShow` 会重新加载）。
- `app.json` 的 `pages` 加 `pages/calendar/calendar`，`tabBar.list` 变成
  「添加 / 日程 / 我的」三项（仍是纯文字，无图标）。
- 测试：新增 `test/month.mock.test.js`（当月初次加载、翻月边界、未连设备删云端、
  已连接同时删设备，4 个用例），全量 43 个用例通过。
- 预览 `tools/preview_miniprogram_tabs.png` 是按真实 wxss 1:1 渲染的排版检查图
  （tabBar 是模拟绘制，不是真机截图，已 gitignore）。

## 17. 2026-11-16：日程从 NVS 迁到 LittleFS

### 17.1 分区表重排（方案 B′）

| 区域 | 偏移 | 大小 | 用途 |
|:---|:---|:---|:---|
| nvs | 0x9000 | 20 KB | 时钟/时区 + PHY/BT 校准（不再放日程） |
| otadata | 0xe000 | 8 KB | 厂商 bootloader 的启动选择 |
| factory | 0x10000 | 3 MB | 应用（现约 1.38 MB） |
| coredump | 0x310000 | 64 KB | 崩溃转储 |
| storage | 0x320000 | 0xCE0000 ≈ 12.9 MB | LittleFS：`/lfs/calendar.db` + 以后的数据 |

- 头部（nvs/otadata/factory 偏移）保持和厂商固件一致，仍可刷回；尾部原来的
  6.25 MB 空白（厂商 ota_1）和 3.375 MB spiffs 全部收进 storage。
- **改表后必须 `idf.py flash -a`**：只刷 app 会找不到 storage 分区，
  `calendar_init()` 报 `littlefs mount failed (flash the new partition table?)`
  后 `ESP_ERROR_CHECK` 重启。

### 17.2 LittleFS 依赖（vendored）

- `components/littlefs`：`joltwallet/esp_littlefs` 1.23.0（MIT，Copyright 2020
  Brian Pugh），只保留构建必需文件（`CMakeLists.txt`、`Kconfig`、`LICENSE`、
  `include/`、`src/`），去掉 tests/scripts/benches/example，约 430 KB。和
  `components/cjson` 一样不走 managed_components，离线构建可复现。
- `CONFIG_LITTLEFS_LOOKAHEAD_SIZE=512`：storage 有 3300 个 4 KB block，默认
  128 B 的 lookahead 只覆盖 1024 block，mount 会 `ERR_BADLOOKAHEAD`；已写进
  `sdkconfig.defaults`（新符号，现有 `sdkconfig` 会自动取 defaults 值）。

### 17.3 存储与迁移

- `calendar.c` 的 blob 格式（magic/version/CRC/变长记录）不变，只把 NVS blob
  读写换成文件读写：
  - 写：`calendar.db.tmp` → `fclose` → `rename()`（LittleFS 原子），失败删 tmp；
  - 读：`fread` 最多 `DB_MAX_BYTES`，再多读一个字节判超长；超长或 CRC/版本
    校验失败都改名为 `calendar.db.bad`，回退默认日历；
  - 容量剪枝从“NVS 满”改成“`pack_db()` 返回 0”（即超过 `DB_MAX_BYTES`），
    语义不变：先删最久远的过去事件，都是未来事件就还 `calendar full`。
- 首启迁移：文件不存在 → 读 NVS `calstore/db` → CRC 校验 → 原子写文件 →
  `nvs_erase_key` + commit。写失败则保留 NVS 副本，下次启动重试。`epoch`/`tz`
  继续留在 NVS。迁移后回滚旧固件读不到日程（NVS 副本已删），云端可重新同步。
- 关键日志：`littlefs: X/Y KB used`、`migrated N events from NVS to
  /lfs/calendar.db`、`loaded N events ... from /lfs/calendar.db`。
- 挂载用 `format_if_mount_failed = true`：首次上电（分区全 0xFF）自动格式化；
  如果文件系统本身损坏也会被重格式化（日历文件丢失，靠云端重新同步恢复），
  这是"日历是云端缓存"的取舍，换来不需要单独的分区版本/初始化流程。

### 17.4 验证

- 构建通过：app `0x150e30`（1.38 MB），factory 分区余 56%。
- 生成的 partition-table.bin dump 校验：20 KB / 8 KB / 0x10000+3 MB / 0x310000
  +64 KB / 0x320000+0xCE0000，结束于 0x1000000。
- **未上板**：NVS→文件迁移、保存时拔电的原子性、12.9 MB LittleFS 的 mount
  与读写耗时都要真机验证（见 README checklist 第 8 条）。

> 第 13.2 节“为什么是 NVS”是 2026-11-10 的历史结论，已被本次迁移取代。

## 18. 2026-11-16：标题/备注上限 47/95 → 95/191 字节

- 存储搬到 LittleFS 后，47/95 不再是 NVS 的容量约束。新上限由三件事决定：
  - 打包格式的 `title_len`/`note_len` 是 uint8 → 单字段最大 255 字节（再大要升格式）；
  - 屏幕：24 px 字、内容宽 420 px ≈ 23 个 ASCII / 16 个汉字一行；详情页最多
    5 行标题 + 11 行备注（见 18.1），95 B（最坏 95 个 ASCII = 5 行）和 191 B
    （最坏 9 行）都能完整显示；
  - BLE JSON 缓冲：按最坏"每字节转义成 2 字符"算，95/191 的出站/入站行是
    673/656 字节，现有 `json[768]`、`NOTIFY_BUF_SIZE 900`、`LINE_BUF_SIZE 768`
    仍然放得下（127/255 就会溢出，需要放大缓冲并多吃 host task 栈）。
- 固件：`CAL_TITLE_BYTES 96`、`CAL_NOTE_BYTES 192`（可用 95/191）、
  `DB_MAX_BYTES 32768`（96 条 × 298 B + 16 = 28,624）；`cal_event_t` 154 → 296 B，
  96 条数组 28.4 KB PSRAM；`send_event()` 的 title/note/json 缓冲 200/400/768。
- 服务端：`TITLE_BYTES 95` / `NOTE_BYTES 191`（`truncateUtf8` 按整字符截断）；
  新增测试断言 40 个汉字标题截成 31 个（93 B）、80 个汉字备注截成 63 个（189 B）。
- 客户端：小程序计数器改成 `/95`、`/191`，输入改为**按 UTF-8 字节截断**
  （`utils/utf8.js` 新增 `clamp()`，`onTitle`/`onNote` 调用，`maxlength` 设为 `-1`）。
  原来的 `maxlength=30/60 字符` 会让中文只能写到 90/180 字节（3 字节/字），而且接近
  上限时输入法的组合串会撞上 maxlength、被截断后计数看起来乱跳；改成字节截断后
  中文能写满 31/63 字（93/189 B），英文能写满 95/191 个字符。
  网页 `maxlength` 15/30 → 31/63 字；协议文档、README、排错表同步。
- 兼容：新固件能读旧文件、旧 NVS 迁移（旧长度都小于新上限）；**旧固件读不了新
  文件**（旧代码按 48/96 校验长度），回滚会回退默认日历，云端可恢复。
- 验证：`idf.py build` 通过（app `0x150e70`，factory 3 MB 余 56%）；服务端
  `node --test` 18 个用例通过；小程序 43 个用例通过。

### 18.1 详情页：长标题/备注完整显示

- 原因：详情页标题 `gfx_text_utf8_wrap(..., 2)`、备注 `(..., 8)`，而
  `gfx_text_utf8_wrap()` 内部还硬编码 `max_lines <= 8` + `lines[8]`；以前
  47/95 字节的内容放得下，现在 95/191 字节的英文标题/备注会超过 2/8 行被省略。
- 改法：
  - `gfx_text_utf8_wrap()` 上限 8 → **16** 行（`lines[16]`）；
  - 详情页标题 2 → **5** 行（95 字节纯 ASCII 最坏 5 行）；备注 8 →
    **`16 - title_lines`** 行。
  - 版式不变，靠 `title_lines` 自适应：`meta_y = TITLE_Y + 32*T + 8`，
    `note_start = 208 + 32*T`，所以 `T + N <= 16` 时最后一行墨迹都在 712，
    页脚分割线（748）之前；标题 5 行时备注仍有 11 行（191 B 最坏 9 行）。
- `tools/preview_calendar.py`：`Screen` 增加 `wrap()`（同样按 18/25 px 步进、
  截断加省略号），`detail_preview(long_text=True)` 输出 `preview_detail_long.png`
  （已 gitignore），用来目检长标题/备注不会压到页脚。
- 验证：`idf.py build` 通过；预览图确认长标题 5 行 + 长备注 10 行完整显示，
  与页脚之间仍有余量。

## 19. 2026-11-17：设备卡片状态灯左移、右侧改为展开收起按钮

### 19.1 状态灯与展开按钮换位

- 原来的标题行是「设备  已连接 …… 收起 ●」：状态灯在最右，和它说明的连接状态隔着整行；
  右侧只有一个浅色小字「展开/收起」，看不出能点。
- 现在状态灯移到「已连接 / 连接中… / 未连接」左侧（`index.wxml` 里 `.dot` 进
  `.card-heading`、放在 `hint` 之前），灯原来的位置换成右侧的「展开 ▾ / 收起 ▴」
  （`.head-toggle`；箭头 `.head-caret` 用 CSS 三角画，`up` 时 `rotate(180deg)` 指回
  上方）。这个展开/收起保持**纯文字 + 箭头**：不描边、也没有圆角浅底/胶囊，颜色沿用
  原来的 `#8b8778`，视觉上仍是标题行的一部分；可点性靠箭头和整行的 `hover-class`
  反馈，不靠按钮外壳。
- 灯和文字是一对，所以标题行改成垂直居中：`.card-head.device-head` 与
  `.device-head .card-heading` 都用 `align-items: center`；同时去掉 `app.wxss` 里
  `.dot` 的 `margin-top: 12rpx`——那 12rpx 是给旧的 `flex-start` 位置补的下推，
  居中后会把灯压到文字下沿。
- 点击区域不变：仍是整行 `bindtap="toggleDeviceCard"`，未连接时无效。胶囊只是视觉上的
  按钮，**不**另绑 `bindtap`/`catchtap`，否则冒泡会让一次点击翻两次、看起来没反应。
- 验证：`node --test test/*.test.js` 46 个用例通过；`tools/preview_miniprogram_device.png`
  是无头 Chrome 按 `app.wxss` + `index.wxss` 的 rpx 1:1 渲染的四种状态排版检查图
  （未连接 / 连接中 / 已连接收起 / 已连接展开，已 gitignore，不是真机截图）。
  真机仍需在开发者工具/微信里确认。

## 20. 2026-11-18：小程序支持编辑日程，BLE 增加 update（proto 2）

### 20.1 为什么不能只改云端

小程序原来只有「添加」和「删除」：`api.events` 返回的云端记录没有编辑入口；同步逻辑也只
按设备 id 判断“有没有”，云端内容改了但 id 还在设备上时，`syncDevice()` 不会重写设备。
所以编辑必须同时补三处：云端更新接口、设备原地更新命令、同步时的内容比对。

### 20.2 固件

- `calendar_update_event(id, event)`：按 id 找到旧记录，规范化结束时间（与 add 共用
  `sanitize_event()`：end 缺失/不晚于 start 时补 60 分钟、最多 24:00），替换后重新排序、
  用**原 id** 落盘；写盘失败时把旧记录插回去。`save_db_locked(id, …)` 传 `keep_id`，
  数据库到字节上限时不会把正在编辑的这条当成“最老过去日程”清掉。
- BLE 新增 `{"cmd":"update","id":…,…}`：字段/上限与 `add` 相同（标题 95 B、备注 191 B），
  ack `{"ok":true,"cmd":"update","id":…,"trunc":false}`；未知 id 返回 `not found`。
  `handle_add` 和 `handle_update` 共用 `parse_event()`，避免两套校验漂移。
- `PROTO_VERSION` 1 → 2，`version.txt` 1.1.0 → 1.2.0。旧固件不认这个命令，会回
  `unknown cmd`；小程序对此有删除+新增的回退，见 20.4。

### 20.3 服务端

- 新增修改路由：`POST /api/events/:id`（也接受 `PATCH`；小程序用 `POST`，因为
  `wx.request` 没文档化支持 `PATCH`，昵称接口此前已因此用 `POST`）。
- 请求体先与已存事件合并，再走 `normalizeEvent()` 校验；只改标题也不会把日期/时间清空。
  `deviceId` 和 `createdAt` 保留——设备上的同一条记录仍按原 id 更新。已软删除的返回 409。

### 20.4 小程序

- 「日程」tab 每条右侧加了「编辑」：点开顶部编辑卡片，日期用原生 `mode="date"`
  （2020–2099），开始/结束时间仍用系统时间滚轮；改动开始时间会自动把结束时间顺延
  30 分钟。标题/备注按 UTF-8 字节截断（95/191，常量抽到 `utils/event.js`）。
- 保存：`api.updateEvent()` 先写云端，再按连接状态推设备：
  - 已映射到设备 → `utils/device-sync.js` 的 `pushUpdate()` 发 `update`，id 不变；
  - 设备返回 `unknown cmd`（老固件）→ `del` + `add`，再把云端映射重指到新 id；`add`
    失败时把映射清空，下一次同步会把改过的云端事件重新加上，而不是当成设备删除；
  - 设备返回 `not found`（设备重置过）→ 直接 `add` 并重映射；
  - 云端事件还没 `deviceId` 但当前连着设备 → 直接 `add` + `mapDevice`，不用等下一次同步。
- `syncDevice()` 增加第 3 步：云端和设备都有、但内容不同（`sameEvent()` 为假）时推送
  `update`；老固件回退后同步 `deviceIds/claimed/removed` 集合，避免把刚删掉的旧 id
  当成设备独有事件重新导入。离线编辑就靠这一步在下次连接时落到设备。
- 「我的」页的 `config.protocol` 同步改成 2；README/协议文档补了编辑和 `update` 的说明。

### 20.5 验证

- `idf.py build` 通过；`mocheng_calcal.bin` 0x1514d0，factory 3 MB 余 56%。
- 服务端 `node --test` 18 个用例通过（含 `POST`/`PATCH` 修改、局部字段、保留 deviceId、
  已删除 409、空标题/坏日期 400）。
- 小程序 `node --test test/*.test.js` 59 个用例通过：新增 `device-sync.test.js`，月列表
  覆盖“连线编辑同步/离线只改云端/云端独有事件补加/参数校验/24:00 显示”，
  `sync.mock` 覆盖“原地 update”和“老固件回退不重复导入”，BLE mock 覆盖 `update` 命令。
- 未上板：`update` 的 ack、旧固件回退和同步后的设备列表仍需按 README 的真机清单验证。

## 21. 2026-11-18：小程序语音日程（DeepSeek ASR + AI 解析）

### 21.1 为什么走服务端代理

DeepSeek 的语音识别接口（`POST /v1/tools/asr`）要求 `multipart/form-data`，只接受
16 位 PCM WAV 或 Ogg Opus，最长 120 秒、最大 8 MiB。小程序的 `RecorderManager` 能录
PCM，但没有 WAV 头；更关键的是 **API Key 不能放进小程序源码**，否则反编译即可拿到。
所以新增两个需要登录的服务端接口，小程序只请求自己的 `apiBase`：

- `POST /api/ai/transcribe`：收 base64 音频，补 WAV 头后转发 ASR；
- `POST /api/ai/schedule`：收识别文本，用 `deepseek-flash` 的 JSON 模式解析成日程草案。

服务端只在内存里处理音频，不落盘；每个用户每分钟最多 20 次 AI/ASR 请求。没配
`DEEPSEEK_API_KEY` 时接口返回 503，`/api/health` 的 `ai` 为 `false`，其余功能不受影响。

### 21.2 服务端

- 新增 `src/ai.js`：`buildWav()`（44 字节头、8000–48000 Hz、单/双声道、16 位、最长 120 秒）、
  `prepareAudio()`（已经是 RIFF/WAVE 或 OggS 就直传，否则补头）、`transcribe()`、
  `parseSchedule()`；DeepSeek 错误统一映射成可读的 4xx/5xx（429 频繁、504 超时、
  401/403 提示服务端 Key 无效）。
- 解析提示词带上 `SCHEDULE_TIMEZONE` 的当前日期/时间/星期，要求只输出
  `{"date","start","end","title","note"}`；结果仍走 `normalizeEvent()` 校验与截断，
  标题缺失时退回用户原话，结束时间缺失/不合法时默认 30 分钟（与添加表单一致）。
- 把日期/时间/标题校验从 `app.js` 抽到 `src/event-rules.js`，把 `httpError` 抽到
  `src/http-error.js`，ASR 和事件接口共用同一套规则；`normalizeEvent()` 增加
  `defaultEndMinutes` 选项（API 新增仍默认 60 分钟）。
- `config.js` 增加 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、
  `DEEPSEEK_TIMEOUT_MS`、`SCHEDULE_TIMEZONE`；启动日志打印
  `voice schedule: configured / NOT configured`。
- 测试 `server/test/ai.test.js` 覆盖 WAV 头字段、PCM/WAV/Ogg 识别、时区、ASR 请求的
  `file` 字段与返回、错误映射、JSON 围栏、结束时间修正、标题回退、坏日期、路由鉴权
  与缺 Key；服务端共 31 个用例通过（含 121 秒 PCM 被 413 拒绝、模型名与 thinking 断言）。
- 部署示例（`calcal_nginx_example.conf` / README）的 `client_max_body_size` 从 4m 提到
  8m、代理读写超时提到 60s：60 秒 PCM 的 base64 约 2.5 MB，默认 1m/30s 会先被 nginx
  413 或 504。

### 21.3 小程序

- 新增 `utils/voice.js`：包装 `wx.getRecorderManager()`，录音参数为
  `format: 'PCM'`、16000 Hz、单声道、16 位、最长 60 秒；`start()` 先查
  `scope.record`（未决定时 `wx.authorize`，拒绝时抛 `code:'permission'`），
  `onStop` 里用 `wx.getFileSystemManager().readFile({encoding:'base64'})` 读出音频；
  `stop()` 支持“还没 onStart 就松手”（记下 stopRequested，启动后立刻停），
  `cancel()`/来电中断走 `onCancel`，`dispose()` 解绑全局 RecorderManager 回调，
  避免 tab 页复用时回调叠加。
- 「添加」页在设备卡片和添加日程卡片之间增加「语音日程」：
  文字输入框（可改识别结果，上限 500 字）、按住说话按钮（红色脉冲 + 秒数）、
  「解析日程」。松开后自动 `POST /api/ai/transcribe` 并回填；确认后
  `POST /api/ai/schedule`，把返回的日期/时间/标题/备注写入添加表单（同时更新字节
  计数），但**不保存**；用户核对/修改后点「保存日程」才调用 `saveForm()` 保存并同步
  设备——手动保存和语音来源的保存共用一条路径，避免两套校验。
- `stopVoiceTimer()` 在停止/取消/离开页面时清理；`onHide`/`onUnload` 会取消录音，
  `onUnload` 还会 dispose。权限被拒绝时弹「去设置」，调用 `wx.openSetting()`。
- 失败处理：识别为空/失败保留原文并显示错误；解析失败不改输入框文字；云端保存失败
  保留文字，提示「日程没有保存成功」，表单仍保留 AI 解析结果可手动重试。
- 测试新增 `voice.test.js`（9 个：参数、权限、松手早于 onStart、过短、取消、来电中断、
  读取失败、dispose）和 `voice-page.mock.test.js`（12 个：回填、确认保存、空文本、
  解析失败、保存失败、权限弹窗、字数截断、取消、离开页面、授权弹窗未关就松手、
  语音处理期间禁止手动保存）；小程序共 80 个用例通过。

### 21.4 仍需真机验证

- 微信 `format:'PCM'` 在 iOS/Android 真机上的实际文件头与时长字段（模拟器没有
  BLE/录音真机行为）；若文件意外带 WAV 头，服务端已按内容识别并直传；
- 首次授权、拒绝后「去设置」恢复、录音中来电中断的交互；
- 60 秒自动停止与 ASR 转写耗时；DeepSeek 账号的 ASR 并发/限速与计费。

### 21.5 模型名修正（2026-11-18）

- DeepSeek 官网当前 Chat Completions 的合法 `model` 只有 `deepseek-flash` 和
  `deepseek-v4-pro`；实现里最初写的 `deepseek-chat` 是旧名，已全部改成
  `deepseek-flash`（服务端默认值、`.env`、`.env.example`、`calcal_example.env`、文档）。
- `deepseek-flash` 支持 JSON Output、价格更低，适合“一句话 → 日程 JSON”的短抽取；
  `deepseek-v4-pro` 更强但更贵，需要时可改 `DEEPSEEK_MODEL`。
- 请求里显式加 `thinking: { "type": "disabled" }`：官网说明不传时默认开启思考模式，
  这个任务不需要推理，开着会消耗 reasoning token；在 `max_tokens: 500` 下还可能只
  返回空 `content`，导致 JSON 解析失败。
- 测试断言请求体 `model=deepseek-flash`、`thinking.type=disabled`，并覆盖
  `DEEPSEEK_MODEL` 留空时的回退；服务端共 31 个用例通过。

### 21.6 语音日程改为二次确认（2026-11-18）

- 上一版按钮（当时叫「确认并设置」）在解析成功后直接调用 `saveForm()`，AI 填的日期/时间没有机会让
  用户核对。现在「解析日程」只把解析结果填入下方「添加日程」表单，置
  `voiceFilled=true`，测量整张表单并滚动到完整可见，显示「已按语音填入，核对后点保存」提示；真正写云端
  和设备只发生在用户点「保存日程」时。
- 保存成功后才清空语音原文、`voiceFilled`，并把状态改成「已保存，可以继续说下一条」；
  保存失败保留表单和语音原文，状态提示「保存失败，请检查后重试」，用户可以在表单里改
  日期/时间/标题/备注后重试。
- 添加表单的标题右边在 `voiceFilled` 时显示「请确认后保存」；提示条
  `.voice-filled` 使用浅蓝底，和「未连接设备」的绿色提示区分。
- 测试调整/新增：确认后不落库、点「保存日程」后才落库并清空语音状态、用户在表单内改
  标题/时间后按改后的值保存、保存失败保留表单；`voice-page.mock` 16 个用例，小程序
  共 84 个用例通过。
- 按钮文案「确认并设置」改为「解析日程」；行宽改为「按住说话」70% / 「解析日程」
  30%。两者都作为 `view` 参与 flex：`.voice-hold { flex: 7 1 0 }`，解析按钮外套
  `.voice-parse-slot { flex: 3 1 0 }`，按钮 `width: 100%` 填满槽位。这样原生
  `button` 的固有宽度不再参与行宽分配；扣除 16rpx 间距后正好 70%/30%。
  （此前的 1:1 方案用 `.voice-actions > .voice-confirm`，WXSS 子选择器跨到原生
  `button` 不保证生效，按钮保持固有宽度，实测比按住说话宽。）
- 解析成功后不再只是 `selector` 对齐卡片顶部，而是查 `#add-card` 的
  `boundingClientRect` + `scrollOffset`，复用 `cal.revealScrollTop()`：整卡能放下时
  滚到卡片底部也进入视口，已经完整可见时不滚动，超过一屏时对齐顶部。测试覆盖
  “完整可见不滚动 / 卡片超过一屏 / 底部在视口外”。

### 21.7 语音标点与长停顿

- 识别文本里的标点来自 DeepSeek ASR 的自动标点（punctuation restoration），不是服务端或
  小程序加的；ASR 接口没有标点/断句参数，长静音通常会被模型判成句号，属于按声学停顿
  分段的结果。
- 服务端只做 `trim()` 和 2000 字截断，小程序只做 `trim()` / 500 字截断，识别文本原样
  回填输入框，用户可自行修改。
- 解析提示词补充：ASR 的句号/问号不一定代表多件事；整段话在描述同一件事时，把后续内容
  并入 `title/note`；只有明确“另外/还有/第二件事”才只取第一件；标题末尾不加句号。
  这样长停顿产生的句号不会让后半段被当成第二件事丢掉。
- 如果希望连输入框里的句号也去掉或换成逗号，需要在 `transcribeVoice()` 回填前做后处理；
  当前保留 ASR 原文，便于用户判断和编辑。

### 21.8 日程解析提示词深度优化

- 提示词按「日期锚点 / 日期规则 / 时间规则 / 标题备注 / ASR 与多件事 / 输出约束」分组，
  并在当前时间之外给出今天、明天、后天的绝对日期，减少模型做相对日期算术时的偏差。
- 新增/细化的默认规则：
  - 没提日期默认今天；只说日期没说时间时取目标日 09:00，09:00 已过才取下一个 15 分钟；
  - 1–6 点默认下午、7–11 点默认上午、12 点默认中午；明确说凌晨/早上/上午/中午/下午/
    傍晚/晚上时以修饰词为准；
  - 支持时间范围、时长、半小时后、跨天 24:00；本周/下周/周末/月底/下个月 X 号的换算，
    已过去且没明确说“今天”时顺延；
  - title 最多 30 个汉字，去掉“提醒我/帮我安排”等口头词、日期时间和末尾标点；note 只写
    用户提到的地点/人物/准备事项/链接/电话，不编造缺失信息；
  - ASR 句号/问号可能只是停顿，同一件事的后续内容并入 note；后一句有独立时间/日期或
    明确“另外/还有/第二件事/然后”时视为两件独立事项，只取第一件，第二件用“另有：…”
    简短保留在 note；每天/每周/每月只取最近一次，周期原话写进 note；
  - 信息不足用默认值、不反问；内容不像完整日程也生成一条，避免空标题。
- 服务端新增 `cleanTitle()` 兜底：即使模型忽略规则，也会去掉标题末尾的 `。！？!?；;，,、`。
- 测试补充提示词锚点/ASR/单事件断言和标题末尾标点清理；服务端共 31 个用例通过。

## 22. 2026-11-19：BLE 协议 3，应用层认证与加密

### 22.1 为什么不用 BLE SMP

小程序没有主动发起配对/绑定的 API，配对框和密码输入由系统接管；Android/微信版本之间的
表现不一致，iOS 也完全由系统决定。把认证交给 SMP 会让主客户端不可控。协议 3 因此在
现有 JSON 行协议上做应用层认证：不依赖系统配对，iOS/Android/网页行为一致，也能写 Node
单测。

### 22.2 配对

- 设备在**未连接手机**时长按确认键 3 秒进入 3 分钟配对窗口，墨水屏显示一次性 12 位
  Crockford base32 码（`XXXX-XXXX-XXXX`，60 bit）。长按 8 秒先清除旧密钥再进入配对。
- 配对码只用于 HKDF：
  `K_pair = HKDF(code, salt=pid, "mochen-calcal-pair-v1")`，
  `K_long = HKDF(code, salt=pid, "mochen-calcal-key-v1")`；`pid` 是公开的 BLE MAC
  （12 位大写 hex，用于握手和小程序本地密钥索引）；`did` 是另一个随机 128-bit 设备身份，
  只存在 NVS、只在认证后的 full hello 下发，用于服务端账号归属。配对成功后设备只保存
  `K_long`，配对码作废。
- 设备只保存一个密钥槽：重新配对会替换旧手机；长按确认键 8 秒或擦除 NVS 才能清掉。
- 配对码**不经过 BLE**；手机把它输入小程序/网页，用 HMAC 证明持有它。

### 22.3 握手和帧

- 订阅通知后设备先发 minimal hello（`pid`、`paired`、`pairing`、`nonce`、`auth:true`），
  不含日程数量和时钟；认证成功后客户端再发 `hello` 取完整信息。
- 客户端 `auth`：`nonce_a` + `proof = HMAC(K_auth, "mochen-calcal-client-v1|pid|nonce_d|nonce_a|mode")`；
  设备用 `"mochen-calcal-device-v1|pid|nonce_a|nonce_d|mode"` 回证。`mode` 为 `pair`/`auth`。
- 会话四把钥匙用 HKDF（salt=`nonce_d||nonce_a`，IKM=`K_long`，info 分别
  `enc-c2d`/`mac-c2d`/`enc-d2c`/`mac-d2c`）。
- 认证后的每行都是 `{"s","iv","d","m"}`：AES-256-CBC + PKCS#7，`m` 覆盖
  `"mochen-calcal-frame-v1|dir|seq|iv_hex|ct_hex"`；`seq` 每方向从 1 递增，接收端拒绝
  重复/回退。明文命令在认证后返回 `encrypted frame required`。

### 22.4 固件实现上的坑

- **ESP-IDF 6.1 的 mbedTLS 是 4.x**：`mbedtls/aes.h`、`mbedtls/md.h`、`mbedtls/base64.h`
  已经不存在，必须用 PSA Crypto（`psa_crypto_init`、`psa_mac_compute`、
  `psa_key_derivation_*` HKDF、`psa_cipher_*` CBC-PKCS7），base64 自己实现。
- PSA HMAC 需要 `PSA_KEY_TYPE_HMAC` + `PSA_KEY_USAGE_SIGN_MESSAGE`；HKDF 的 secret 是
  `PSA_KEY_TYPE_DERIVE` + `PSA_KEY_USAGE_DERIVE`，输入顺序 salt → secret → info。
- 认证后的通知/响应统一在 `notify_json()` 里加密；`auth` 响应和 pre-auth hello 走
  `notify_json_plain()`。`send_event()` 的内层 JSON 仍是 768 B，外层缓冲区扩到 1536 B；
  入站行缓冲 1024 B、BLE 任务栈 6 KB，因此密文/明文缓冲都做成静态区，避免栈峰值。
- `ble_auth.c` 的配对状态（code/pairing/deadline/success latch）由 UI 任务和 BLE 任务
  共享，用 FreeRTOS mutex 保护；密钥写入只在未连接时发生（`ble_calendar_start_pairing`
  拒绝已连接状态），避免和认证并发。
- 配对成功用 `pairing_ok` latch 给 UI 轮询，避免“BLE 任务清掉 pairing 后、UI 先看到
  超时”的竞态。

### 22.5 三端同步

- `miniprogram/utils/ble-auth.js` 和 `web/ble-auth.js` 是同一份字节（`test/ble-auth.test.js`
  检查）；加密库用 crypto-js（SHA-256/HMAC/AES-CBC，MIT，随附 LICENSE）。
- 小程序没有 WebCrypto，随机数用 `wx.getRandomValues`；网页用 `crypto.getRandomValues`。
- 小程序在 `connect()` 里 pre-hello → auth → 加密 `hello` → `time`；配对码用页面内的
  `pairingVisible` 浮层输入（`pages/index/index.wxml` 末尾）。不用
  `wx.showModal({editable:true})`：`content` 在部分微信版本会变成输入框的初始值，提示
  文字必须手动删掉；浮层把提示放进 `placeholder`、重试错误单独一行，输入框永远从空开始。
  网页用 `window.prompt`，密钥存 `localStorage['calcal.auth.<pid>']`；小程序存
  `calcal.bleAuthKeys`（按 `pid` 索引）。
- 网页从单文件变成 `index.html` + `ble-auth.js` + `vendor/`，托管时要整套 `web/` 一起上传。

### 22.6 已知取舍

- 60 bit 配对码 + 3 分钟窗口：抓到配对握手可以离线爆破；个人桌面设备可接受，后续可换
  二维码/128 bit 而不改帧格式。
- 设备密钥明文存 NVS；手机端在系统沙箱/localStorage。需要防拆机时再开 NVS/flash 加密。
- 没有多手机密钥槽；重新配对替换旧手机。云端“设备归属”见第 23 节；BLE 认证只保护链路，
  归属由服务端 + 官方小程序执行。
- `INFO` 特征保持公开（固件版本/日程条数/时钟有效性）；它不提供日程内容。

### 22.7 验证

- `idf.py build` 通过；`PROTO_VERSION` 2 → 3，`version.txt` 1.1.1 → 1.2.0。
- `node --test test/*.test.js`：新增 HKDF/HMAC 对 Node 的向量、AES 帧往返/篡改/重放、
  双端握手、两份 auth 文件一致性，以及 fake BLE 设备上的完整“配对→加密命令→断线重连”。
- `tools/preview_calendar.py` 新增 `preview_pairing.png`（`tools/` 下，gitignore）：按 C
  的布局渲染配对码三行/提示/页脚，检查过 480x800 不重叠。
- 真机仍需验证：首次配对码显示、错误码重试、断线重连、换手机/8 秒清绑定、深睡后重新
  配对、iOS/Android 微信的键盘弹窗。**没有上板验证前不要把“已验证”写死。**

## 23. 2026-11-19：设备归属绑定到微信账号

### 23.1 为什么拆成 pid 和 did

BLE 认证需要在小程序拿到密钥前就有一个稳定 ID 来查本地密钥，这个 ID 只能是 pre-auth
hello 里的 `pid`。如果直接用 `pid`（BLE MAC）做云端归属，任何在射频范围内扫到 MAC 的
人都能调 claim 接口抢绑。于是把身份拆成两层：

- `pid`：BLE MAC（12 位大写 hex，公开），用于 HKDF salt、HMAC 证明输入和小程序本地
  密钥索引；pre-auth hello 只带它。
- `did`：首次启动生成的随机 128-bit 设备身份，存 NVS 的 auth namespace；只在认证后的
  full hello 中下发，是服务端 `devices` 表的唯一键。它不参与任何密码学计算。

这样未认证的 BLE central 看不到 `did`，不能远程抢绑；能完成配对的人本来就有物理访问
和密钥。

### 23.2 服务端

- `devices.json`（schema v1，随 dataDir 一起备份）：
  `byDid[did] = { did, pid, userId, name, boundAt, lastSeenAt }`；不存 BLE 密钥。
- `GET /api/devices`：当前账号的设备列表。
- `POST /api/devices/claim {did,pid,name}`：未绑定则绑定；同账号幂等更新名称/lastSeen；
  其他账号返回 409。
- `POST /api/devices/:did/unbind`：仅绑定账号可解绑。
- 设备 DID 校验 12–32 位 hex（兼容旧 MAC 长度），pid 12 位 hex；数据文件权限 0600。

### 23.3 小程序

- `ble-auth.js` 的 `did` 参数已改名为 `pid`；小程序按 `pid` 存 `K_long`。
- `connect()` 成功后先调 `api.claimDevice(hello.did, hello.name, hello.pid)`，成功才
  `syncDevice()`；409 时弹“设备已绑定其他账号”并断开，不导入/推送云端数据。
- 「我的」页新增「我的设备」：列出 `did` 后缀、名称、绑定日期；解绑调
  `/api/devices/:did/unbind`，同时按服务端返回的 `pid` 删掉本地密钥并断开，避免下次
  自动认证后又 claim 回来。

### 23.4 边界

- 设备没有网络，不能自己验证微信账号；归属是**官方小程序 + 服务端**的约束。另一个
  账号物理重新配对后仍能用 BLE 本地读写设备，只是不能同步自己的云端日程。
- 解绑只删云端归属，不清设备 NVS 里的 `K_long`；彻底收回要长按确认键 8 秒或恢复出厂。
- 恢复出厂（擦 NVS）会生成新的 `did`，设备在服务端变成一台“新设备”；旧绑定记录需要
  原账号删掉（或自建服务里清理）。这是无 PKI 情况下可接受的转移方式。
- 网页端不登录，不参与账号归属；它仍是一个带本地密钥的 Web Bluetooth 工具。
- 服务端目前不在事件 API 上强制 `did`（事件仍按 user 存）；归属校验发生在小程序
  claim 这一步。要防改包客户端，需要把设备签名/设备身份引入事件同步，属于下一层。

## 24. 2026-11-19：多设备（一个账号多台设备）—— 暂缓

**决定：暂不做，先记录。** 账号层面已经能绑多台，但同步模型是按一台设备写的：两台
交替连接会删错或丢日程。以后要支持，按 24.4 的方向改。

### 24.1 现状：能绑，不能交替用

- 服务端按 `did` 存设备、按 `userId` 查，`listDevices()` 不限数量；`claim` 只在设备
  已属别的账号时返回 409（`server/src/store.js`）。
- 小程序「我的设备」本来就是列表，每台可单独解绑；BLE 密钥按 `pid` 分开存在
  `calcal.bleAuthKeys`，连 A 再连 B 不会互相覆盖。
- 同时只能连一台：`ble.connect()` 会先断开上一台。
- 设备侧“一台设备只能被一部手机配对”是单密钥槽决定的，与多设备无关。

### 24.2 根因

云端每条日程只有**一个** `deviceId`（`server/src/store.js` 的 `openEventPayload` /
`createEvent`），而这个值是**设备本地编号**，固件从 1 开始递增
（`components/calendar/src/calendar.c` 的 `s_next_id`）。两台设备的编号必然重叠，于是：

1. 同步第 5 步只推 `deviceId == null` 的日程，映射指向 A 的日程永远不会下发到 B；
2. 第 6 步把“不在这台设备上”一律当成“在这台设备上被删了”；
3. 第 1 步直接拿墓碑里的编号去 `ble.del()`，不区分这个编号属于哪台设备。

### 24.3 三个具体后果（A/B 两台、云端 3 条日程）

1. **绑第二台（空设备）**：第 5 步不下发；第 6 步因 `deviceEvents` 为空判定“设备被
   重置”，弹「设备上没有任何日程…要同时从云端删除吗？」，主按钮是「删除云端」。
   误点一次云端日历就清空（点「恢复设备」才会把日程推到 B）。
2. **改完标题再切设备**：新标题只写到了 A；B 上还是旧标题 → 内容匹配失败 → 第 4 步
   把 B 的旧标题当新日程导入云端，第 6 步把云端改过的日程静默删除（缺失 < 3 条不弹
   确认）。结果是改动丢失、旧版本以新 id 回来。
3. **离线删一条再连另一台**：墓碑记的是 B 的编号 N，而 A 的编号 N 往往是另一条日程 →
   `ble.del(N)` 删错，随后墓碑被 purge；第 6 步再把 A 上那条的云端记录静默删掉。原本
   要删的那条还留在 B 上，下次连 B 会被当成新日程导回云端。

编号碰巧对齐、内容又完全一致时，第 2 步会按内容认领/重映射，表现正常——所以随手试
几下不容易发现，问题只在内容分歧（改标题、离线删除、设备重置、增删顺序不同）时出现。

### 24.4 要做时

- `deviceId` 改成按 `did` 的映射（事件里存 `deviceIds: { did: id }`，或单独一张映射
  表），`mapDevice` 带上 `did`；
- 墓碑也按 `did` 存，删除只作用于对应设备；
- `syncDevice()` 的第 1/5/6 步按当前 `did` 读写自己的映射；
- 旧数据迁移：现有 `deviceId` 归到该账号最近一次同步的设备；
- 补 `miniprogram/test/sync.mock.test.js` 的双设备用例（上面三个场景各一条）；
- 估计 3–5 人日 + 两台真机回归。

改之前 `syncDevice()` 顶部有注释指向本节，不要误以为它已经支持多设备。

## 25. 2026-11-19：按键表述统一为中文

**决定：设备屏幕、小程序、网页和中文文档一律用中文键名**；代码标识符
（`BOARD_BTN_*`、`POWER_CLICK_MIN_US` 等）和串口日志保持英文，英文文档
（`docs/`、`web/README.md`、README 的英文段）不改，只在 README 控件表旁给映射。

| 代码/日志 | 中文名 | 位置 |
|:---|:---|:---|
| `BACK` | 返回键 | 前面板 |
| `CONFIRM` | 确认键 | 前面板 |
| `LEFT` / `RIGHT` | 左右键 | 前面板 |
| `UP` / `DOWN` | 上下键 | 侧键 |
| `POWER` | 电源键 | 侧键，深睡唤醒源 |

屏幕上的改动：

- 锁屏页脚：`按 POWER 唤醒` → `按电源键唤醒`。原来的 `draw_power_hint()` 是为 5x7
  `POWER` 的尾部空隙做光学补偿（见 16.15），改中文后整行居中即可，补偿逻辑删除。
- 配对页：`长按 CONFIRM 8 秒可清除绑定` → `长按确认键 8 秒可清除绑定`；
  页脚 `BACK 取消` → `返回取消`。
- 月历/日视图/详情页的 `返回:…`、`左右:…`、`确认:…` 本来就是中文，不动。

手机端：小程序设备提示、配对/解绑错误文案和网页提示全部改成「电源键 / 确认键」；
`tools/preview_calendar.py` 同步新文案并重新生成预览。

字体：电/源/键/确/认都在 GB2312 表内，`font_gb2312_24.bin` 不需要重新生成；
`tools/check_font_coverage.py` 只剩 littlefs 注释里既有的 `—` 那条误报。

验证：`idf.py build` 通过（2026-11-19，镜像 0x167eb0，分区余 53%）；
`tools/preview_calendar.py` 重新生成 `preview_pairing.png` / `preview_sleep.png` 并人工检查。
