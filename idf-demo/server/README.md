# 墨程CalCal · 登录与日程服务

微信小程序的登录 / 用户资料 / 云端日程后端，只使用 Node 内置模块，没有第三方依赖。
它负责把 `wx.login` 的临时 code 换成 `openid`，签发登录 token，保存昵称与头像，
并按用户保存日程，让用户没带设备时也能在小程序里查看。

```text
server/
├── src/
│   ├── server.js    进程入口（读 .env、密钥校验、监听、优雅退出）
│   ├── app.js       HTTP 路由、鉴权、头像存储
│   ├── ai.js        DeepSeek ASR 与语音文本解析（API Key 只在服务端）
│   ├── event-rules.js 日程日期/时间/标题校验与截断
│   ├── http-error.js  可返回给客户端的错误
│   ├── config.js    环境变量
│   ├── crypto.js    AES-256-GCM 字段加密 + openid HMAC 索引 + 密钥环
│   ├── auth.js      HMAC token 签发/校验
│   ├── store.js     JSON 文件 v3 用户/日程存储（原子写、payload 加密）
│   ├── backup.js    加密快照的创建/恢复
│   └── wechat.js    code2session
├── scripts/
│   ├── backup.js    npm run backup
│   └── restore.js   npm run restore
├── test/            node:test 用例（API / AI / 加密 / 备份 / schema）
├── deploy/          systemd unit（开机自启 / 每日加密备份）
├── .env.example
└── data/            users.json + events.json + avatars/（自动创建，已 gitignore）
```

## 启动

需要 Node.js **22+**（用到 `--env-file-if-exists` 与内置 `fetch`）：

```bash
cp .env.example .env
openssl rand -base64 32   # DATA_KEY
openssl rand -base64 32   # INDEX_KEY
openssl rand -base64 32   # BACKUP_KEY
npm start          # node --env-file-if-exists=.env src/server.js
npm run dev        # 监听文件变化
npm test
```

开发环境不填 `DATA_KEY` / `INDEX_KEY` 时，会从 `SESSION_SECRET` 派生稳定密钥并打印警告；
因此开发环境改 `SESSION_SECRET` 也会让旧数据无法解密。`NODE_ENV=production` 缺少任一密钥会
拒绝启动。中途更换密钥必须把旧密钥放进 `DATA_OLD_KEYS` / `INDEX_OLD_KEYS`，否则已有数据无法解密。

语音日程还需要 `DEEPSEEK_API_KEY`；不填时 `/api/ai/*` 返回 `503`、健康检查的 `ai` 为
`false`，登录和日程功能不受影响。

默认监听 `0.0.0.0:8787`。

## 配置

| 变量 | 说明 |
|:---|:---|
| `PORT` / `HOST` | 监听地址，默认 `8787` / `0.0.0.0` |
| `WX_APPID` / `WX_SECRET` | 小程序后台「开发 → 开发设置」里的 AppID / AppSecret |
| `DEEPSEEK_API_KEY` | DeepSeek API Key，用于语音识别和日程解析；只放服务端 |
| `DEEPSEEK_BASE_URL` | DeepSeek API 源站，默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 解析语音文本用的模型，默认 `deepseek-flash`；可选 `deepseek-v4-pro` |
| `DEEPSEEK_TIMEOUT_MS` | 调用 DeepSeek 的超时，默认 30000 |
| `SCHEDULE_TIMEZONE` | 解析“明天/下周三”等相对日期的时区，默认 `Asia/Shanghai` |
| `SESSION_SECRET` | token 的 HMAC 密钥；生产必须改，`openssl rand -hex 32` |
| `ALLOW_DEV_LOGIN` | `1` 时允许 `{"dev":true}` 免微信登录；生产必须 `0` |
| `TOKEN_TTL_DAYS` | 登录有效期，默认 7 天 |
| `DATA_DIR` | 用户数据目录，默认 `./data` |
| `MAX_AVATAR_BYTES` | 头像大小上限，默认 512 KB |
| `CORS_ORIGIN` | 浏览器测试时的 CORS 来源，默认 `*`；生产建议固定域名 |
| `TRUST_PROXY` | `1` 时信任反代写入的 `X-Real-IP`，用于登录限流；仅在 Node 只监听回环地址时开启 |
| `DATA_KEY` / `DATA_KEY_ID` | 昵称、日程标题/备注的 AES-256-GCM 密钥；生产必填 |
| `DATA_OLD_KEYS` | 轮换时旧密钥，格式 `k0:<base64>,k1:<base64>`，只读解密 |
| `INDEX_KEY` / `INDEX_KEY_ID` | openid HMAC 索引密钥；生产必填 |
| `INDEX_OLD_KEYS` | 轮换时旧索引密钥，格式同上 |
| `BACKUP_KEY` | `npm run backup` / `restore` 的独立备份密钥 |

`WX_SECRET`、`DEEPSEEK_API_KEY`、`DATA_KEY`、`INDEX_KEY`、`BACKUP_KEY` 只放在服务端；
小程序里只有 `apiBase`。

## API

所有响应都是 JSON。除 `/api/health` 和 `/api/login` 外，需要
`Authorization: Bearer <token>`。

### `GET /api/health`

```json
{"ok":true,"wechat":false,"devLogin":true,"ai":false}
```

也支持 `HEAD`，方便 `curl -I` 或只取状态码的探活。`ai` 表示是否配置了
`DEEPSEEK_API_KEY`；未配置时语音接口返回 `503`，其他功能不受影响。

### `POST /api/login`

```json
{"code":"wx.login 返回的 code"}
```

或开发模式：

```json
{"dev":true}
```

返回：

```json
{"token":"...","user":{"id":"uuid","nickname":"","avatar":"","createdAt":"..."},"expiresIn":604800}
```

`openid` 只在服务端以 HMAC 索引 + 加密副本存在，不返回给客户端。

### `GET /api/me`

```json
{"user":{"id":"uuid","nickname":"小页","avatar":"/api/me/avatar?v=76884ac1...jpg","createdAt":"..."}}
```

### `POST /api/me`

```json
{"nickname":"小页"}
```

昵称 1–20 个字符。也接受 `PATCH`，但小程序使用 `POST`（`wx.request` 未文档化支持 PATCH）。

### `POST /api/me/avatar`

```json
{"data":"data:image/png;base64,..."}
```

只接受 PNG / JPEG / WebP，解码后 100 B–512 KB，并校验文件头。返回更新后的 `user`。
服务端用随机文件名保存，`user.avatar` 是 `/api/me/avatar?v=<opaque-id>`。

### `GET /api/me/avatar`

需要 `Authorization`。只返回当前登录用户自己的头像，响应头是
`cache-control: private, max-age=300`，不再是公开 URL。小程序端用
`wx.downloadFile` 带 token 下载到临时文件，再交给 `<image>` 显示；
正式环境还要把 API 域名加入微信后台的 `downloadFile 合法域名`。

### `POST /api/ai/transcribe`

把小程序录到的语音转成文字。请求体是 JSON（避免在服务端再实现一套 multipart 解析）：

```json
{"audio":"<base64>","format":"pcm","sampleRate":16000,"channels":1,"bitsPerSample":16}
```

- 小程序录制 16 kHz、16 位、单声道 PCM；服务端检测到裸 PCM 时补 44 字节 WAV 头，
  已经带 `RIFF/WAVE` 或 `OggS` 头的文件原样转发；
- 请求体上限 6 MB；音频解码后上限 8 MB；服务端按 PCM 时长限制最长 120 秒（与
  DeepSeek 一致），小程序录音上限 60 秒；
- 返回 `{"text":"明天下午三点项目评审","durationMs":3200,"requestId":"..."}`；
- 需要登录；每个用户每分钟最多 20 次 AI/ASR 请求；未配置 Key 返回 `503`。

### `POST /api/ai/schedule`

把识别出的文字解析成日程草案（只解析，不保存；小程序把结果填入添加日程表单，
用户点「保存日程」后才按原有 `POST /api/events` 保存并同步设备）：

```json
{"text":"明天下午三点项目评审，会议室 A"}
```

```json
{"event":{"date":"2026-11-19","start":"15:00","end":"15:30","title":"项目评审","note":"会议室 A"}}
```

服务端把 `SCHEDULE_TIMEZONE` 的当前日期、时间、星期一起写进提示词，要求模型只输出
JSON；返回后仍走 `normalizeEvent()` 校验和截断（标题 95 B、备注 191 B），日期无效或
模型返回坏 JSON 时返回 `422` / `502`。用户没提结束时间时默认 30 分钟，与添加日程表单一致。

### 设备归属

BLE 认证成功后，小程序把设备在加密 hello 里给出的随机 `did` 登记到当前微信账号。
`did` 不会出现在 pre-auth hello 里，避免附近设备只凭蓝牙广播/未认证 hello 抢占绑定。

#### `GET /api/devices`

返回当前账号绑定的设备：

```json
{"devices":[{"did":"0123456789ABCDEF0123456789ABCDEF","pid":"A1B2C3D4E5F6",
  "name":"墨程CalCal","boundAt":"2026-11-19T09:00:00.000Z",
  "lastSeenAt":"2026-11-19T09:00:00.000Z"}]}
```

#### `POST /api/devices/claim`

```json
{"did":"0123456789ABCDEF0123456789ABCDEF","pid":"A1B2C3D4E5F6","name":"墨程CalCal"}
```

同一账号重复 claim 是幂等的（更新名称和 `lastSeenAt`）；设备已绑定其他账号返回
`409 {"error":"设备已绑定其他账号"}`。`pid` 是公开的 BLE MAC，仅用于小程序清理本地
密钥，不参与服务端鉴权。

#### `POST /api/devices/:did/unbind`

只有绑定账号可以解绑；成功返回 `{"ok":true}`。解绑不会清除设备上的 BLE 密钥，
用户还需要在设备上长按确认键 8 秒（或由新手机重新配对）。

### `GET /api/events`

查询当前用户的云端日程，可按日期范围过滤：

```text
GET /api/events?from=2026-11-01&to=2026-11-30
GET /api/events?includeDeleted=1
```

返回：

```json
{"events":[
  {"id":"uuid","seq":1,"date":"2026-11-10","start":"09:00","end":"10:00",
   "title":"项目评审","note":"","deviceId":7,
   "createdAt":"...","updatedAt":"...","deletedAt":null}
]}
```

`includeDeleted=1` 只在客户端同步时使用，用来拿到软删除记录（tombstone）。

### `POST /api/events`

```json
{"date":"2026-11-10","start":"09:00","end":"10:00","title":"项目评审","note":"会议室 A"}
```

返回 `201 {"event":{...}}`。标题最多 95 UTF-8 字节、备注最多 191 字节，
超出会按字符截断；`end` 缺失或不晚于 `start` 时自动补成 `start + 60 分钟`（最多 24:00），
与固件行为一致。

### `POST /api/events/:id`（修改日程）

```json
{"date":"2026-11-11","start":"09:30","end":"10:30","title":"项目评审（改期）","note":"会议室 B"}
```

修改日程内容，返回 `{"event":{...}}`。请求体可以只带要改的字段（与存储值合并后再按
新增同样的规则校验），`deviceId` 和 `createdAt` 保持不变；所以设备上的同一条记录仍能
按原 id 更新。`PATCH` 也接受（小程序用 `POST`，因为 `wx.request` 没文档化支持 `PATCH`）。
已软删除的日程返回 `409`。

### `DELETE /api/events/:id`

软删除（写入 `deletedAt`），返回 `{"ok":true,"event":{...}}`。客户端在设备上删除成功后
调用下面的 purge；离线时保留 tombstone，下次同步再处理。

### `POST /api/events/:id/device`

```json
{"deviceId":7}
```

把云端事件关联到设备上的数字 id。设备 `add` 成功返回 id 后调用。
传 `{"deviceId":null}` 可解除关联。

### `POST /api/events/:id/purge`

物理删除一条云端日程。设备删除成功后调用；离线删除时不要调用，
否则设备上的旧事件会在下次同步时被重新导入。

### `POST /api/logout`

```json
{"ok":true}
```

token 是无状态的，服务端不维护会话；客户端删除本地 token 即可。保留这个端点是为了
以后增加吊销列表时不需要改客户端。

## 云端与设备的同步

小程序按**双向同步**处理（当前版本）：

1. 手机端新增/删除先写云端，没连接设备也能查看；
2. 连接设备后，设备有、云端没有的事件会导入云端；
3. 云端有、设备没有的事件会推送到设备；
4. 云端已删除但设备还有的事件，会从设备删除；
5. 设备上用按键删除、云端仍存在的**当前窗口内**事件，会同时删除云端记录；
6. 设备为空（可能是重置）或一次消失 3 条以上时，小程序先弹窗让用户选择
   “删除云端”或“恢复设备”，避免设备 NVS 被清空时误删云端；
7. 设备返回的条目数与 `done.n` 不一致时，小程序会中止同步，避免把丢包误判成删除；
8. 只同步“今天 −7 天 ~ 今天 +120 天”的事件，避免把历史日程塞满设备 NVS；
   云端保留全部历史。

设备归属：固件在 NVS 里保存一个随机 128-bit `did`，只在认证后的 hello 中下发；
小程序认证成功后通过 `/api/devices/claim` 把它绑定到当前微信账号。一个 `did` 只属于
一个账号，另一个账号物理重新配对后会被 `409` 拒绝云同步。`devices.json` 只保存
`did/pid/userId/name/boundAt/lastSeenAt`，不保存 BLE 长期密钥；设备没有网络，归属由
服务端 + 官方小程序执行，不能阻止持有 BLE 密钥的本地直接访问。

注意：云端事件里的 `deviceId` 是**设备上的日程行号**，不是物理设备身份；物理设备身份
是 `did`。

## 加密与备份

### 静态加密

`users.json` / `events.json` 是 v3 格式：

- `users`：`{ id, openidHash, openidEnc, profile, createdAt, lastLoginAt }`；
  `profile` 是一个 AES-256-GCM 密文，里面是 `{ nickname, avatarId }`；
- `events`：`{ id, seq, payload }`；`payload` 是一个密文，里面是
  `{ date, start, end, title, note, deviceId, createdAt, updatedAt, deletedAt }`；
  `seq` 是每个用户的同步游标，更新/删除也会递增；
- `openid` 不落明文：只存 `INDEX_KEY` 的 HMAC 索引（`k1:<digest>`）和一份 `DATA_KEY` 加密的副本；
- AAD 绑定 `user:<id>:profile` / `event:<userId>:<eventId>:payload`，把密文挪到别的用户或记录会解密失败；
- 服务端现在只剩 `id`、`seq`、用户级时间戳这类元数据；日程时间、deviceId 已经进入密文。

这个项目还没发布，所以只支持 v3，**没有 v1/v2 迁移代码**。如果读到旧 schema，
服务进程会拒绝启动并提示删除旧数据目录，而不是猜测着改写。数据目录和文件权限会被收紧到
`0700` / `0600`（含头像文件），头像使用随机文件名。

### 密钥轮换

1. 生成新 key，设为 `DATA_KEY` / `INDEX_KEY`，`*_KEY_ID` 改成新 id；
2. 旧 key 放进 `*_OLD_KEYS`（格式 `k0:<base64>,k1:<base64>`）；
3. 重启后旧记录仍可读；`openid` 索引在启动时用加密副本批量重算成新 key，不依赖用户重新登录；
   profile、event payload、openid 副本会在同一次启动中被解密并用新 key 重写；
4. 确认启动日志没有 `cannot re-encrypt` / `cannot refresh openid index` 警告后，移除 `*_OLD_KEYS`。

`*_OLD_KEYS` 只用于解密，不会用旧 key 加密新数据。`INDEX_OLD_KEYS` 主要是给
没有 `openidEnc` 的历史记录兜底；新数据在启动时就能重算索引。

### 加密备份

```bash
npm run backup                    # 写到 backups/mocheng-calcal-<timestamp>.backup.json
npm run backup -- /path/to/dir    # 指定输出目录
npm run restore -- backups/mocheng-calcal-....backup.json [dataDir] [--force]
```

备份是 gzip + AES-256-GCM 的单文件，包含 `DATA_DIR` 下所有内容（含头像）。
`BACKUP_KEY` 与 `DATA_KEY` 分开保管：备份泄露不会泄露在线数据，反之亦然。
备份里不含密钥；换机器或灾难恢复时，必须同时取回 `DATA_KEY` / `INDEX_KEY`
（否则恢复出来的密文无法解密）和 `BACKUP_KEY`。
恢复前先停服务；建议恢复到空目录，目标目录非空需要 `--force`（不会删除目标里多出来的文件）。
备份文件和密钥不要放在同一块盘上。
日常建议用 cron 每天跑一次，并把 `backups/` 同步到异地加密存储。

> 备份文件内部的 magic 仍是 `ONEPAGE-BACKUP`，加密 salt 也沿用旧字面量，
> 这是为了兼容既有备份；对外展示与文件名已统一为墨程CalCal。

### 已知边界

- 头像文件是私有鉴权访问，但字节仍是原图、未做服务端加密；E2EE 阶段会改成客户端加密；
- `DATA_KEY` 在进程内存里，能读进程内存或拿到 root 的人仍能解密；
- JSON 文件适合单实例小规模；多实例或更大规模应换数据库，并保留 payload 结构；
- 只有端到端加密（E2EE）才能对客户宣称“服务端看不到日程”，当前方案没有做到这一点。

### 下一步演进边界

- **换数据库**：`users(id, openid_hash, profile, ...)`、`events(id, user_id, seq, payload)`、
  `avatars(id, user_id, data)`。event 不要再加 `date` 明文列，否则 E2EE 时还要拆。
- **做 E2EE**：`profile` / `payload` 改由客户端生成，服务端只存 opaque blob；
  服务端不再解密，`from/to` 筛选移到客户端，改用 `seq` 做增量同步。
- **头像**：现在是私有鉴权的原图；E2EE 时换成客户端密文，服务端仍然只负责存取。

## 安全说明

- `ALLOW_DEV_LOGIN` 必须在生产关闭；`NODE_ENV=production` 且为 `1` 时直接拒绝启动；
- `SESSION_SECRET` 使用默认值时，`NODE_ENV=production` 会拒绝启动；
- 生产缺少 `DATA_KEY` / `INDEX_KEY` 时拒绝启动；开发环境的派生密钥只适合本机；
- token 7 天过期，payload 只含用户 id 和 exp；签名用 `timingSafeEqual` 比较；
- 登录接口有按 IP 的简单限流（30 次/分钟），内存实现，重启清零；
- 小程序请求域名必须是 HTTPS 并加入 `request 合法域名`。本地 HTTP 只能在开发者工具
  勾选「不校验合法域名」后使用；
- 用户数据是 JSON 文件（`users.json` / `events.json`），适合个人/小规模。要多实例部署时
  替换 `store.js` 为数据库，并给登录接口加分布式限流；
- 事件接口都按 `user.id` 过滤，不能通过 id 读取别人的日程；
- `GET /api/me/avatar` 需要 token，公开的 `/avatars/...` 已移除。

## 部署建议

```nginx
server {
  listen 80;
  server_name calendar.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name calendar.example.com;

  ssl_certificate     /etc/letsencrypt/live/calendar.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/calendar.example.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;

  client_max_body_size 8m;  # avatar JSON (3 MB) + voice PCM base64 (6 MB)

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # ASR for a 60 s clip can take a while; leave room for the AI round trips
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
  }
}
```

### systemd（开机自启）

`deploy/` 下有可直接安装的 unit。默认按 `server/` 部署在 `/home/ubuntu/calcal-server`、
以 `ubuntu` 用户运行；换路径或用户时同步改 `WorkingDirectory`、`ReadWritePaths`、
`ExecStart` 里的路径和 `User`/`Group`。

```bash
# node 用 nvm 装的：把当前版本固定成一个稳定软链，unit 只认这个路径
sudo ln -sfn "$(readlink -f "$(nvm which default)")" /usr/local/bin/calcal-node
/usr/local/bin/calcal-node -v          # 需要 v22+

install -d -m 700 /home/ubuntu/calcal-server/data /home/ubuntu/calcal-server/backups

sudo cp deploy/calcal-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now calcal-server
```

`data/` 和 `backups/` 必须先存在：unit 用 `ReadWritePaths=` 给这两个目录开口子，
路径不存在时 systemd 会直接拒绝启动（不会替你 mkdir）。

#### node 来自 nvm

问题不在路径，而在加载方式：nvm 是写进 `.bashrc` / `.profile` 的 shell 函数，靠改
`PATH` 生效；systemd 用 `execve` 直接拉起进程，不读 shell 配置，`PATH` 固定为
`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`。所以 unit 里写
`node`、`npm start` 或 `nvm use 22 && ...` 都不可靠（后两种还多一层 shell，影响
`SIGTERM` 传递）。nvm 装的 `node` 本身是普通二进制，运行时不需要 nvm 参与，
给 systemd 一个绝对路径就够了。

难点只在于 nvm 的路径带版本号，每次 `nvm install` 都会变，所以用
`/usr/local/bin/calcal-node` 这层软链把「unit 用哪个 node」和「nvm 当前默认哪个
node」解耦：

```bash
# 以 ubuntu 用户执行，不是 root（root 的 nvm 在 /root/.nvm，服务读不到）
readlink -f "$(nvm which default)"   # /home/ubuntu/.nvm/versions/node/v22.x.y/bin/node
sudo ln -sfn "$(readlink -f "$(nvm which default)")" /usr/local/bin/calcal-node
/usr/local/bin/calcal-node -v        # 需要 v22+
```

`nvm which default` 不认别名时换成 `nvm which 22` 或 `nvm which current`。

升级 node 后重指软链并重启：

```bash
sudo ln -sfn "$(readlink -f "$(nvm which default)")" /usr/local/bin/calcal-node
sudo systemctl restart calcal-server
```

不想维护软链，就把 `readlink -f ...` 的输出直接写进 `ExecStart=`，代价是每次升级
node 都要改 unit 再 `daemon-reload`。

几个坑：

- nvm 装在 `/root/.nvm` 时服务读不到（`ubuntu` 用户 + `ProtectHome=read-only`），
  要么在 ubuntu 用户下重装 nvm 并建链，要么给服务装一份系统级 node（NodeSource 的
  `/usr/bin/node`），nvm 只留给交互式开发；
- `ProtectHome=read-only` 不挡 `~/.nvm`：只读挂载允许读和执行二进制，挡的只是写；
- 运行时只需要 `node`，不需要 `npm`、`nvm`，不用往 unit 里写 `NVM_DIR` 或
  `.nvm/nvm.sh`；`--env-file-if-exists=.env` 由 node 自己解析；
- 软链放 `/usr/local/bin` 而不是 `~/.nvm` 里，重装或升级 nvm 自身不会把它删掉。

验证：

```bash
systemctl status calcal-server
journalctl -u calcal-server -f
curl -s http://127.0.0.1:8787/api/health   # {"ok":true,...}
sudo systemctl restart calcal-server       # 改完 .env 后重启才生效
```

systemd 负责三件事：`enable` 后开机自启、进程异常退出后按 `Restart=on-failure`
拉起、`SIGTERM` 时给 `src/server.js` 的优雅退出留时间（unit 里
`TimeoutStopSec=15` 覆盖它自带的 5 秒强退）。配置错误导致 `exit(1)` 时会重试 5 次
后停在 failed，原因看 `journalctl -u calcal-server`，不会无限重启刷 CPU。修好配置后先
`sudo systemctl reset-failed calcal-server` 再 `start`，否则可能仍被启动频率限制拦住。

unit 里的 `NODE_ENV` / `HOST` / `TRUST_PROXY` 会覆盖 `.env`（`node --env-file` 只在
变量未定义时填充），所以生产契约不依赖 `.env` 写没写对；代价是改这三项要改 unit 并
`daemon-reload`。`.env` 的权限保持 `600`，它仍然是密钥的唯一来源。

每天加密备份用配套 timer，不需要再写 cron：

```bash
sudo cp deploy/calcal-backup.service deploy/calcal-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now calcal-backup.timer
systemctl list-timers calcal-backup.timer
journalctl -u calcal-backup -n 20
```

timer 按服务器本地时间触发（`timedatectl` 确认时区），`Persistent=true` 会补跑宕机
错过的那次；`backups/` 不会自动清理，按需加保留策略。恢复前先
`systemctl stop calcal-server`，恢复完再 start。

nginx 自己也要开机自启（`systemctl enable --now nginx`），否则重启后 443 没人监听。
不想用 systemd 的话 pm2 也能做同样的事（`pm2 start src/server.js --name calcal-server`、
`pm2 startup`、`pm2 save`），但会多一个运行时依赖，和「只用 Node 内置模块」的现状不符。

- `HOST=127.0.0.1`、`TRUST_PROXY=1`，只让 nginx 访问 Node；不要直接暴露 8787；
- 用 `npm run backup` 做加密备份，不要直接 `tar data/`；
- 反向代理负责 HTTPS；Node 进程只监听回环地址或内网；
- 如果小程序和网页同时使用，CORS 默认 `*` 足够（token 在 Header，不用 cookie），
  生产建议收紧到固定域名。
