# TBM-MES v2 (微型盾构机/掘进机 MES)

> 部署在 192.168.1.73:3890 | 2026-06-18 全面替换 v1（破碎锤外壳 schema）

## 业务定位

微型盾构机/掘进机 MES，**Ø3-6m 整机**，年产 ≤10 套，市政管廊/电力隧道/给排水用。
- **核心思想**：项目即产品实例（1 套 = 1 个项目）
- **起步机型**：EPB-4000 4m 土压平衡
- **客户**：自销给地铁/市政（当前）
- **关键件策略**：部分自制（盾体/液压/电控柜），主轴承/PLC/刀具外购

## 快速开始

```bash
# 健康检查
curl http://192.168.1.73:3890/api/health

# 全局看板
curl http://192.168.1.73:3890/api/dashboard

# 示例项目详情
curl http://192.168.1.73:3890/api/projects/1/dashboard

# BOM 树
curl http://192.168.1.73:3890/api/projects/1/bom/tree

# 长交期关键件（≥12 周）
curl http://192.168.1.73:3890/api/key_components/long_leadtime
```

## 服务管理

```bash
# 状态
ssh dubin@192.168.1.73 'systemctl --user status factory-mes.service'

# 重启
ssh dubin@192.168.1.73 'systemctl --user restart factory-mes.service'

# 日志
ssh dubin@192.168.1.73 'tail -f /home/dubin/factory-mes/data/mes.log'

# 跑新 migration（新增 .sql 放 db/migrations/）
ssh dubin@192.168.1.73 'cd /home/dubin/factory-mes && node migrate.js'
```

## 9 大子系统（tbm_subsystems）

| 序 | code | 中文 | 主要内容 |
|----|------|------|---------|
| 1 | cutter_head | 刀盘 | 刀盘体 + 盘形滚刀 + 刮刀 + 中心刀 |
| 2 | main_drive | 主驱动 | 主轴承 + 减速机 + 驱动电机 + 主密封 |
| 3 | shield_body | 盾体 | 前盾/中盾/尾盾 + 铰接 + 人舱（**自制重点**）|
| 4 | thrust | 推进系统 | 推进油缸 + 支撑环 + 管片支撑 |
| 5 | erector | 拼装系统 | 拼装机本体 + 回转 + 真空吸盘 |
| 6 | mucking | 出渣系统 | 螺旋输送机 + 皮带机 + 渣土改良 |
| 7 | hydraulic | 液压系统 | 主泵站 + 三回路（推进/铰接/拼装）（**自制**）|
| 8 | e_control | 电气控制 | PLC + 配电柜 + 变频 + 监控（**自制**）|
| 9 | trailing | 后配套 | 1-3# 拖车 + 操作室 + 通风机 |

## 10 阶段里程碑（S1-S10）

| 阶段 | 名称 | 周数 | 备注 |
|------|------|------|------|
| S1 | 设计冻结 | 2-4 | 起点 |
| S2 | 采购 | 8-12 | 关键件长交期并行 |
| S3 | 自制件生产 | 12-16 | 与 S2 并行 |
| S4 | 部件预装 | 4-6 | |
| S5 | 总装 | 4-8 | 串行 |
| S6 | 厂内调试 | 2-4 | |
| S7 | 拆解/包装/发运 | 1-2 | |
| S8 | 现场组装 | 4-6 | 跨组织 |
| S9 | 试掘进/验收 | 4-8 | 跨组织 |
| S10 | 质保期 | 52 | 长尾 |

## 关键件长交期预警

```bash
curl http://192.168.1.73:3890/api/key_components/long_leadtime
```

当前 6 个长交期件：
- 主轴承 Φ3000 (SKF) — **20 周** (high)
- 管片拼装机 (海瑞克) — 18 周 (high)
- 行星减速机 (SEW) — 16 周 (high)
- 主密封 (SKF) — 14 周 (high)
- 变频电机 75kW ×6 (ABB) — 12 周 (medium)
- 盘形滚刀 (罗宾斯) — 12 周 (medium)

## 文件结构

```
/home/dubin/factory-mes/
├── server.js              # Express API (30+ 端点)
├── db.js                  # SQLite 封装
├── migrate.js             # 自动 migration runner
├── seed-demo.js           # 一键演示数据
├── reset-to-demo.sh       # 一键重置 (含备份)
├── seed-bom-epb4000.js    # 9 子系统 BOM 详细 seed
├── package.json
├── factory-mes.service    # systemd unit
├── db/migrations/
│   ├── 002_tbm_phase1.sql # 25 张表 (唯一有效 migration)
│   └── 001_phase1.sql.废弃 # v1 旧 schema (已废弃)
├── data/
│   ├── mes.db             # SQLite 主库
│   └── mes.log            # 运行日志
├── server.js.v1.bak       # 旧 server.js 备份
└── routes.v1.bak/         # 旧 routes 备份
```

## 备份

```bash
# 手动备份当前数据
ssh dubin@192.168.1.73 'cp -av /home/dubin/factory-mes/data/ /home/dubin/factory-mes-backup-manual-$(date +%Y%m%d)/'

# 恢复旧数据（v1 12 表）
ssh dubin@192.168.1.73 'cp -av /home/dubin/factory-mes-backup-20260618/data/* /home/dubin/factory-mes/data/ && systemctl --user restart factory-mes.service'
```

## 一键重置

```bash
# 重置到演示状态（清空业务数据 + 重建示例项目）
ssh dubin@192.168.1.73 '/home/dubin/factory-mes/reset-to-demo.sh'
```

## 铁律

- ⚠️ **别手动改 SQLite** — 用 API
- ⚠️ **schema 改动先写新 migration** (003_xxx.sql) — 别改旧的
- ⚠️ **备份先于破坏** — reset 前自动备份
- ⚠️ **失败立即报告** — 1 次就报，不自己重试 2-3 次
- ⚠️ **能用就停** — 不追求花哨

## 路线图

### P0 (W1, 2026-06-18~22) ✅ 大部分完成
- [x] 备份 + schema v2 + 25 表
- [x] server.js v2 + 30+ 端点
- [x] 9 大子系统 BOM 模板 (67 节点)
- [x] 示例项目 TBM-2026-001 端到端
- [x] seed-demo + reset-to-demo 脚本
- [ ] Day 4-5: OpenAPI 文档 + 部署 README + 端到端压力测试

### P1 (W2-3) - 待规划
- [ ] 物料管理深化（库存 / 批次 / 领料）
- [ ] 质检管理（工序检 + 终检 + 不合格处理）
- [ ] 设备状态（实时看板）
- [ ] 甘特图（项目级 + 工序级）
- [ ] 基础报表

### P2 (W4+) - 待规划
- [ ] 成本归集（单台成本）
- [ ] 图文档管理
- [ ] 工艺参数记录
- [ ] 数据分析
- [ ] 移动端 / 车间 PDA
- [ ] OA/ERP 对接
- [ ] 设备集成（PLC）
