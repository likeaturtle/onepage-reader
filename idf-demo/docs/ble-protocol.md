# 墨程CalCal BLE protocol

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
contains the ASCII alias `Mochen CalCal` (kept for central stacks and the mini
program scan prefix). After connecting, `hello` and INFO report the canonical
product name `墨程CalCal`. Firmware 1.2.0 / protocol 3 requires authentication:
a client has to prove knowledge of the device key and encrypt every command and
event. The BLE link itself still has no SMP pairing/bonding.

The INFO characteristic is a convenience for generic BLE apps and is not
encrypted:

```json
{"name":"墨程CalCal","fw":"1.2.0","proto":3,"events":12,"calendars":1,"time_valid":true}
```

`fw` is the image version built from the project's `version.txt` (the firmware
reads it back from the app description, so there is no second copy to keep in
sync); `proto` is the protocol revision and moves independently of `fw`.


## Authentication and encryption (proto 3)

Firmware 1.2.0 and protocol 3 replace the old open protocol. The handshake and
frame format below are the contract between the firmware, the mini program
(`miniprogram/utils/ble-auth.js`) and the web page (`web/ble-auth.js`; the two
files must stay identical).

### Pairing

A new device has no key. To pair it or to replace the current phone:

- wake the device with POWER and make sure no phone is connected (the device
  refuses to start pairing while a BLE link is up);
- hold **CONFIRM for 3 s**: the screen shows a one-time 12-character code for
  3 minutes. Holding **CONFIRM for 8 s** also erases the old key before showing
  a new code;
- connect from the client and enter the code shown on screen.

The code alphabet is Crockford base32 (`0-9`, `A-Z` without `I`, `L`, `O`,
`U`); the display groups it as `XXXX-XXXX-XXXX`. The canonical form is the
12-character uppercase string with no separators. The code is never sent over
BLE; it is only used as HKDF input:

```
K_pair = HKDF-SHA256(ikm=code, salt=pid, info="mochen-calcal-pair-v1", 32)
K_long = HKDF-SHA256(ikm=code, salt=pid, info="mochen-calcal-key-v1", 32)
```

`pid` is the uppercase 12-hex-digit Bluetooth MAC (for example
`A1B2C3D4E5F6`), used as the public pairing/handshake identifier and as the
mini program/website key-storage key. `did` is a **separate random 128-bit
device identity** stored in NVS and revealed only inside the authenticated full
hello; it is used for server-side account binding, never as crypto input. HKDF
is RFC 5869 with SHA-256; `code` and `pid` are ASCII.

The device stores exactly one `K_long`. A successful pairing replaces the old
key, so the previous phone stops working on its next connection. The pairing
code is discarded as soon as pairing succeeds.

### Handshake

When notifications are enabled the device sends a minimal, unencrypted hello:

```json
{"ev":"hello","proto":3,"fw":"1.2.0","name":"墨程CalCal","pid":"A1B2C3D4E5F6",
 "auth":true,"paired":false,"pairing":true,"nonce":"<32 hex>"}
```

`nonce` is a fresh 16-byte device nonce for this connection. `paired` reports
whether a key exists; `pairing` reports whether the 3-minute pairing window is
open. The client registers for this event and may also send
`{"cmd":"hello"}` before auth to request the same minimal hello again.

The client sends:

```json
{"cmd":"auth","pid":"A1B2C3D4E5F6","nonce":"<32 hex>","proof":"<64 hex>","pair":true}
```

- `nonce` is a fresh 16-byte client nonce (hex).
- `pair` is `true` only when using the code shown on screen; otherwise the
  client uses its stored `K_long`.
- `proof = HMAC-SHA256(K_auth, "mochen-calcal-client-v1|" + pid + "|" +
  nonce_d + "|" + nonce_a + "|" + mode)`, where `nonce_d` is the device nonce,
  `nonce_a` the client nonce, `mode` is `pair` or `auth`, and `K_auth` is
  `K_pair` for pairing or the stored `K_long` otherwise.

On success the device replies in plaintext (this is the one response after the
request that is not encrypted):

```json
{"ev":"auth","ok":true,"proto":3,"paired":true,"pairing":false,"proof":"<64 hex>"}
```

The device proof is `HMAC-SHA256(K_long, "mochen-calcal-device-v1|" + pid +
"|" + nonce_a + "|" + nonce_d + "|" + mode)`. Note the reversed nonce order;
this prevents reflecting the client proof. On pairing success the client
derives `K_long` with the same code and verifies this proof, then stores
`K_long` locally.

Failure responses are also plaintext:

```json
{"ev":"auth","ok":false,"proto":3,"error":"bad proof","paired":true,"pairing":false}
```

Possible errors: `bad auth request`, `bad proof`, `not paired`,
`pairing not active`, `too many attempts`, `auth unavailable`. After five
failed handshakes the device pauses attempts for 60 seconds.

### Session keys and frames

After a successful handshake both sides derive four keys with HKDF-SHA256
(salt is the 32 bytes `nonce_d || nonce_a`, IKM is `K_long`):

| Key | info string |
|:---|:---|
| `K_enc_c2d` | `mochen-calcal-enc-c2d-v1` |
| `K_mac_c2d` | `mochen-calcal-mac-c2d-v1` |
| `K_enc_d2c` | `mochen-calcal-enc-d2c-v1` |
| `K_mac_d2c` | `mochen-calcal-mac-d2c-v1` |

Every post-auth command and every post-auth response/event is one encrypted
wrapper line:

```json
{"s":1,"iv":"<32 hex>","d":"<base64>","m":"<64 hex>"}
```

- `s` is a per-direction sequence number starting at 1. Receivers require a
  strictly increasing sequence and ignore replays.
- `iv` is 16 random bytes. `d` is `AES-256-CBC(K_enc_dir, iv, PKCS#7(inner
  JSON))`, base64-encoded.
- `m = HMAC-SHA256(K_mac_dir, "mochen-calcal-frame-v1|" + dir + "|" + s + "|"
  + iv_hex + "|" + ciphertext_hex)`, `dir` is `c2d` (phone to device) or `d2c`.
- The inner JSON is the same command/event object as before, for example
  `{"cmd":"list","from":"2026-11-01","to":"2026-11-30"}` or
  `{"ev":"ev","id":7,...}`. Plaintext commands after auth are rejected with
  `encrypted frame required`; plaintext frames after auth are ignored by
  clients.

The `hello` command sent by an authenticated client returns the full hello
inside an encrypted frame. It adds `pid` (the public BLE MAC) and `did` (the
random device identity) to the old fields (`now`, `tz`, `time_valid`, `events`,
`calendars`, `cals`):

```json
{"ev":"hello","proto":3,"fw":"1.2.0","name":"墨程CalCal","pid":"A1B2C3D4E5F6",
 "did":"0123456789abcdef0123456789abcdef","auth":true,"authed":true,
 "now":1762703820,"tz":480,"time_valid":true,"time_synced":true,"events":12,
 "calendars":1,"cals":["日历"]}
```

The full hello is the only place the `did` is sent; the pre-auth hello carries
only `pid`. Old clients/browsers that only speak proto 2 will receive
`auth required`; update them before using a proto 3 device.

### Account binding (cloud)

BLE authentication binds a **client key** to the device. It does not tell the
server which WeChat account owns the device. The mini program adds that layer
after a successful handshake:

1. The authenticated full hello provides `did`.
2. The mini program calls `POST /api/devices/claim` with `{did, pid, name}`.
3. The server stores one binding `did -> user_id` (plus name, boundAt,
   lastSeenAt). Claiming an already-bound device with another account returns
   `409`; claiming it with the same account is idempotent and updates the name
   and last-seen time.
4. Only after a successful claim does the mini program start cloud sync. If the
   device is bound to another account, it shows an error and disconnects; the
   other account must unbind it in `我的设备`, or the device must be factory
   reset (NVS erased) so a new `did` is generated and can be claimed.
5. `GET /api/devices` lists the account's devices and
   `POST /api/devices/:did/unbind` removes the cloud binding. Unbinding does
   not erase the device's BLE key; the owner should also hold CONFIRM for 8 s
   (or re-pair from the new phone, which replaces the key).

The `did` is hidden until authentication so a nearby central cannot read it
from the pre-auth hello and claim an unbound device remotely. A client that has
already paired (and therefore has physical access and the key) can claim the
device; that is the physical trust anchor. The device itself has no network and
cannot verify the WeChat account, so the binding is enforced by the server and
the official app, not by the BLE peripheral. The browser client does not log in;
it remains a local Web Bluetooth tool and does not participate in account
binding.

### Security notes

- The pairing code has 60 bits of entropy and is valid for three minutes. It is
  a personal-device tradeoff: an attacker who captures the pairing handshake
  can attempt an offline brute force. A future QR-code/128-bit pairing flow can
  remove that limitation without changing the frame format.
- The device key lives in NVS in plaintext; enable NVS/flash encryption if
  physical extraction is in scope. Phone-side keys live in the mini program
  storage / `localStorage`, protected by the OS sandbox but not by a secure
  element.
- There is no SMP bonding, so the BLE metadata (device name, connection
  timing, packet sizes) is still visible; calendar content and commands are
  encrypted end to end.
- Pairing is gated by a physical CONFIRM hold. A nearby device that imitates
  the advertisement can still be selected by the user (phishing); check the
  `pid`/name shown by the client. `did` is only revealed after auth, which keeps
  the cloud claim from being triggered from radio range alone.
- `INFO` stays unauthenticated and exposes the firmware version, event count
  and clock validity only.

## Framing

- Both directions are **UTF-8 JSON objects, one per line**, terminated by
  `\n`. `\r\n` is accepted from desktop test clients.
- The inner JSON line must fit in 768 bytes on the device (the client should
  keep it well below that). An encrypted wrapper is allowed to grow to 1024
  bytes inbound and 1536 bytes outbound because of the base64/MAC overhead.
  Multiple lines may arrive in one write; the device processes them in order.
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

Pre-auth response (also pushed automatically when notifications are enabled):

```json
{"ev":"hello","proto":3,"fw":"1.2.0","name":"墨程CalCal","pid":"A1B2C3D4E5F6",
 "auth":true,"paired":true,"pairing":false,"nonce":"<32 hex>"}
```

Post-auth response (encrypted wrapper; this is what a client should use for the
device name, clock and event count):

```json
{"ev":"hello","proto":3,"fw":"1.2.0","name":"墨程CalCal","pid":"A1B2C3D4E5F6",
 "did":"0123456789abcdef0123456789abcdef","auth":true,"authed":true,
 "now":1762703820,"tz":480,"time_valid":true,"time_synced":true,"events":12,
 "calendars":1,"cals":["日历"]}
```

The full response is only sent after a successful handshake. A pre-auth hello
deliberately omits the calendar data and clock.

This build exposes a single calendar. `cals` still exists for protocol
compatibility but has one entry, and `cal` in commands/events is ignored
(reserved, always 0). `now` is
the device epoch, `tz` is minutes east of UTC, and `time_synced` is false when
the clock was restored from NVS after a power loss rather than from the RTC or
a phone sync. The page sends `time` after every connect.

`proto` 2 added the `update` command and proto 3 keeps it. Firmware older than
the command answers `{"ok":false,"error":"unknown cmd"}`, so a client that
edits events on such a board can fall back to `del` + `add` (and remap the new
id). Clients must refuse proto < 3 rather than falling back to an unauthenticated
protocol.

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
- `title` is required and truncated to 95 UTF-8 bytes (about 31 Chinese
  characters). `note` is optional and truncated to 191 UTF-8 bytes (about 63
  Chinese characters). The reply reports `trunc` when truncation happened.

Response:

```json
{"ok":true,"cmd":"add","id":7,"pruned":0,"trunc":false}
```

`id` is assigned by the device and is stable for the lifetime of the event.
`pruned` is the number of old past events dropped to fit the storage partition;
when no past events are left and the store is still full, the response is
`{"ok":false,"error":"calendar full"}` and nothing is added.

### `update`

```json
{"cmd":"update","id":7,"date":"2026-11-11","start":"09:30","end":"10:30","title":"项目评审（改期）","note":"会议室 B"}
```

Replaces the content of an existing event and keeps its numeric `id`, so the
phone's cloud record does not need to be remapped. The fields and limits are
the same as `add`; `cal` is ignored. A missing `id` or unknown id is an error,
and nothing is changed.

Response:

```json
{"ok":true,"cmd":"update","id":7,"trunc":false}
```

`{"ok":false,"error":"not found"}` means the id no longer exists (for example
after a device reset); the client should add the event again and remap the
cloud copy. Firmware older than proto 2 does not know this command.

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
| `bad id` | `id` is missing or outside 1..65535 |
| `empty title` | title is missing/empty |
| `auth required` | a command other than `hello`/`auth` arrived before auth |
| `encrypted frame required` | a plaintext command arrived after auth |
| `bad frame` | encrypted wrapper failed MAC/decryption/sequence checks |
| `calendar full` | 96 events and no past events left to prune |
| `not found` | event id does not exist |
| `line too long` | a single line exceeded the 1024-byte receive buffer |
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
- To edit an event, keep its id and send `update`. On a board that answers
  `unknown cmd`, delete the old id, add the edited event, then remap the cloud
  record to the new id.
- After `sleep`, do not attempt to reconnect automatically; the radio is off.

## Testing without the web page

Use nRF Connect (Android/desktop) or `bleak` on a computer:

1. Scan for `Mochen CalCal` (the ASCII advertisement); after connecting the
device reports `墨程CalCal`.
2. Enable notifications on TX.
3. Write the UTF-8 bytes of `{"cmd":"hello"}\n` to RX (with response).
4. Read the notification stream; then try `{"cmd":"time","epoch":...,"tz":480}\n`.

Because the device accepts write-without-response, a client that writes too
fast can fill the internal 2 KB RX buffer; the device discards the partial
line and returns `line too long` / `bad json`.
