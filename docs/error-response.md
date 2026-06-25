# 错误响应规范 (P0-3)

> 全端点统一错误响应 schema, 前端可按 `code` 字段做 i18n / 业务判断 / 弹窗。

## 1. Schema

### 1.1 成功响应 (2xx, 不变)

```json
{ "items": [...], "total": 100, "id": 1 }
```

成功响应**不加** `requestId` 字段, 避免冗余。

### 1.2 错误响应 (4xx / 5xx)

```json
{
  "code": "VALIDATION_ERROR",
  "message": "物料编码不能为空",
  "details": { "field": "material_code", "value": "" },
  "requestId": "req_a3f8e92b1c4d"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | string | ✓ | 业务错误码, 见 §2 |
| `message` | string | ✓ | 用户可读消息, 中文 |
| `details` | object\|null | - | 额外结构化信息 (哪个字段、当前值、约束) |
| `requestId` | string | ✓ | 唯一追踪 ID, 用于日志关联 |

`requestId` 同时通过响应头 `X-Request-Id` 返回, 客户端可透传方便排障。

## 2. 错误码

| code | HTTP | 含义 | 触发场景 |
|------|------|------|----------|
| `VALIDATION_ERROR` | 400 | 通用校验失败 | 字段缺失/类型错/格式错 |
| `UNAUTHORIZED` | 401 | 未登录 | token 缺失/失效/过期 |
| `FORBIDDEN` | 403 | 权限不足 | RBAC 拒绝 |
| `NOT_FOUND` | 404 | 资源不存在 | 记录不存在/接口不存在 |
| `CONFLICT` | 409 | 冲突 | 重复键/库存超限/状态机不匹配 |
| `UNPROCESSABLE_ENTITY` | 422 | 业务规则违反 | 数量超过上限/状态流转非法 |
| `RATE_LIMITED` | 429 | 限流 | 短时间请求过多 |
| `INTERNAL_ERROR` | 500 | 兜底 | 未预期异常 |
| `DATABASE_ERROR` | 500 | DB 异常 | SQLITE_BUSY / constraint failed |
| `UPSTREAM_ERROR` | 502 | 外部服务失败 | 飞书 webhook / 外部 API 失败 |
| `NOT_IMPLEMENTED` | 501 | 未实现 | 灰度中功能 |

## 3. 服务端用法

### 3.1 业务层抛错

```js
const { ApiError } = require('../app/errors');

if (!data.title) {
  throw ApiError.validation('文档标题必填', { field: 'title' });
}

const exist = db.prepare('SELECT id FROM documents WHERE id=?').get(id);
if (!exist) {
  throw ApiError.notFound('文档不存在', { id });
}

if (status === 'issued' && !canRevoke) {
  throw ApiError.conflict('已签发文档需要先收回', { status, current: 'issued' });
}
```

### 3.2 异步 try/catch

```js
app.put('/api/documents/:id/issue', (req, res, next) => {
  try {
    const doc = issueDocument(req.params.id, req.body.issued_to);
    res.json(doc);
  } catch (e) {
    next(e);  // ApiError 或裸 Error 都由 errorHandler 统一处理
  }
});
```

### 3.3 兼容旧 `{error: msg}` 格式

旧的 `res.status(400).json({ error: 'xxx' })` **仍然可用**, 由 `responseInterceptor` 中间件自动转换为新格式 (按 status 推断 code)。

```js
// 这行代码保持不变, 自动被转成 {code: 'VALIDATION_ERROR', message: 'xxx', details: null, requestId}
res.status(400).json({ error: '物料编码必填' });
```

⚠️ **新增代码请用 ApiError**, 享受 details 字段 + 显式 code 控制。

## 4. 前端用法

### 4.1 axios 拦截器 (已就位)

`frontend/src/api/index.ts` 已统一处理:

```ts
api.interceptors.response.use(
  (r) => r.data,
  async (err) => {
    const data = err.response?.data
    if (data?.code) {
      // 新格式: 业务错误码
      ElMessage.error(data.message)
    } else {
      ElMessage.error(err.message)
    }
    return Promise.reject(err)
  }
)
```

### 4.2 业务判断

```ts
try {
  await api.uploadDocument(file, meta)
} catch (e: any) {
  if (e.response?.data?.code === 'CONFLICT') {
    ElMessage.warning('该版本已存在, 请先归档旧版')
    return
  }
  if (e.response?.data?.code === 'VALIDATION_ERROR') {
    // details.field 高亮
    return
  }
  throw e
}
```

## 5. X-Request-Id 透传

- 客户端传 `X-Request-Id: my-trace-abc` → 服务端透传 → 响应头返回
- 客户端不传 → 服务端生成 `req_<12 hex>`
- 日志/审计/错误响应**全部带同一 ID**, 排障效率 +10x

## 6. 实现位置

| 文件 | 职责 |
|------|------|
| `app/errors.js` | `ApiError` 类 + `ErrorCode` 常量 + `errorHandler`/`notFoundHandler` |
| `app/middleware/requestId.js` | X-Request-Id 注入 + 响应头 |
| `app/middleware/responseInterceptor.js` | `{error: msg}` 形态自动转换 |
| `app/index.js` | 装配顺序, 暴露 `_mountErrorHandlers()` |
| `server.js` | 最后一行 `app._mountErrorHandlers()` |

## 7. 测试覆盖

- 单测: `tests/errorResponse.test.js` — 10/10 ✅
  - 200 不受影响
  - 400/401/403/404/409 status → 正确 code
  - throw ApiError → 尊重 code/status/details
  - throw 裸 Error → 500 INTERNAL_ERROR
  - X-Request-Id 透传
  - 404 兜底
- 全量: **284/0/0** ✅

## 8. 迁移路径

P0-3 已 100% 向后兼容, 旧端点零改动也能享受新格式。

**未来 P1 推荐**:
- 业务端点逐步把 `res.status(400).json({error})` 改为 `throw ApiError.validation(msg, details)`
- 利用 `details.field` 实现表单字段级高亮
- 利用 `requestId` 串接前端 Sentry/LogRocket