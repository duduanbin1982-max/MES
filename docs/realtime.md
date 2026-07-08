# 实时推送 (P0-4)

> WebSocket 实时事件, 业务侧 `emit` -> 所有订阅客户端即时收到, 替代轮询 + 慢请求。

## 1. 架构

```
业务侧 (services/*.js)               客户端 (浏览器/前端)
   |                                       |
   | emit(Events.DOCUMENT_UPLOADED, ...)   |
   v                                       |
EventBus (进程内单例)                       |
   |                                       |
   v                                       |
WebSocket Manager                          |
   |                                       |
   v   broadcast (按订阅过滤)               v
+-----------------> WebSocket 连接池  --> 各客户端 ws.send({type:"event", ...})
```

- **同步派发** (内存 EventEmitter), 不持久化
- **断线后丢消息**, 客户端重新拉 API 补
- **多客户端** 同时收到, 按各自订阅 pattern 过滤
- **心跳 30s**, 死链 60s 清理

## 2. 连接

### 2.1 地址

- `ws://host/ws?token=<access_token>` (开发/HTTP)
- `wss://host/ws?token=<access_token>` (生产/HTTPS 经 nginx)

### 2.2 鉴权

JWT `access_token` 通过 query 传入 (后端用 `app/jwt.js#verify` 验证, 必须 `typ=access` 且未过期)。无效/缺失 -> HTTP 401。

> 浏览器 WebSocket API 不支持自定义 header, 所以走 query。Token 经 HTTPS 加密等价安全。

## 3. 协议

### 3.1 客户端 -> 服务端

```json
{ "type": "ping" }                                    // 心跳
{ "type": "list" }                                    // 查询支持的事件
{ "type": "subscribe", "events": ["document.*", "bom.updated"] }  // 精确订阅
{ "type": "unsubscribe" }                             // 退订所有
```

### 3.2 服务端 -> 客户端

```json
{ "type": "welcome", "clientId": "ws_xyz", "user": { "id": 1, "role": "admin" }, "ts": 1782395700000 }
{ "type": "pong", "ts": 1782395700000 }
{ "type": "events", "events": ["document.uploaded", ...] }
{ "type": "subscribed", "events": [...], "ts": ... }
{ "type": "unsubscribed", "ts": ... }
{ "type": "event", "event": "document.uploaded", "payload": { "id": 4, "title": "..." }, "ts": 1782395700000 }
{ "type": "error", "code": "BAD_JSON", "message": "JSON 解析失败" }
```

### 3.3 订阅匹配

| 订阅 pattern | 匹配的 event |
|--------------|--------------|
| `*` (默认) | 全部 |
| `document.uploaded` | 仅 `document.uploaded` |
| `document.*` | `document.uploaded` / `document.issued` / `document.revoked` / `document.archived` |
| `bom.*` | `bom.updated` / `bom.created` |

## 4. 预定义事件

| event | 触发位置 | payload |
|-------|----------|---------|
| `document.uploaded` | `services/documentService.js` upload 成功 | `{id, doc_code, title, doc_type, uploaded_by}` |
| `document.issued` | 签发 | `{id, doc_code, title, issued_to, issued_by}` |
| `document.revoked` | 收回 | `{id, doc_code, title, reason, revoked_by}` |
| `document.archived` | 归档 | `{id, archived_by}` |
| `bom.updated` | (待接) BOM 节点/关系变化 | `{id, part_number}` |
| `bom.created` | (待接) | `{id, part_number}` |
| `inventory.low_stock` | (待接) 库存低于安全值 | `{material_code, current, safety}` |
| `workorder.status_changed` | (待接) | `{id, from, to}` |
| `system.notice` | (待接) 广播 | `{msg, level}` |

## 5. 服务端用法

### 5.1 业务侧触发

```js
const { emit, Events } = require('../app/ws/EventBus');

// 在业务 endpoint 完成后
emit(Events.DOCUMENT_UPLOADED, {
  id: created.id,
  doc_code: created.doc_code,
  title: created.title,
  doc_type: created.doc_type,
  uploaded_by: req.user && req.user.id,
});
```

### 5.2 新增事件

1. 在 `app/ws/EventBus.js` 的 `Events` 加常量
2. 业务侧调 `emit(Events.MY_EVENT, payload)`
3. 前端 `useWebSocket('my.event', handler)` 订阅

## 6. 前端用法

### 6.1 composable

```ts
import { useWebSocket, closeWebSocket } from '@/composables/useWebSocket'

// 在 setup() 中 (Layout.vue 等全局)
const { status, off } = useWebSocket(['document.*', 'bom.updated'], (payload) => {
  if (payload.event === 'document.uploaded') {
    ElMessage.info(`新文档: ${payload.title}`)
  }
})

// 登出时
closeWebSocket()
```

### 6.2 特性

- **单例**: 跨组件共享同一 ws 连接
- **重连**: 指数退避 1s → 2s → 4s → max 30s
- **通配**: 订阅 `document.*` 自动匹配 `document.uploaded` 等
- **状态**: 顶栏小圆点 (绿/黄/红) 反映连接状态

## 7. 性能与限制

| 维度 | 限制 |
|------|------|
| 单进程客户端数 | 1000+ (Node 22) |
| 消息大小 | <1MB 推荐 |
| 心跳 | 30s ping, 60s 无响应踢出 |
| 消息持久化 | 无 (断线丢失) |
| 跨节点 | 不支持 (单机进程内) |

**如需多节点**: 后续可接 Redis pub/sub, `EventBus` 改 `ioredis` 适配即可, API 不变。

## 8. 测试

- `tests/ws.test.js` — 10/10 ✅
  - 鉴权 (无 token / 无效 token / 有效 token)
  - 握手 (welcome)
  - 订阅 / 退订
  - 广播 (精确 + 通配)
  - ping/pong
  - 路径过滤 (非 /ws 拒绝)
  - 多客户端
- 全量: **294/0/0** ✅
- E2E: 7/7 (login → ws → upload → issue → revoke → archive, 每步收事件) ✅

## 9. 安全注意

- Token 经 query, **生产必须 HTTPS/WSS** (避免 token 泄露)
- Token 短期 1h 过期, 重连时若 token 失效需重新登录
- 后续可加 IP 限流 / Origin 校验 (防 CSRF)
