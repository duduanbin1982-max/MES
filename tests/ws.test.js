require('dotenv').config();
'use strict';
/**
 * ws.test.js
 * P0-4 WebSocket 实时推送测试
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { signAccess } = require('../app/jwt');
const { attachWebSocket } = require('../app/ws/manager');
const { emit, Events } = require('../app/ws/EventBus');

let httpServer, port;

const baseClaims = { sub: 1, role: 'admin', permissions: ['*'], full_name: '测试' };
function mkToken() { return signAccess(baseClaims).token; }

test.before(async () => {
  httpServer = http.createServer();
  attachWebSocket(httpServer);
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  port = httpServer.address().port;
});

test.after(async () => { await new Promise((r) => httpServer.close(r)); });

function connect(token) {
  return new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${port}/ws${token ? '?token=' + token : ''}`;
    const ws = new WebSocket(url);
    const messages = [];
    ws.on('message', (raw) => { try { messages.push(JSON.parse(raw.toString())); } catch (_e) {} });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function waitFor(messages, predicate, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      const found = messages.find(predicate);
      if (found) { clearInterval(t); resolve(found); }
      else if (Date.now() - start > timeoutMs) { clearInterval(t); reject(new Error('timeout: ' + JSON.stringify(messages.slice(-3)))); }
    }, 10);
  });
}

test('P0-4-1 无 token -> 401 or refused', async () => {
  const result = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let done = false;
    const finish = (r) => { if (!done) { done = true; ws.terminate(); resolve(r); } };
    ws.on('unexpected-response', (req, res) => finish({ status: res.statusCode }));
    ws.on('error', () => finish({ status: 0 }));
    ws.on('close', () => finish({ status: 0 }));
  });
  assert.ok(result.status === 401 || result.status === 0, 'expected 401 or refused, got: ' + JSON.stringify(result));
});

test('P0-4-2 无效 token -> 401 or refused', async () => {
  const result = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=garbage`);
    let done = false;
    const finish = (r) => { if (!done) { done = true; ws.terminate(); resolve(r); } };
    ws.on('unexpected-response', (req, res) => finish({ status: res.statusCode }));
    ws.on('error', () => finish({ status: 0 }));
    ws.on('close', () => finish({ status: 0 }));
  });
  assert.ok(result.status === 401 || result.status === 0, 'expected 401 or refused, got: ' + JSON.stringify(result));
});

test('P0-4-3 有效 token -> welcome', async () => {
  const { ws, messages } = await connect(mkToken());
  try {
    const welcome = await waitFor(messages, (m) => m.type === 'welcome');
    assert.equal(welcome.user.role, 'admin');
    assert.match(welcome.clientId, /^ws_/);
  } finally { ws.close(); }
});

test('P0-4-4 subscribe/unsubscribe', async () => {
  const { ws, messages } = await connect(mkToken());
  try {
    await waitFor(messages, (m) => m.type === 'welcome');
    ws.send(JSON.stringify({ type: 'subscribe', events: ['document.*'] }));
    const sub = await waitFor(messages, (m) => m.type === 'subscribed');
    assert.deepEqual(sub.events, ['document.*']);
    ws.send(JSON.stringify({ type: 'unsubscribe' }));
    const unsub = await waitFor(messages, (m) => m.type === 'unsubscribed');
    assert.equal(unsub.type, 'unsubscribed');
  } finally { ws.close(); }
});

test('P0-4-5 emit -> 客户端收消息 (默认订阅 *)', async () => {
  const { ws, messages } = await connect(mkToken());
  try {
    await waitFor(messages, (m) => m.type === 'welcome');
    emit(Events.DOCUMENT_UPLOADED, { id: 99, doc_code: 'TEST-99', title: 'ws 测试' });
    const evt = await waitFor(messages, (m) => m.type === 'event' && m.event === 'document.uploaded');
    assert.equal(evt.payload.id, 99);
  } finally { ws.close(); }
});

test('P0-4-6 精确订阅过滤 (只收匹配的)', async () => {
  const { ws, messages } = await connect(mkToken());
  try {
    await waitFor(messages, (m) => m.type === 'welcome');
    ws.send(JSON.stringify({ type: 'subscribe', events: ['bom.updated'] }));
    await waitFor(messages, (m) => m.type === 'subscribed');
    emit(Events.DOCUMENT_UPLOADED, { id: 100 });
    emit(Events.BOM_UPDATED, { id: 5 });
    const evt = await waitFor(messages, (m) => m.type === 'event', 1000);
    assert.equal(evt.event, 'bom.updated');
    await new Promise((r) => setTimeout(r, 100));
    const docEvt = messages.find((m) => m.type === 'event' && m.event === 'document.uploaded');
    assert.equal(docEvt, undefined, '不应收到 document.uploaded');
  } finally { ws.close(); }
});

test('P0-4-7 ping/pong', async () => {
  const { ws, messages } = await connect(mkToken());
  try {
    await waitFor(messages, (m) => m.type === 'welcome');
    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await waitFor(messages, (m) => m.type === 'pong');
    assert.ok(pong.ts);
  } finally { ws.close(); }
});

test('P0-4-8 list 事件清单', async () => {
  const { ws, messages } = await connect(mkToken());
  try {
    await waitFor(messages, (m) => m.type === 'welcome');
    ws.send(JSON.stringify({ type: 'list' }));
    const r = await waitFor(messages, (m) => m.type === 'events');
    assert.ok(r.events.includes('document.uploaded'));
    assert.ok(r.events.includes('bom.updated'));
  } finally { ws.close(); }
});

test('P0-4-9 多客户端 (广播给所有订阅者)', async () => {
  const a = await connect(mkToken());
  const b = await connect(mkToken());
  try {
    await waitFor(a.messages, (m) => m.type === 'welcome');
    await waitFor(b.messages, (m) => m.type === 'welcome');
    emit(Events.SYSTEM_NOTICE, { msg: 'hello all' });
    const ea = await waitFor(a.messages, (m) => m.type === 'event');
    const eb = await waitFor(b.messages, (m) => m.type === 'event');
    assert.equal(ea.event, 'system.notice');
    assert.equal(eb.event, 'system.notice');
  } finally { a.ws.close(); b.ws.close(); }
});

test('P0-4-10 非 /ws 路径 -> 不应 open', async () => {
  const result = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/other?token=${mkToken()}`);
    let done = false;
    const finish = (r) => { if (!done) { done = true; ws.terminate(); resolve(r); } };
    ws.on('open', () => finish({ opened: true }));
    ws.on('error', () => finish({ opened: false }));
    ws.on('close', () => finish({ opened: false }));
    ws.on('unexpected-response', () => finish({ opened: false }));
  });
  assert.equal(result.opened, false, '非 /ws 路径不应 open');
});
