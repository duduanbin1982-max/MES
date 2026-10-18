# TBM-MES MCP 只读工具（P1-2）

把 MES 的 5 个只读查询封装成 [MCP](https://modelcontextprotocol.io) 工具，供 AI 助手（Claude Desktop、
其他 MCP 客户端）安全调用。**只读、零依赖、复用现有鉴权与数据范围。**

## 一、工具清单

| 工具 | 作用 | 主要参数 | 返回 |
|---|---|---|---|
| `mes_work_order_progress` | 工单进度 | `status` / `instance_id` / `days` / `limit` | 工单列表 + 进度% + 状态汇总 + 链接 |
| `mes_material_shortage` | 缺料/齐套 | `status` / `instance_id` / `days` / `max_work_orders` | 缺料工单 + 物料/需求/可用/缺口 + 链接 |
| `mes_oee` | OEE（ISA-95 口径） | `days` / `instance_id` | 可用率/性能/质量/OEE、三层基线、损失分桶、数据质量 |
| `mes_qc_pass_rate` | 质检合格率 | `days` / `limit` | 总数/合格/不合格、按类型分组、最近不合格 |
| `mes_anomalies` | 异常中心 | `days` / `status` / `level` / `limit` | 异常清单 + 链接 |

## 二、启动

```bash
# 在 MES 仓库根目录
node scripts/mcp-server.js
```

stdio + 换行分隔 JSON-RPC 2.0；`initialize` / `tools/list` / `tools/call` / `ping`。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `MES_API_BASE` | `http://127.0.0.1:3890` | 本地 API 地址 |
| `MES_WEB_BASE` | `http://127.0.0.1` | 生成深链用（`/work-orders` 等） |
| `MES_MCP_USER_ID` | `1` | **用哪个用户身份查询**。改成普通用户 id 即自动继承其 RBAC 权限点 + P1-1 数据范围 |
| `MES_MCP_TOKEN` | 空 | 直接给 token；为空则现签一个 1 小时的只读 token |

## 三、MCP 客户端配置示例

```json
{
  "mcpServers": {
    "tbm-mes": {
      "command": "node",
      "args": ["/home/dubin/factory-mes/scripts/mcp-server.js"],
      "env": {
        "MES_API_BASE": "http://127.0.0.1:3890",
        "MES_WEB_BASE": "http://192.168.1.73",
        "MES_MCP_USER_ID": "1"
      }
    }
  }
}
```

## 四、安全边界

1. **只读**：HTTP 层固定 `GET`，没有任何写接口路径（单测 MCP.7 静态校验）。
2. **不绕过鉴权**：走本地 API + `Authorization: Bearer`，命中 `authMiddleware`、`apiPermissionMiddleware`
   与 P1-1 数据范围（`req.scope()`）；用普通用户 id 启动时只能看到自己的项目/车间数据。
3. **凭据最小化**：默认只签发 1 小时、只含 5 个只读权限点（`work_order:read` / `pick:read` /
   `quality:read` / `report:read` / `equipment:read`）的 token，缓存在内存，不落盘。
4. **超时与错误**：单次请求 10s 超时；工具异常以 `isError` 返回，不会让服务崩。

## 五、手工验证

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"mes_oee","arguments":{"days":90}}}' \
  | node scripts/mcp-server.js
```

## 六、测试

```bash
node --test tests/mcpServer.test.js   # 8 条：工具清单、协议分发、参数、只读约束、缺料聚合
```
