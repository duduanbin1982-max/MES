"use strict";
// app/ws/manager.js
// P0-4 WebSocket 连接管理器
//   - attachWebSocket(httpServer, db): 把 ws.Server 挂到现有 http server, 路径 /ws
//   - JWT 握手: 客户端连时 ?token=<access_token> 或 Sec-WebSocket-Protocol 头
//   - 消息协议:
//     客户端发送: { type: "subscribe", events: ["document.*", "bom.updated"] }
//                 { type: "unsubscribe", events: [...] }
//                 { type: "ping" }
//     服务端发送: { type: "welcome", user, ts }
//                 { type: "event", event, payload, ts }
//                 { type: "pong", ts }
//                 { type: "error", code, message }
//   - 鉴权: 401 reject, 不持久化
//   - 广播: 按订阅 pattern 通配符 (document.* 匹配 document.uploaded/issued/revoked/archived)
// Author: 三狗子 | Date: 2026-06-25

const { WebSocketServer } = require('ws');
const { verify } = require('../jwt');
const { bus, Events, emit } = require('./EventBus');
const url = require('node:url');

// 连接池
const clients = new Set();

function matchPattern(pattern, event) {
  if (pattern === '*') return true;
  if (pattern === event) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return event.startsWith(prefix + '.');
  }
  return false;
}

function send(ws, obj) {
  if (ws.readyState !== 1) return;  // OPEN
  try { ws.send(JSON.stringify(obj)); } catch (_e) { /* 客户端断开 */ }
}

function broadcast(event, payload) {
  const msg = { type: 'event', event, payload, ts: Date.now() };
  let n = 0;
  for (const ws of clients) {
    if (ws._closed) continue;
    // 默认订阅 '*', 但如果客户端显式订阅了子集, 只推匹配
    if (ws._subscribed === false) continue;  // 显式退订过
    const subs = ws._subs || ['*'];
    if (subs.some((p) => matchPattern(p, event))) {
      send(ws, msg);
      n++;
    }
  }
  return n;
}

function authenticate(req) {
  // 1) query: ?token=<access_token>
  const u = url.parse(req.url || '/', true);
  if (u.query && typeof u.query.token === 'string') {
    const payload = verify(u.query.token);
    if (payload && payload.typ === 'access' && !payload.expired) {
      return payload;
    }
  }
  // 2) Sec-WebSocket-Protocol: [<subproto>, "bearer.<token>"]
  const proto = req.headers['sec-websocket-protocol'];
  if (proto) {
    const parts = proto.split(',').map(s => s.trim());
    for (const p of parts) {
      if (p.startsWith('bearer.')) {
        const payload = verify(p.slice(7));
        if (payload && payload.typ === 'access' && !payload.expired) {
          return payload;
        }
      }
    }
  }
  return null;
}

function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({
    noServer: true,
    // 路径过滤: 必须 /ws 才升级
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const u = url.parse(req.url || '/');
    if (u.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const user = authenticate(req);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._user = user;
      ws._subs = ['*'];  // 默认全订阅
      ws._closed = false;
      ws._clientId = 'ws_' + Math.random().toString(36).slice(2, 10);
      clients.add(ws);

      send(ws, { type: 'welcome', clientId: ws._clientId, user: { id: user.sub, role: user.role, full_name: user.full_name }, ts: Date.now() });
      // 心跳
      ws._alive = true;
      ws.on('pong', () => { ws._alive = true; });

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_e) { return send(ws, { type: 'error', code: 'BAD_JSON', message: 'JSON 解析失败' }); }
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'ping') {
          return send(ws, { type: 'pong', ts: Date.now() });
        }
        if (msg.type === 'subscribe') {
          ws._subs = Array.isArray(msg.events) && msg.events.length > 0 ? msg.events : ['*'];
          ws._subscribed = true;
          return send(ws, { type: 'subscribed', events: ws._subs, ts: Date.now() });
        }
        if (msg.type === 'unsubscribe') {
          ws._subscribed = false;
          return send(ws, { type: 'unsubscribed', ts: Date.now() });
        }
        if (msg.type === 'list') {
          return send(ws, { type: 'events', events: Object.values(Events), ts: Date.now() });
        }
      });

      ws.on('close', () => {
        ws._closed = true;
        clients.delete(ws);
      });
      ws.on('error', () => {
        ws._closed = true;
        clients.delete(ws);
      });
    });
  });

  // 心跳: 30s ping 所有, 60s 无响应踢出
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (ws._alive === false) {
        try { ws.terminate(); } catch (_error) { ws._closed = true; }
        clients.delete(ws);
        continue;
      }
      ws._alive = false;
      try {
        ws.ping();
      } catch (_error) {
        ws._closed = true;
        clients.delete(ws);
      }
    }
  }, 30000);
  httpServer.on('close', () => clearInterval(heartbeat));

  // 事件总线 -> 广播
  const unsubs = Object.values(Events).map(ev =>
    bus.on(ev, (msg) => broadcast(msg.event, msg.payload))
  );
  httpServer.on('close', () => { unsubs.forEach(fn => fn()); });

  return wss;
}

function stats() {
  return {
    clients: clients.size,
    events: bus.eventNames(),
  };
}

module.exports = { attachWebSocket, broadcast, emit, Events, stats };
