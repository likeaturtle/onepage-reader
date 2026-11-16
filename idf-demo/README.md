# 墨程CalCal — OnePage C61 BLE 日历

**墨程CalCal** is an ESP-IDF **6.1** calendar for the OnePage C61 e-reader. The
phone talks to the device over BLE from a plain web page (Web Bluetooth) or the
native WeChat mini program, schedules are stored on a LittleFS partition, and the e-ink panel
shows a month grid, a day agenda, event details and a branded lock screen with
the next appointments. When idle the device parks the panel and enters deep
sleep, so it can run for a long time on a battery.

> **Status: build-verified (2026-11-16), hardware smoke-tested (2026-11-09).**
> The firmware compiles/links with ESP-IDF 6.1; on the real board the portrait
> panel, keys, single-calendar migration, BLE add from the web page and
> automatic redraw were verified. The automatic-light-sleep regression is fixed
> by disabling light sleep (see [Known board issue](#known-board-issue)). The
> branded splash/lock/top-bar layout is verified in the offline previews but
> still needs a panel pass; deep-sleep current and the remaining checklist items
> also need a full pass — see [Hardware checklist](#hardware-checklist).

---

## What it does

| Requirement | Implementation |
|:---|:---|
| 1. Phone connects over BLE and sends schedules from a web page | NimBLE GATT server + `web/index.html` (Web Bluetooth). One JSON object per line, chunked to 20-byte writes. |
| 2. Events are filed into the calendar | **One calendar only.** The storage schema keeps a compatibility index 0; old multi-calendar databases are collapsed into it on first boot. |
| 3. Arrow keys navigate the day/week; view day details | LEFT/RIGHT changes day, UP/DOWN changes week, CONFIRM opens the day agenda, then the event detail. |
| 4. Select and delete an event with the keys | UP/DOWN selects an event in the day agenda; CONFIRM opens it; CONFIRM again arms delete; a second CONFIRM deletes it. BACK cancels. |
| 5. Lock screen shows the next appointments | POWER (click or 2 s hold), idle timeout or the web page's "让设备锁屏" draws the next 5 events, parks the panel and enters deep sleep. |
| 6. Low power | Deep sleep as the default idle state, DFS while awake, 300 ms advertising, e-ink repainted only on change, SD card left unmounted. Automatic light sleep is disabled because it breaks keys/USB on this board. |

The UI is composed on a **480x800 portrait canvas** and rotated onto the
800x480 panel by `gfx.c` (`ONEPAGE_UI_ROTATION`). If a unit shows the image
upside down, change that constant from 270 to 90 and rebuild.

The current application replaces the original self-test demo. That demo's
hardware notes (panel timing, key ADC windows, the GPIO27/SD constraint, the
eFuse wrapper) are preserved in [`docs/bringup-demo.md`](docs/bringup-demo.md).

---

## Controls

| Key | Month view | Day view | Event detail | Delete confirmation |
|:---|:---|:---|:---|:---|
| **LEFT / RIGHT** | previous / next day | previous / next day | — | — |
| **UP / DOWN** | previous / next week | previous / next event | — | — |
| **CONFIRM** | open the day agenda | open the selected event | arm deletion | delete the event |
| **BACK** | jump to today | back to month | back to the day agenda | cancel |
| **POWER** | lock / deep sleep | lock / deep sleep | lock / deep sleep | lock / deep sleep |

Event detail uses a two-step delete: the first CONFIRM only shows the
confirmation box, so a single accidental click cannot remove an event.

On the panel: the top bar carries the brand lockup (logo + `墨程CalCal`) on
the left; battery, clock and the BLE icon form a right-aligned cluster, with
the BLE icon at the far right and 14 px between the three. The lock screen
repeats the large logo, the product name and the `墨水屏日程表` subtitle
above the next five events; with nothing upcoming it shows the mini program
code instead, centered above the two hint lines. The BLE state is icon-only:
outline while advertising, white-on-black on a rounded badge while connected,
and a 50% dither (fake gray) when the radio failed.
Every screen uses one 30 px margin on the 480 px canvas (420 px of content).
The content uses one 24 px body size; the top bar logo and wordmark are both
21 px tall to match the 5x7 scale-3 battery/clock ink, inside a taller 64 px
band, and the footer
band is shorter so the content area keeps its previous height. All glyphs sit
on one ink baseline: 5x7 Latin/digit ink is shifted one scaled row down to
match the 24 px CJK cell. The portrait month
grid has 5 or 6 week rows and seven columns and keeps a constant 420 px height.
A black cell is the selected day, a double outline is today, and up to four dots
show that day's events. The Saturday and Sunday columns carry a light 1/16
Bayer dither; the grid lines, selected cell, date numbers and event dots are
painted on top, so the dots stay solid. A card docked below the grid shows the
selected date, the day's event count and up to three entries (time + title), or
"这天没有日程"; it never covers dates, and CONFIRM still opens the full day
agenda. The single footer line maps the front keys: BACK on the left,
LEFT/RIGHT in the middle and CONFIRM on the right. There is no
calendar-category row or selector anymore.

---

## Brand and naming

| Surface | Canonical value |
|:---|:---|
| Product / display name | `墨程CalCal` |
| Short name | `CalCal` |
| BLE advertising + GAP name (ASCII) | `Mochen CalCal` |
| BLE `hello` / INFO `name` | `墨程CalCal` |
| Logo source | `miniprogram/CalCal_logo.png` |
| Firmware logo/wordmark bitmaps | `components/brand/src/brand_logo.c` (generated) |
| Web logo copy | `web/CalCal_logo.png` |

Use **`墨程CalCal`** (no space between 墨程 and CalCal) in every user-facing
page (firmware, mini program, web page, server docs). Do not use `墨程 CalCal`
(with a space), `OnePage 日历` or `蓝牙日历` as a product name. `Mochen CalCal`
is only the ASCII radio alias kept for central stacks that do not handle a
UTF-8 GAP name and for the mini program scan prefix; after connection every
client shows `墨程CalCal`.

The e-ink panel shows the brand in three places:

1. **Cold-boot splash** — large logo, `墨程CalCal`, tagline and platform line,
   held for 1.2 s before the first calendar frame (deep-sleep wake skips it).
2. **Lock screen** — 96 px logo, product name, tagline and the next events;
   this is the image left on the glass while the device is parked.
3. **Top bar** — 30 px logo + 22 px wordmark (both 21 px of ink) on the left;
   the battery → clock
   → BLE cluster is right-aligned (BLE farthest right) with 14 px gaps; the
   status text keeps the original scale 3 (21 px ink).

The logo is a transparent PNG. `tools/gen_brand_assets.py` composites it on
white, crops the transparent border, renders 200/96/30 px widths and thresholds
them to 1-bit. It also renders the 20 px top-bar wordmark from
`BRAND_NAME_ZH` + `BRAND_NAME_EN` with Noto Sans CJK SC, so the compact lockup
keeps a clean baseline. Regenerate after replacing the logo or the name:

```bash
/Users/fujd/.espressif/tools/python/v6.1/venv/bin/python tools/gen_brand_assets.py
```

The CMake project is named `mocheng_calcal`, so the built application image is
`build/mocheng_calcal.bin`.

---

## Quick start

### Build and flash

```bash
cd idf-demo
idf.py set-target esp32c61      # once per checkout / after deleting sdkconfig
idf.py build

# first flash and after any partition change: full write
idf.py -p /dev/cu.usbmodemXXXX flash -a

# stock firmware still has a valid OTA selection in otadata; erase it once
esptool --chip esp32c61 -p /dev/cu.usbmodemXXXX erase-region 0xe000 0x2000

idf.py -p /dev/cu.usbmodemXXXX monitor
```

The first 64 KB and the nvs/otadata/factory offsets still match the stock
firmware, so flashing back the stock image works (see
[`docs/bringup-demo.md`](docs/bringup-demo.md) for the full
flash/rollback/Puya-flash notes). The factory slot is 3 MB and the app image is
about 1.38 MB of it; the rest of the flash is the `storage` LittleFS partition.

**After this partition change, flash the whole layout once** (`idf.py flash -a`):
updating only the app leaves the old table in place and `calendar_init()` will
fail to find the `storage` partition.

### Open the phone page

`web/index.html` is a single static file with no build step and no CDN
dependencies. Web Bluetooth requires a **secure context**:

```bash
cd idf-demo/web
python3 -m http.server 8000
# open http://localhost:8000 on this computer
```

For a phone, host the file on any HTTPS static site (GitHub Pages, Netlify,
your own server) and open that URL in **Android Chrome/Edge**. iOS Safari does
not implement Web Bluetooth; use a browser that does (for example Bluefy).
Then:

1. Wake the device with POWER.
2. Tap **连接蓝牙设备** and pick **Mochen CalCal** (the ASCII advertisement;
the page shows `墨程CalCal` after connecting).
3. Pick a date, start/end time and title, then **发送到设备**.
4. The page syncs the clock automatically and lists the selected month.
5. **让设备锁屏** draws the lock screen and puts the board into deep sleep;
   press POWER on the device to wake it.

See [`web/README.md`](web/README.md) for the page details and
[`docs/ble-protocol.md`](docs/ble-protocol.md) for the wire protocol.

### 微信小程序客户端

`miniprogram/` 是名为 **墨程CalCal** 的原生小程序客户端，复用同一套 BLE 协议，Android 和 iOS 都能用
（iOS 不依赖 Web Bluetooth）。它额外带微信登录和**云端日程**：`wx.login` 的 code
交给 `server/` 换取 openid，服务端签发 token，昵称、头像和日程都存在服务端。
没带设备时也能在手机上查看/添加/删除日程；连接设备后，云端与设备双向补齐：
设备有、云端没有的导入云端；云端有、设备没有的推到设备；**设备端删除的日程也会删除
云端记录**。设备为空（可能是重置）或一次消失多条时会先弹窗确认，避免误删云端数据。

```bash
cd idf-demo/server
cp .env.example .env
npm start                     # 登录 + 云端日程服务，默认 :8787

# 另开微信开发者工具，导入 idf-demo/miniprogram
```

本地调试用「开发模式登录」（`ALLOW_DEV_LOGIN=1`），不需要先申请 AppID。导入项目后
在开发者工具里勾选「不校验合法域名」，真机调试时把 `miniprogram/config.js` 的
`apiBase` 改成电脑的局域网地址。正式环境需要 HTTPS 域名、`WX_APPID`/`WX_SECRET`、
`DATA_KEY`/`INDEX_KEY`/`BACKUP_KEY` 和微信后台的 `request 合法域名` 配置。

完整配置步骤（导入开发者工具、AppID、`.env`、常见登录错误）见
[`微信小程序配置说明.md`](微信小程序配置说明.md)；其余细节见
[`miniprogram/README.md`](miniprogram/README.md) 和
[`server/README.md`](server/README.md)。

---

## BLE service

| Item | UUID |
|:---|:---|
| Service | `6f6e6570-6167-6531-6361-6c656e646172` |
| RX (write / write-no-response) | `6f6e6570-6167-6531-6361-000000000001` |
| TX (notify) | `6f6e6570-6167-6531-6361-000000000002` |
| INFO (read) | `6f6e6570-6167-6531-6361-000000000003` |

The device advertises the service UUID and puts the ASCII alias `Mochen CalCal`
in the scan response; the `hello`/INFO `name` field and every on-device label
use the canonical `墨程CalCal` (see [Brand and naming](#brand-and-naming)).
Messages are UTF-8 JSON objects separated by `\n`; both sides reassemble
chunks. The web page writes 20-byte chunks, so it works even when the phone
does not negotiate a larger ATT MTU. Notifications are chunked to
`min(MTU - 3, 180)`.

Core commands:

```json
{"cmd":"hello"}
{"cmd":"time","epoch":1762703820,"tz":480}
{"cmd":"list","from":"2026-11-01","to":"2026-11-30"}
{"cmd":"add","date":"2026-11-10","start":"09:00","end":"10:00","title":"项目评审","note":"会议室 A"}
{"cmd":"del","id":12}
{"cmd":"sleep"}
```

The device answers with one-line JSON (`{"ok":true,...}` / `{"ok":false,...}`)
and event lines (`{"ev":"ev",...}` followed by `{"ev":"done","n":N}`). Dates
are local civil dates (`YYYY-MM-DD`) and times are local `HH:MM`; `tz` is
minutes east of UTC. Full examples are in
[`docs/ble-protocol.md`](docs/ble-protocol.md).

---

## Storage, time and power

### Calendar storage

The whole database is one file, `/lfs/calendar.db`, on the `storage` LittleFS
partition (~12.9 MB, see `partitions.csv`). NVS (20 KB) only keeps the clock,
the timezone and the PHY/BT calibration data; the calendar no longer uses it.

- **No SD dependency** and no card current: the calendar works with no card
  inserted, and the SD card is never mounted by this application.
- The database is rewritten as a single file on each change (temp file +
  rename, so a power cut leaves either the old or the new database). Capacity
  is still 96 events with title 95 bytes and note 191 bytes of UTF-8; those are
  now protocol/UI limits rather than NVS limits, and the in-RAM buffer cap is
  `DB_MAX_BYTES` in `calendar.c`. Raising them only needs a matching buffer and
  the server/mini-program counters.
- If a change would not fit `DB_MAX_BYTES`, the oldest events that are already
  in the past are pruned first and the phone's `add` acknowledgement reports
  `"pruned":N`. Upcoming events are never silently dropped; the add fails with
  `calendar full` instead.
- The file has a magic/version header and a CRC32 over the payload, so a
  corrupt or future layout is moved aside (`calendar.db.bad`) and the firmware
  falls back to the default calendar instead of reinterpreting bytes.
- **Migration**: firmware before this change kept the database in the NVS
  namespace `calstore`. On the first boot after flashing this image the file is
  missing, the NVS blob is CRC-checked, written to `/lfs/calendar.db`, and the
  NVS copy is deleted. The log line is `migrated N events from NVS`.
- The clock (`epoch`, `tz`) stays in NVS. On a cold boot the last known time is
  restored; on deep-sleep wake the RTC time keeps running.

### Time

The C61 has no battery-backed RTC, but the 32.768 kHz crystal keeps the RTC
timer alive in deep sleep (ESP-IDF's default `gettimeofday` continues across
deep sleep). The web page sends the phone's epoch and timezone on every
connection, so the displayed date is correct as soon as the phone connects.
Events themselves are stored as local civil days + minutes, so changing the
timezone does not shift existing events.

### Low power

- **Deep sleep is the resting state.** The application locks after 3 minutes
  without a key or BLE connection (10 minutes while a phone stays connected),
  on a POWER click, on a 2 s POWER hold, or on the web page's `sleep` command.
  While USB power is present the idle timer is skipped (the battery is not at
  risk and this keeps the desk-calendar/serial-monitor use case alive); POWER
  and the web page still lock it explicitly.
  Before sleeping it stops BLE, draws the next-events screen with a half
  (fast full-frame) refresh, parks the panel (`epd_sleep()`), saves the clock
  and cuts the shared EPD/SD/mic rail. The e-ink image keeps showing the
  schedule while the chip is off.
- **While awake** the app uses DFS (160/40 MHz) and slows BLE advertising to
  ~300 ms; the connection interval is 30–50 ms for responsive form submits.
  **Automatic light sleep is disabled**: on this board the C61 SAR ADC (front
  keys / battery) and the USB-Serial/JTAG console do not survive it reliably,
  and keys/screen updates appeared dead after the first sleep. Deep sleep is
  the primary low-power state. See [Known board issue](#known-board-issue).
- **The panel is only repainted when something changed.** Interaction uses a
  differential refresh and a stronger `HALF` pass every 30 content refreshes.
  While awake the header clock also advances once a minute through the same
  differential path (only the digits change, and this tick does not count
  towards the 30). A cold boot paints the brand splash and then the first month
  frame with `FULL` (the two images share no content, so a faster pass could
  leave a logo ghost); a wake from deep sleep and the lock screen use `HALF`
  (both RAM planes, sped-up waveform), so the panel flashes once briefly
  instead of cycling black/white for ~2 s.
- **Peripheral power-down in light sleep is deliberately disabled**, and
  automatic light sleep itself is currently disabled at runtime. On the C61 the
  SAR ADC (front keys, battery) and USB-Serial/JTAG console are not light-sleep
  retention supported; enabling light sleep made keys and redraws stop
  responding after the device had been idle. `CONFIG_PM_POWER_DOWN_PERIPHERAL_IN_LIGHT_SLEEP`
  must stay off as well.
- No Wi-Fi is initialised, the microphone is not initialised, and the SD card
  is not mounted.

Long-term runtime is dominated by the deep-sleep current (the e-ink image holds
with the rail cut). The actual current figures still need to be measured on the
board; see the checklist below.

---

## Font

The UI uses a **24 px GB2312 bitmap font** covering all 7,445 GB2312 characters
(including punctuation), embedded as a 566 KB flash blob. This makes arbitrary
Chinese event titles render without a font engine or a card. The 5x7 table
handles ASCII, including lower case, so the brand keeps its `CalCal`
capitalisation. A generated 48 px subset remains in the component for larger
headlines. The top-bar wordmark is a 20 px 1-bit bitmap generated from the same
Noto font (see `components/brand/`), which avoids loading a second full CJK
table just for the header. `gfx_text()` shifts 5x7 ink down by one scaled row
so Latin, digits and CJK share one bottom baseline.

The bitmap was generated from **Noto Sans CJK SC** under the SIL Open Font
License 1.1; the license text and download instructions are in
[`tools/fonts/`](tools/fonts/).

Regenerate the tables with Pillow (the IDF virtualenv has it):

```bash
/Users/fujd/.espressif/tools/python/v6.1/venv/bin/python tools/gen_cjk_bitmaps.py
```

Preview the screens without flashing:

```bash
# Pillow is in the IDF virtualenv; system Python may not have it.
/Users/fujd/.espressif/tools/python/v6.1/venv/bin/python tools/preview_calendar.py
# -> tools/preview_month.png, preview_day.png, preview_detail.png,
#    preview_delete.png, preview_sleep.png, preview_boot.png

python3 tools/check_font_coverage.py   # UI chars in the font + UUIDs in sync
```

The preview tool reads the same `font5x7.c` and embedded font blob as the
firmware, so missing glyphs and layout overflow show up at review time.

---

## Layout

```text
idf-demo/
├── main/
│   ├── main.c              state machine, key scanner, sleep/lock policy
│   ├── calendar_ui.c       month / day / detail / boot / lock-screen drawing
│   └── calendar_ui.h
├── components/
│   ├── brand/              brand strings + generated 1-bit logo bitmaps
│   ├── calendar/           data model, LittleFS persistence, civil dates
│   ├── ble_calendar/       NimBLE GATT server + JSON protocol
│   ├── cjson/              vendored cJSON 1.7.19 (MIT)
│   ├── littlefs/           vendored LittleFS 1.23.0 (MIT), calendar storage
│   └── onepage_c61/        panel, keys, power, ADC, SD, mic, fonts, gfx
├── web/
│   ├── index.html          phone page (Web Bluetooth)
│   ├── CalCal_logo.png     logo copy used by the page
│   └── README.md
├── miniprogram/            native WeChat mini program (BLE + cloud schedule)
├── server/                 Node login + cloud schedule backend for the mini program
├── 微信小程序配置说明.md     DevTools import, AppID/.env, login troubleshooting
├── docs/
│   ├── ble-protocol.md     wire protocol reference
│   ├── bringup-demo.md     historical self-test/mic demo notes
│   └── ...
├── tools/
│   ├── gen_brand_assets.py generate the firmware logo bitmaps
│   ├── gen_cjk_bitmaps.py  generate the embedded CJK fonts
│   └── preview_calendar.py render the UI screens offline
├── sdkconfig.defaults      target, flash/PSRAM, USB console, BLE, PM
└── partitions.csv          stock-compatible head + LittleFS storage tail
```

---

## Hardware checklist

The following is what to verify on a real board. Compilation cannot cover these:

1. **BLE discovery and pairing-free connect** — the phone scan list shows
   `Mochen CalCal` (ASCII advertisement) and the connected `hello` reports
   `墨程CalCal`; Web Bluetooth can subscribe to TX and send `hello`/`add`.
2. **Chunking** — a title near the 15-character limit and a 30-character note
   arrive intact; `list` with ~30 events reassembles without missing lines.
3. **Time sync** — the header time matches the phone after connect; after a
   deep-sleep wake without a phone, the date is still sane.
4. **Keys after idle** — leave the device idle but awake for a few minutes,
   then press every key. The ADC ladder and the side keys must still register.
   This is the regression that forced automatic light sleep off; if it is ever
   re-enabled, test the front-key ADC and USB console first.
5. **Panel refresh/ghosting** — navigate 30+ times; the `HALF` pass every 30
   refreshes should keep ghosting acceptable.
6. **Deep sleep current** — measure with the panel parked and the rail cut.
   The expected dominant state is deep sleep. Also measure advertising-only
   current while advertising (light sleep is disabled on this board).
7. **Sleep screen** — POWER, idle timeout and the web page's sleep button all
   show the logo, `墨程CalCal`, the `墨水屏日程表` subtitle and the next 5
   events, and wake on POWER with the month view. With no upcoming events the
   list area shows the mini program code plus the two hints, vertically
   centered; check it scans with WeChat.
8. **Calendar storage** — on a board that still runs the old firmware, flash
   this image (`idf.py flash -a`) and confirm the log says `migrated N events
   from NVS`, then power-cycle twice and check the events are still there.
   Fill the calendar until pruning starts and confirm the newest / upcoming
   events survive and the phone sees `pruned` / `calendar full` as appropriate.
   Also pull the plug during a save: the next boot must still show a valid
   calendar (old or new, never corrupt).
9. **Brand rendering** — cold boot shows the logo splash, the top bar keeps the
   logo + `墨程CalCal` legible next to BLE/battery/clock, and the lock screen
   shows the logo/name/subtitle without clipping; `CalCal` keeps its
   capitalisation.

The validation status in this repository is **build + offline UI preview**.
Please treat the BLE and power numbers as unverified until the checklist is
done.

---

## Known board issue

The first version enabled automatic light sleep (`light_sleep_enable = true`).
On the real C61HR8 board, after the device had been idle for a while:

- pressing keys produced no visible change;
- a schedule sent from the web was acknowledged but the panel did not repaint;
- the USB-Serial/JTAG port could disappear entirely.

Diagnostic logs with light sleep disabled showed all keys working, BLE `add`
arriving, `on_change` firing and 460–480 ms differential redraws. The fix is
therefore to keep `light_sleep_enable = false` in `init_power_management()`.
Deep sleep still cuts the panel/SD rail and is the dominant long-term state.
The C61 light-sleep retention limitation is documented in the ESP-IDF
power-management docs for SARADC and USB-Serial/JTAG.

---

## Troubleshooting

| Symptom | Likely cause |
|:---|:---|
| Phone page says the browser does not support Web Bluetooth | page is not HTTPS/localhost, or the browser is not Chromium-based (iOS Safari); use the mini program on iOS instead |
| Device is not listed | device is in deep sleep (press POWER), or the page's service filter does not match; check the UUIDs in `ble_calendar.h` / `web/index.html` |
| Connect succeeds but no events | TX notifications not subscribed; the page must call `startNotifications()`; check the console log |
| `bad json` / `missing cmd` | a write was truncated or split without a newline; the page chunks at 20 bytes and appends `\n` once |
| Event says `calendar full` | 96 events / the database file is full and no past events are left to prune; delete some events |
| Header clock is `--:--` | never synced since power-on; connect the phone or check the time command |
| Header battery is `--%` | first sample after power-up is still settling; the app retries at 2/4/8/16/32 s and replaces it as soon as the pack voltage is plausible |
| Keys stop working after idling | automatic light sleep was re-enabled in `init_power_management()`; keep `light_sleep_enable = false` on this board (and keep `CONFIG_PM_POWER_DOWN_PERIPHERAL_IN_LIGHT_SLEEP=n`) |
| Boots the old stock firmware | `otadata` not erased (see the flash steps) |

---

## Licensing and attribution

New application code is MIT-compatible. Board-support panel/key register values
and the eFuse wrapper come from the vendor BSP (`open-onepage-sdk`, MIT) and the
original bring-up demo; the 5x7 font is the public-domain bitmap set; cJSON is
MIT (see `components/cjson/LICENSE`); the GB2312 bitmap font is generated from a
SIL OFL 1.1 font (see `tools/fonts/OFL.txt`) and is embedded as a bitmap asset.
Keep the attribution if you ship this.
