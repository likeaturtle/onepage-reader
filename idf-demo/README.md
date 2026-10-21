# OnePage C61 — ESP-IDF bring-up demo

A minimal **ESP-IDF** application that replaces the vendor Arduino/PlatformIO
firmware with enough board support to prove the hardware works end to end: the
SSD1677 e-paper panel, the front key ladder, the side keys, the microSD card,
the battery divider and USB detection, the PDM microphone, plus deep sleep with
wake on POWER.

It is deliberately independent of `firmware/` (the vendor submodule): the panel
and key sequences are re-implemented here on top of the ESP-IDF drivers, so this
directory is a clean starting point for your own application instead of a fork
of the reader firmware.

> **Status: verified on hardware (2026-10-14).** The self test passes on a real
> board — panel, all seven keys, SD card, battery/USB readout and deep sleep.
> The sources were ported off the vendor BSP (ESP-IDF 5.5.2, the version the
> vendor firmware is built on) and **build cleanly with ESP-IDF 6.1**:
> `idf.py build` completes the full compile + link, producing `bootloader.bin`,
> `partition-table.bin` and `onepage_c61_idf_demo.bin` from a clean tree.
> See [Verifying on hardware](#verifying-on-hardware) for the commands and what
> to look at.
>
> **Microphone (added 2026-10-20): build-verified, not yet hardware-validated.**
> Clicking CONFIRM now starts a PDM capture and shows a live level meter; see
> [Microphone level meter](#microphone-level-meter). The C61 has no PDM-to-PCM
> converter, so the conversion, dBFS reference and meter window are implemented
> in software and may need calibration on your board (the constants live in
> `onepage_mic.h`).
>
> **Version notes.** The sources compile on both IDF 5.5.x and 6.x. Two things
> are version-dependent: `gpio_deep_sleep_hold_en()` does not exist on the C61
> at all (the chip holds individual pads in deep sleep by itself,
> `SOC_GPIO_SUPPORT_HOLD_SINGLE_IO_IN_DSLP`), and IDF 6.0 folded
> `esp_deep_sleep_enable_gpio_wakeup()` into
> `esp_sleep_enable_gpio_wakeup_on_hp_periph_powerdown()`, so
> `board_power.c` picks the right one with `ESP_IDF_VERSION`.
>
> **The vendor's eFuse workaround is at bootloader level.** The vendor gets
> around this gate with `-Wl,--wrap=bootloader_common_check_efuse_blk_validity`,
> a flag that has to reach the *bootloader* link — the check runs during image
> validation, before the app exists, so applying it to the app (as an earlier
> revision of this demo did) changes nothing. It now lives in
> `bootloader_components/onepage_efuse_gate/`. If you later add OTA or
> `esp_image_verify()` to the app, compile that wrapper into the app as well and
> add the same flag to the app's link.

---

## What it exercises

| Area | On the panel | On the console |
|:---|:---|:---|
| Panel geometry & pixel mapping | checkerboard, 1 px lines, tone ramp | dimensions, PSRAM, SD result |
| Panel refresh modes | full refresh at boot, differential redraws on key events and the mic meter | mode per refresh |
| Front key ladder (ADC) | 7 labelled boxes, filled while held | raw counts + millivolts per key event |
| Side keys (BACK/UP/DOWN/POWER) | same boxes | `key NAME pressed/released` |
| microSD | `SD  N FILES  RW OK` | card info, first four entries, write/read/verify |
| PDM microphone | click CONFIRM: live level bar, dBFS and 13 s history | PDM configuration, final peak/average |
| Battery + USB | `BAT 4012MV 78%  USB 1` | divider reading |
| Deep sleep | `休眠中` box, image stays on screen | `entering deep sleep; press POWER to wake` |
| Reset/wake diagnostics | `RESET WAKE FROM SLEEP` in the header | reset reason, heap, PSRAM |

Controls: click **CONFIRM** to start a take (the panel switches to the
microphone meter; the click is recognised on release), then click it again to
stop. BACK returns from the result screen to the status screen, and a click on
CONFIRM starts another take from there. **POWER** sleeps the board — either a
single click or a 2 s hold (the hold acts immediately, without waiting for the
release). The panel is left showing a `休眠中` box and the image survives the
sleep; press POWER again to wake.

---

## Hardware reference

| Function | Pin | Notes |
|:---|:---|:---|
| EPD SCLK / MOSI / MISO | 22 / 23 / 24 | MISO is shared with the microSD |
| EPD CS / DC | 25 / 8 | |
| EPD RST | 27 | **also the shared EPD + SD + mic power enable** (high = on) |
| EPD BUSY | 29 | active high: high while the controller is working |
| microSD CS | 26 | same SPI bus as the panel, 20 MHz |
| Front keys | 4 | ADC ladder: BACK ~2592 mV, LEFT ~1956 mV, RIGHT ~1316 mV, CONFIRM ~0 mV, idle ~3100 mV |
| Side keys | 6 / 9 / 2 | UP / DOWN / POWER, active low, internal pull-ups |
| Battery | 5 | 1:1 divider, sampled with charging paused |
| Charger enable | 10 | drive low to pause charging (kept high otherwise) |
| USB detect | 11 | open-drain, low = USB present |
| PDM microphone | 7 / 3 | CLK / DIN, powered by the shared GPIO27 rail |

Panel: 800x480, SSD1677, 40 MHz SPI mode 0. Framebuffer is 48000 bytes,
100 bytes per row, MSB is the leftmost pixel, set bit = white.

Two board quirks are baked into the driver and are worth keeping if you start
your own project from this:

1. **One reset, before the SD mounts.** GPIO27 powers the rail *and* resets the
   panel, so the low pulse in `board_power_init()` has to happen before the card
   is mounted — a later pulse browns out an active mount and latches the card.
   The panel driver therefore never pulses reset itself.
2. **Console on USB-Serial/JTAG.** GPIO10/11 are the charger enable and USB
   detect, which are also the C61's default UART0 pins, so a UART console would
   fight them. `sdkconfig.defaults` forces the USB-Serial/JTAG console.

---

## Microphone level meter

Click **CONFIRM**: the capture starts and the panel switches to a meter
screen. Click **CONFIRM** again to stop; the result screen keeps the final
level, peak, average and the 13-second history. **BACK** returns to the status
screen, a click on **CONFIRM** starts another take, and **POWER** still sleeps
the board. The I2S channel is initialised on the first CONFIRM click, not at
boot, so a microphone problem cannot take down the panel/SD bring-up.

The microphone is a PDM part on GPIO7 (CLK) / GPIO3 (DIN). The ESP32-C61 I2S
block can only receive **raw PDM** — unlike the ESP32/S3 it has no PDM-to-PCM
converter — so `onepage_mic.c` does the conversion in software:

- one 16-bit I2S word = 16 PDM bits; `popcount` turns it into a density count;
- 8 words (128 bits) are summed into one 16 kHz PCM sample; the requested
  1.024 MHz PDM clock runs at about 2.048 MHz on the wire on this board and
  produces roughly 128 kwords/s;
- a one-pole 50 Hz high-pass removes the 50% DC of a silent PDM stream;
- 100 ms frames give RMS/peak in dBFS, a fast-attack/slow-release bar and one
  history entry every 200 ms.

The capture task reads one DMA buffer, then yields for one RTOS tick (10 ms at
the default 100 Hz tick). The PDM stream can arrive faster than the task can
consume it, and a high-priority task that never blocks would starve the idle
task and trip the task watchdog; the meter only needs a representative subset
of the stream, so dropping the rest is intentional and invisible at e-ink
update rates. `vTaskDelay(1)` is one tick — `pdMS_TO_TICKS(1)` would be zero at
100 Hz and would not yield at all.

The bar is **auto-ranged per take**. After a ~500 ms lead-in (`CALIBRATING NOISE
FLOOR - STAY QUIET`), the loudest of the lead-in frames is used as a
conservative room-noise estimate (a single DMA dropout cannot drag the floor
down):
0% is placed `ONEPAGE_MIC_NOISE_MARGIN_DB` above it and 100% is
`ONEPAGE_MIC_METER_RANGE_DB` higher (clamped at 0 dBFS, and never below the
fallback -20 dBFS top). A silent room therefore
reads ~0% instead of its absolute -33 dBFS showing up as 74%; speech moves the
bar from there. Before calibration (or for a take shorter than the lead-in) the
fallback window is -70..-20 dBFS. If the meter is too sensitive, increase the
noise margin; if it moves too little on speech, increase the range. The raw
absolute numbers (LEVEL/PEAK/AVG dBFS) are still shown below the bar.

`ONEPAGE_MIC_PDM_CLK_HZ` controls the PDM clock if your board revision clocks
the microphone differently.

The meter is **not a recorder**: audio is analysed live and nothing is written
to the SD card. Every meter refresh is a full-panel update, so the e-ink screen
updates at roughly 1-3 Hz (the screen says so); a `HALF` clean-up pass replaces
every eighth update to keep ghosting down.

---

## Layout

```text
idf-demo/
├── CMakeLists.txt                  project entry
├── bootloader_components/          code linked into the bootloader, not the app
│   └── onepage_efuse_gate/         vendor eFuse block revision workaround
├── partitions.csv                  same offsets as the stock firmware
├── sdkconfig.defaults              esp32c61, 16 MB flash, 2 MB PSRAM @40 MHz, USB console
├── components/onepage_c61/         board support, reusable on its own
│   ├── include/                    onepage_pins.h + public headers
│   └── src/
│       ├── board_power.c           rail, battery, USB detect, deep sleep
│       ├── board_buttons.c         ADC ladder + side keys
│       ├── epd_ssd1677.c           panel driver (init, RAM windows, refresh)
│       ├── gfx.c                   framebuffer drawing primitives
│       ├── font5x7.c               ASCII bitmap font
│       ├── font_cjk.c              休眠中 etc., generated from a system font
│       ├── sd_card.c               mount, listing, write/read/verify
│       ├── onepage_adc.c           shared ADC1 unit + calibration
│       └── onepage_mic.c           PDM RX, software PCM conversion, level stats
├── main/main.c                     the self test and the microphone meter
└── tools/
    ├── preview_screen.py           renders the main / sleep / mic / result screens
    └── gen_cjk_bitmaps.py          regenerates font_cjk.c (only when adding glyphs)
```

---

## Build

Requirements: ESP-IDF **>= 5.5** (`esp32c61` support; verified on 6.1),
Python 3.8+, `esptool`, and a USB-C cable that carries data.

```bash
cd idf-demo
idf.py set-target esp32c61
idf.py build
```

If the checkout was previously built with an older ESP-IDF (for example on the
old machine), remove the gitignored `build/` and `sdkconfig` first so the new
toolchain regenerates everything and picks up `sdkconfig.defaults`.

`tools/preview_screen.py` renders the same layout to `tools/preview_screen.png`
on the host (needs Pillow) so the drawing code can be iterated on without
flashing:

```bash
python3 tools/preview_screen.py
```

`python3 tools/preview_screen.py --sleep` previews the deep sleep screen, and
`--mic` / `--result` preview the live meter and the finished-recording screen.
Chinese labels come from `font_cjk.c`, a tiny bitmap table generated from a
system font; add glyphs (and the size) with:

```bash
python3 tools/gen_cjk_bitmaps.py --chars 休眠中门目录    # needs Pillow
```

---

## ESP-IDF 6.1 migration check

On 2026-10-17 the project was re-checked against ESP-IDF 6.1
(`/Users/fujd/.espressif/v6.1/esp-idf`) from a clean copy of the tree. The local
install used Python 3.14.8, esptool 5.6.0 and `riscv32-esp-elf`
esp-15.2.0_20251204.

- `idf.py set-target esp32c61` followed by `idf.py build` completed the full
  compile and link.
- `bootloader.bin`, `partition-table.bin` and `onepage_c61_idf_demo.bin` were
  generated. The application image was `0x4f930` bytes at that check; the
  current build with the microphone meter is about `0x57800` bytes.
- The settings in `sdkconfig.defaults` still take effect: 16 MB flash in DIO
  mode at 80 MHz, 2 MB PSRAM in quad mode at 40 MHz, and the USB-Serial/JTAG
  console.
- The eFuse block-revision wrapper is still linked into the bootloader;
  `objdump` shows the validation path calling
  `__wrap_bootloader_common_check_efuse_blk_validity`.
- No application source or CMake changes were required, and the project code
  built without deprecation warnings.

The ESP-IDF 6.1 migration notes cover the UART wake-up and LCD callback APIs,
neither of which this demo uses. The tool-side change that does matter is the
new fast-reflash default for `idf.py flash`; use `idf.py flash -a` when a full
write is required, as described under [Flash](#flash).

On a new machine, run `idf.py set-target esp32c61` once because `sdkconfig` is
not committed. If the checkout was built with an older ESP-IDF, remove the
gitignored `build/` and `sdkconfig` first.

This migration check covers compilation and linking only: the board was not
reflashed with the 6.1 build. Repeat the hardware checks in
[Verifying on hardware](#verifying-on-hardware) after the first 6.1 flash.

---

## Flash

> Back up the stock firmware first — it makes rollback trivial:
> ```bash
> esptool --chip esp32c61 -p /dev/cu.usbmodemXXXX read-flash 0 0x1000000 stock-backup.bin
> ```

1. Put the board in download mode (it is a plain C61: just plug it in; the ROM
   USB-Serial/JTAG device appears as `/dev/cu.usbmodem*` on macOS).
2. Flash the bootloader, partition table and app:

   ```bash
   idf.py -p /dev/cu.usbmodemXXXX flash -a
   ```

   `-a` forces a full flash. ESP-IDF 6.1 otherwise defaults to fast reflash
   (only changed regions) when `*_flashed.bin` files exist from an earlier
   flash; use the full form for the first flash and after changing the
   partition table.

3. **Erase the stale OTA selection** so the bootloader starts this app rather
   than the stock firmware that still sits in the app1 slot:

   ```bash
   esptool --chip esp32c61 -p /dev/cu.usbmodemXXXX erase-region 0xe000 0x2000
   ```

4. Watch the log:

   ```bash
   idf.py -p /dev/cu.usbmodemXXXX monitor
   ```

If the board has a **Puya** flash chip (check with
`esptool --chip esp32c61 -p <port> flash-id`; manufacturer `85`), esptool's
stub with compression is known to fail on this part, as noted in the vendor
firmware README. Flashing then has to bypass the stub:

```bash
idf.py build
esptool --chip esp32c61 --no-stub -p /dev/cu.usbmodemXXXX -b 115200 \
  write-flash @build/flash_args
```

### Rollback

```bash
esptool --chip esp32c61 -p /dev/cu.usbmodemXXXX write-flash 0 stock-backup.bin
```

Restoring the full 16 MB image puts the stock partition table, OTA state and
firmware back exactly as they were.

---

## Verifying on hardware

Static checking, without a board:

```bash
idf.py set-target esp32c61 && idf.py build     # full build, needs an IDF >= 5.5 install
python3 tools/preview_screen.py                # layout previews, no toolchain needed
python3 tools/preview_screen.py --mic          # live meter layout
python3 tools/preview_screen.py --result       # finished-recording layout
```

On the board:

Expected sequence after reset:

1. Console prints chip revision, flash/PSRAM size, reset reason and free heap,
   followed by `mic: PDM capture will be initialized on first CONFIRM`.
2. Panel shows the title, the pattern block, the status block and seven key
   boxes (this first paint is a **full** refresh and takes ~2 s).
3. Console prints the SD card info, entries and the write/read result; the panel
   switches to `SD  <n> FILES  RW OK`.
4. Pressing any key fills its box within ~150 ms and prints a console line.
5. Clicking CONFIRM switches to `MIC LEVEL` and starts the capture (the first
   click also initialises the I2S channel and logs `mic: PDM mic ready: CLK
   GPIO7, DIN GPIO3, 1024 kHz requested (~128 kword/s, 16000 Hz PCM)`). Keep
   quiet for the first ~500 ms: the screen shows `CALIBRATING NOISE FLOOR`,
   then the bar auto-ranges above the measured room noise. The bar, percentage
   and dBFS values then move with the sound, a history bar is added every
   200 ms, and the console prints `mic: ... ms, level ... dBFS ...`. Clicking
   CONFIRM again stops the take and shows `RECORDING FINISHED` with the final
   peak/average and history; BACK returns to the status screen, and a click on
   CONFIRM records again.
6. A click on POWER (or a 2 s hold) repaints the panel to the `休眠中` box, parks
   it, prints `entering deep sleep; press POWER to wake` and sleeps the chip;
   pressing POWER wakes the board with `RESET WAKE FROM SLEEP`.
7. Left alone, the demo repaints **only** when something it displays actually
   changes. The battery is re-sampled every 2 s, but the panel is only redrawn
   once it has moved by 25 mV (and at most every 30 s), so an idle board shows
   a still image instead of a flash every couple of seconds.

Things worth checking closely, because they are the failure modes seen on this
board so far:

- **Pattern block orientation** — the checkerboard must be square and the text
  upright; a mirrored or rolled pattern means the RAM window/Y-flip handling is
  off for your panel revision.
- **Front key thresholds** — the console prints the raw ADC count and the
  millivolts for every event. If a key reads as the wrong one, adjust the
  windows in `board_buttons.c` against those numbers (and check the ADC
  calibration line: `adc1: ADC1 ready, calibration: hardware|approximate`).
- **`SD NOT MOUNTED`** — the card shares GPIO27 with the panel; confirm a FAT
  formatted card is inserted and that the rail sequence ran (a second panel
  reset after mounting is the usual cause of a latched card).
- **Microphone stays at 0% / -70 DBFS** — first check the `PDM mic ready` line
  and that the take logs `level ... dBFS` once per second. If the init line is
  missing, the PDM clock or DIN is not reaching the chip (GPIO7/GPIO3, and
  GPIO27 must be high). If the clock line is present but the meter is flat while
  the logged dBFS values move, the auto-range window is too wide; decrease
  `ONEPAGE_MIC_METER_RANGE_DB`.
- **Silent room sits at a high percentage (e.g. 74%)** — that was the old fixed
  -70..-20 dBFS mapping. The current build auto-ranges above the measured noise;
  if it still sits high, the lead-in was not quiet (keep still for the first
  500 ms) or `ONEPAGE_MIC_NOISE_MARGIN_DB` needs to be larger.
- **Ghosting** — differential (`FAST`) redraws trade quality for speed. The
  microphone view inserts a `HALF` clean-up pass every eighth refresh; a reboot
  repaints everything with a `FULL` refresh.

---

## Troubleshooting

| Symptom | Likely cause |
|:---|:---|
| `image requires eFuse block revision ...` at boot | the vendor `--wrap=bootloader_common_check_efuse_blk_validity` is missing from the bootloader link; see `bootloader_components/onepage_efuse_gate/` |
| No console output | monitor the USB-Serial/JTAG port, and keep `CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y` |
| Boots the old firmware instead of this app | `otadata` not erased (step 3 above) |
| Panel stays white/blank | panel not powered (GPIO27 high?), or a refresh never completed — the driver logs a busy timeout |
| PSRAM reported as 0 KB | PSRAM init failed; the framebuffer falls back to internal RAM and the demo still runs |
| `MIC UNAVAILABLE - SEE CONSOLE` | `onepage_mic_init()` failed (I2S channel, task or mutex allocation); the panel keeps working but CONFIRM cannot record |
| Microphone meter flat at 0% | no PDM clock/data (check the GPIO7/GPIO3 nets and the GPIO27 rail), or the auto-range window is too wide |
| Silent room shows a high level | the 500 ms lead-in was not quiet, or `ONEPAGE_MIC_NOISE_MARGIN_DB` is too small |
| `esptool` fails during flashing on a Puya part | use `--no-stub` as shown above |

---

## Licensing and attribution

New code, MIT-compatible. The SSD1677 command sequences, waveform-related
register values and the key ADC windows were ported from the vendor board
support package [`open-onepage-sdk`](../firmware/open-onepage-sdk) (MIT, itself
derived from the OpenX4 community SDK), because those values are panel-specific
and not in the public datasheet. The 5x7 font is the standard public-domain
bitmap set. Keep the attribution if you ship this.

---

## Development notes

`DEVNOTES.md` holds what this README deliberately leaves out: board specifics,
the local toolchain paths, the ESP-IDF 6.x adaptations (including why the eFuse
workaround has to live in `bootloader_components/`), and what has not been
verified yet.
