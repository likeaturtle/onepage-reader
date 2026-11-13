# OnePage 日历 · 手机网页

`index.html` is the whole phone client: one static file, no build step, no CDN,
no external fonts. It uses the browser's Web Bluetooth API to connect to the
device's GATT service and exchanges newline-delimited JSON.

## Requirements

- **Android Chrome / Edge** (recommended), or desktop Chrome / Edge.
- A **secure context**: HTTPS or `http://localhost`.
- iOS Safari does **not** implement Web Bluetooth. Use a browser that does
  (for example Bluefy) if you must use an iPhone.
- The device must be awake (press POWER). BLE is off in deep sleep.

## Host it

### On the same computer

```bash
cd idf-demo/web
python3 -m http.server 8000
```

Open <http://localhost:8000>. `localhost` counts as a secure context.

### For a phone

Put `index.html` on any HTTPS static host. GitHub Pages, Netlify, Cloudflare
Pages or a web server with a certificate all work. Then open the URL in
Android Chrome.

> If you need to use a LAN address for development, Chrome can temporarily
> treat an origin as secure via
> `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
> (add `http://192.168.x.x:8000`). This is a development-only workaround.

## Use

1. Tap **连接蓝牙设备** and choose **Mochen CalCal**.
2. The page reads `hello`, shows the device time, then syncs the phone clock
   and timezone (`time` command) and loads the current month (`list`).
3. Pick a date, start/end time and title, then **发送到设备**. The device
   answers with the new event id and refreshes its panel. All entries use the
   device's single calendar, so there is no category selector.
4. The **本月日程** card lists the selected month. Use the arrows / **回到今天**
   to navigate; **刷新** reloads from the device. Each row has a **删除**
   button with a confirmation.
5. **让设备锁屏** asks the device to stop BLE, draw the next-appointment lock
   screen and enter deep sleep. Press POWER on the device to wake it.
6. Open **蓝牙协议日志** to see every JSON line in both directions. This is the
   first place to look if a command times out.

The form limits are chosen to match the firmware: a title is at most 15
characters and a note at most 30, because the device stores 47/95 UTF-8 bytes
respectively. The device also truncates safely at a UTF-8 boundary and reports
`"trunc":true` if it had to shorten anything.

## Web Bluetooth notes

- `requestDevice` filters on the service UUID, so only this device family is
  offered. The device name is in the scan response.
- The page writes 20-byte chunks (the default ATT MTU of 23 minus 3). This is
  slower than using a large MTU but works on every phone. The device
  reassembles by newline and chunks notifications to its negotiated MTU.
- The page serialises all writes through a promise chain. Do not send two
  commands concurrently: the protocol has no request ids.
- A notification can split a multi-byte UTF-8 character, so the page uses
  `TextDecoder(..., {stream: true})` and only parses complete lines.
- If the device goes to sleep, the browser fires `gattserverdisconnected`; the
  page shows **设备已断开** and stops sending. Reconnect after waking the
  device.

## Protocol

The full command reference is in [`../docs/ble-protocol.md`](../docs/ble-protocol.md).
The UUIDs are duplicated in `index.html` and `components/ble_calendar/include/ble_calendar.h`;
keep them in sync if you change the service.
