"use strict";
// app/ws/EventBus.js
// P0-4 事件总线 (进程内单例, 同步派发)
//   - emit(event, payload): 业务侧调, ws manager 订阅后广播
//   - on(event, handler): ws manager 订阅
//   - 设计: 同步 + 立即派发, 不持久化 (前端断线后消息丢失, 重新拉 API 补)
// Author: 三狗子 | Date: 2026-06-25

const { EventEmitter } = require('node:events');

// 预定义事件 (前端 useWebSocket 订阅)
const Events = {
  // 文档/图纸
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_ISSUED:    'document.issued',
  DOCUMENT_REVOKED:   'document.revoked',
  DOCUMENT_ARCHIVED:  'document.archived',
  // BOM
  BOM_UPDATED:   'bom.updated',
  BOM_CREATED:   'bom.created',
  // ANDON 安灯 (P1)
  ANDON_TRIGGERED: "andon.triggered",
  ANDON_ACKED:     "andon.acked",
  ANDON_RESOLVED:  "andon.resolved",

  // 工作流 (P0-5)
  WORKFLOW_STARTED:   "workflow.started",
  WORKFLOW_TRANSITED: "workflow.transited",

  // IoT 实时数据 (MESA #5)
  IOT_READING:       'iot.reading',
  IOT_ALARM:         'iot.alarm',
  IOT_DEVICE_ONLINE:  'iot.device.online',
  IOT_DEVICE_OFFLINE: 'iot.device.offline',
  IOT_DASHBOARD:      'iot.dashboard',
  // SPC 实时监控 (MESA #7)
  SPC_ALERT:     'spc.alert',
  SPC_DASHBOARD: 'spc.dashboard',
  // 库存
  INVENTORY_LOW: 'inventory.low_stock',
  // 工单
  WORKORDER_STATUS_CHANGED: 'workorder.status_changed',
  // 系统
  SYSTEM_NOTICE:  'system.notice',
};

// 单例
const bus = new EventEmitter();
bus.setMaxListeners(100);

function emit(event, payload) {
  bus.emit(event, { event, payload, ts: Date.now() });
}

function on(event, handler) {
  bus.on(event, handler);
  return () => bus.off(event, handler);
}

function listenerCount(event) {
  return bus.listenerCount(event);
}

module.exports = { bus, Events, emit, on, listenerCount };
