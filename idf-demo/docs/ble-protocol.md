# OnePage calendar BLE protocol

The device is a BLE peripheral with one custom GATT service. The phone page in
`web/index.html` is the reference client. NimBLE is configured for one
connection and a preferred ATT MTU of 247; the protocol nevertheless works at
the default MTU of 23 because the client writes 20-byte chunks.

## GATT table

| Attribute | UUID | Properties |
|:---|:---|:---|
| Service | `6f6e6570-6167-6531-6361-6c656e646172` | primary |
| RX | `6f6e6570-6167-6531-6361-000000000001` | Write, Write Without Response |
| TX | `6f6e6570-6167-6531-6361-000000000002` | Notify |
| INFO | `6f6e6570-6167-6531-6361-000000000003` | Read |

The advertised data contains the 128-bit service UUID; the scan response
contains the name `Mochen CalCal`. No pairing or bonding is required. This
means any BLE central in radio range can modify the calendar; the protocol is
intended for a personal device on a desk, not for an untrusted environment.

The INFO characteristic is a convenience for generic BLE apps:

```json
{"name":"Mochen CalCal","fw":"1.0.0","proto":1,"events":12,"calendars":1,"time_valid":true}
```

## Framing

- Both directions are **UTF-8 JSON objects, one per line**, terminated by
  `\n`. `\r\n` is accepted from desktop test clients.
- A JSON line must fit in 768 bytes on the device (the client should keep it
  well below that). Multiple lines may arrive in one write; the device
  processes them in order.
- A write may split a line at any byte. The device buffers until the newline.
  The reference page writes 20-byte chunks, so this works with MTU 23.
- Notifications are split into chunks of `min(MTU - 3, 180)` bytes and each
  notification is a fragment of exactly one line. Reassemble by newline, not
  by notification boundary.
- The device does not send anything until TX notifications are enabled
  (`CCCD`). On subscribe it sends a `hello` event automatically.

## Commands

Every command has a `cmd` string. The device answers with `{"ok":true,...}` or
`{"ok":false,"error":"..."}`. A few commands produce streamed event lines
instead of a single ack.

### `hello`

```json
{"cmd":"hello"}
```

Response:

```json
{"ev":"hello","proto":1,"fw":"1.0.0","name":"Mochen CalCal","now":1762703820,"tz":480,"time_valid":true,"time_synced":true,"events":12,"calendars":1,"cals":["日历"]}
```

This build exposes a single calendar. `cals` still exists for protocol
compatibility but has one entry, and `cal` in commands/events is ignored
(reserved, always 0). `now` is
the device epoch, `tz` is minutes east of UTC, and `time_synced` is false when
the clock was restored from NVS after a power loss rather than from the RTC or
a phone sync. The page sends `time` after every connect.

### `time`

```json
{"cmd":"time","epoch":1762703820,"tz":480}
```

`tz` is optional (the stored offset is kept). The device clamps it to
`[-720, 840]`. `epoch` must be at least 2021-01-01. Response:

```json
{"ok":true,"cmd":"time","local":"2026-11-09 15:57","persist":true}
```

If the NVS write fails, `persist` is false but the clock still changes for this
session. The command also triggers a UI redraw.

### `list`

```json
{"cmd":"list","from":"2026-11-01","to":"2026-11-30"}
```

- `from`/`to` are inclusive local dates (`YYYY-MM-DD`); omit them for all
  events. `cal` is accepted but ignored in this single-calendar build.
- Response is a stream of event lines followed by a terminator:

```json
{"ev":"ev","id":7,"cal":1,"date":"2026-11-10","start":"09:00","end":"10:00","title":"项目评审","note":"会议室 A"}
{"ev":"done","n":1}
```

Events are sorted by date, start time and id. The device caps a response at
the in-RAM limit (96 events); use a date range on the phone.

### `add`

```json
{"cmd":"add","date":"2026-11-10","start":"09:00","end":"10:00","title":"项目评审","note":"会议室 A"}
```

- `cal` is optional and ignored; every event is stored in calendar 0.
- `date` is a local civil date; `start`/`end` are local `HH:MM`.
- If `end` is omitted, empty, or not later than `start`, the device uses
  `start + 60 min` (clamped to 24:00). An event with `start=23:30` and
  `end=00:00` becomes 23:30–24:00.
- `title` is required and truncated to 47 UTF-8 bytes (about 15 Chinese
  characters). `note` is optional and truncated to 95 UTF-8 bytes. The reply
  reports `trunc` when truncation happened.

Response:

```json
{"ok":true,"cmd":"add","id":7,"pruned":0,"trunc":false}
```

`id` is assigned by the device and is stable for the lifetime of the event.
`pruned` is the number of old past events dropped to fit the NVS partition;
when no past events are left and the store is still full, the response is
`{"ok":false,"error":"calendar full"}` and nothing is added.

### `del`

```json
{"cmd":"del","id":7}
```

```json
{"ok":true,"cmd":"del","id":7}
```

Deleting a missing id returns `{"ok":false,"error":"not found"}`. The page
should refresh its list after deleting.

### `sleep`

```json
{"cmd":"sleep"}
```

The device acknowledges, stops BLE, draws the next-events lock screen, parks
the panel and enters deep sleep. The connection drops; wake the board with the
POWER key. The page treats the disconnect as expected after this command.

### `ping`

```json
{"cmd":"ping"}
{"ok":true,"cmd":"ping","uptime_ms":123456,"heap":123456}
```

Useful for checking that the link and the command task are alive.

## Errors

| Error | Meaning |
|:---|:---|
| `bad json` | the line is not a JSON object |
| `missing cmd` | no `cmd` string |
| `unknown cmd` | unsupported command |
| `bad date`, `bad start`, `bad end` | malformed or out-of-range year/time |
| `empty title` | title is missing/empty |
| `calendar full` | 96 events and no past events left to prune |
| `not found` | event id does not exist |
| `line too long` | a single line exceeded the 768-byte receive buffer |
| `out of memory` | the device could not allocate the list buffer |
| `time persist failed` | no longer emitted: a failed NVS write is reported as `"persist":false` |

## Client implementation notes

- Use `writeValueWithResponse` if the browser exposes it; it throttles writes
  and makes chunk boundaries reliable. The reference page falls back to
  `writeValue`.
- Subscribe to TX before sending the first command; the device's CCCD write is
  what enables notifications.
- Reassemble notification chunks with an incremental UTF-8 decoder until a
  newline. A notification can end in the middle of a multi-byte character.
- Only one command should be in flight at a time. The reference page serialises
  writes and resolves a command on its ack (`ok` + `cmd`) or on `ev:"done"` for
  `list`.
- After `sleep`, do not attempt to reconnect automatically; the radio is off.

## Testing without the web page

Use nRF Connect (Android/desktop) or `bleak` on a computer:

1. Connect to `Mochen CalCal`.
2. Enable notifications on TX.
3. Write the UTF-8 bytes of `{"cmd":"hello"}\n` to RX (with response).
4. Read the notification stream; then try `{"cmd":"time","epoch":...,"tz":480}\n`.

Because the device accepts write-without-response, a client that writes too
fast can fill the internal 2 KB RX buffer; the device discards the partial
line and returns `line too long` / `bad json`.
