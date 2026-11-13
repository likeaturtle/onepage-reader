# OnePage 登录与日程服务

微信小程序的登录 / 用户资料 / 云端日程后端，只使用 Node 内置模块，没有第三方依赖。
它负责把 `wx.login` 的临时 code 换成 `openid`，签发登录 token，保存昵称与头像，
并按用户保存日程，让用户没带设备时也能在小程序里查看。

```text
server/
├── src/
│   ├── server.js    进程入口（读 .env、监听、优雅退出）
│   ├── app.js       HTTP 路由、鉴权、头像存储
│   ├── config.js    环境变量
│   ├── auth.js      HMAC token 签发/校验
│   ├── store.js     JSON 文件用户/日程存储（原子写）
│   └── wechat.js    code2session
├── test/api.test.js node:test 用例
├── .env.example
└── data/            users.json + events.json + avatars/（自动创建，已 gitignore）
```

## 启动

需要 Node.js **22+**（用到 `--env-file-if-exists` 与内置 `fetch`）：

```bash
cp .env.example .env
npm start          # node --env-file-if-exists=.env src/server.js
npm run dev        # 监听文件变化
npm test
```

默认监听 `0.0.0.0:8787`。

## 配置

| 变量 | 说明 |
|:---|:---|
| `PORT` / `HOST` | 监听地址，默认 `8787` / `0.0.0.0` |
| `WX_APPID` / `WX_SECRET` | 小程序后台「开发 → 开发设置」里的 AppID / AppSecret |
| `SESSION_SECRET` | token 的 HMAC 密钥；生产必须改，`openssl rand -hex 32` |
| `ALLOW_DEV_LOGIN` | `1` 时允许 `{"dev":true}` 免微信登录；生产必须 `0` |
| `TOKEN_TTL_DAYS` | 登录有效期，默认 7 天 |
| `DATA_DIR` | 用户数据目录，默认 `./data` |
| `MAX_AVATAR_BYTES` | 头像大小上限，默认 512 KB |
| `CORS_ORIGIN` | 浏览器测试时的 CORS 来源，默认 `*` |

`WX_SECRET` 只放在服务端；小程序里只有 `apiBase`。

## API

所有响应都是 JSON。除 `/api/health` 和 `/api/login` 外，需要
`Authorization: Bearer <token>`。

### `GET /api/health`

```json
{"ok":true,"wechat":false,"devLogin":true}
```

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

`openid` 只保存在服务端，不返回给客户端。

### `GET /api/me`

```json
{"user":{"id":"uuid","nickname":"小页","avatar":"/avatars/uuid-176...png","createdAt":"..."}}
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
头像通过 `GET /avatars/<file>` 访问，带一年缓存头。

### `GET /api/events`

查询当前用户的云端日程，可按日期范围过滤：

```text
GET /api/events?from=2026-11-01&to=2026-11-30
GET /api/events?includeDeleted=1
```

返回：

```json
{"events":[
  {"id":"uuid","date":"2026-11-10","start":"09:00","end":"10:00",
   "title":"项目评审","note":"","deviceId":7,
   "createdAt":"...","updatedAt":"...","deletedAt":null}
]}
```

`includeDeleted=1` 只在客户端同步时使用，用来拿到软删除记录（tombstone）。

### `POST /api/events`

```json
{"date":"2026-11-10","start":"09:00","end":"10:00","title":"项目评审","note":"会议室 A"}
```

返回 `201 {"event":{...}}`。标题最多 47 UTF-8 字节、备注最多 95 字节，
超出会按字符截断；`end` 缺失或不晚于 `start` 时自动补成 `start + 60 分钟`（最多 24:00），
与固件行为一致。

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

一个账号按一台设备设计：`deviceId` 是设备固件分配的数字 id，固件没有序列号，
多设备场景需要先增加设备绑定/唯一标识。

## 安全说明

- `ALLOW_DEV_LOGIN` 必须在生产关闭，否则任何人都能免密登录；
- `SESSION_SECRET` 使用默认值时，`NODE_ENV=production` 会拒绝启动；
- token 7 天过期，payload 只含用户 id 和 exp；签名用 `timingSafeEqual` 比较；
- 登录接口有按 IP 的简单限流（30 次/分钟），内存实现，重启清零；
- 小程序请求域名必须是 HTTPS 并加入 `request 合法域名`。本地 HTTP 只能在开发者工具
  勾选「不校验合法域名」后使用；
- 用户数据是 JSON 文件（`users.json` / `events.json`），适合个人/小规模。要多实例部署时
  替换 `store.js` 为数据库，并给登录接口加分布式限流；
- 事件接口都按 `user.id` 过滤，不能通过 id 读取别人的日程。

## 部署建议

```nginx
server {
  listen 443 ssl;
  server_name calendar.example.com;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

- 用 systemd / pm2 守护进程，`NODE_ENV=production`；
- 备份 `data/`（用户资料、云端日程和头像）；
- 反向代理负责 HTTPS；Node 进程只监听回环地址或内网。
- 如果小程序和网页同时使用，CORS 默认 `*` 足够（token 在 Header，不用 cookie）。
