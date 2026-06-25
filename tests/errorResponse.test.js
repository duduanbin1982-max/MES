'use strict';
/**
 * errorResponse.test.js
 * P0-3 错误响应契约测试
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const http = require('node:http');

let server, port;

test.before(async () => {
  const app = createApp();
  app.get('/api/test/ok', (req, res) => res.json({ hello: 'world' }));
  app.get('/api/test/400', (req, res) => res.status(400).json({ error: '业务校验失败' }));
  app.get('/api/test/404', (req, res) => res.status(404).json({ error: '资源不存在' }));
  app.get('/api/test/401', (req, res) => res.status(401).json({ error: '未登录' }));
  app.get('/api/test/403', (req, res) => res.status(403).json({ error: '权限不足' }));
  app.get('/api/test/409', (req, res) => res.status(409).json({ error: '重复' }));
  app.get('/api/test/throw-api', (req, res) => {
    const { ApiError, ErrorCode } = require('../app/errors');
    throw new ApiError(ErrorCode.VALIDATION, '业务规则违反', 422, { field: 'x' });
  });
  app.get('/api/test/throw-raw', (req, res) => { throw new Error('裸 Error'); });
  app._mountErrorHandlers();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
});

test.after(async () => { if (server) await new Promise(r => server.close(r)); });

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null }));
    }).on('error', reject);
  });
}

test('P0-3-1 200 正常响应不受影响', async () => {
  const r = await get('/api/test/ok');
  assert.equal(r.status, 200);
  assert.equal(r.body.hello, 'world');
  assert.equal(r.body.requestId, undefined, '成功响应不应加 requestId');
});

test('P0-3-2 400 业务校验 -> VALIDATION_ERROR', async () => {
  const r = await get('/api/test/400');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'VALIDATION_ERROR');
  assert.equal(r.body.message, '业务校验失败');
  assert.match(r.body.requestId, /^req_/);
});

test('P0-3-3 404 -> NOT_FOUND', async () => {
  const r = await get('/api/test/404');
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'NOT_FOUND');
  assert.equal(r.body.message, '资源不存在');
});

test('P0-3-4 401 -> UNAUTHORIZED', async () => {
  const r = await get('/api/test/401');
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'UNAUTHORIZED');
});

test('P0-3-5 403 -> FORBIDDEN', async () => {
  const r = await get('/api/test/403');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'FORBIDDEN');
});

test('P0-3-6 409 -> CONFLICT', async () => {
  const r = await get('/api/test/409');
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'CONFLICT');
});

test('P0-3-7 throw ApiError -> 尊重 code+status+details', async () => {
  const r = await get('/api/test/throw-api');
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'VALIDATION_ERROR');
  assert.equal(r.body.message, '业务规则违反');
  assert.deepEqual(r.body.details, { field: 'x' });
});

test('P0-3-8 throw 裸 Error -> 500 INTERNAL_ERROR', async () => {
  const r = await get('/api/test/throw-raw');
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'INTERNAL_ERROR');
  assert.equal(r.body.message, '服务内部错误');
});

test('P0-3-9 X-Request-Id 透传 + 响应头返回', async () => {
  const r = await get('/api/test/400', { 'X-Request-Id': 'my-trace-abc' });
  assert.equal(r.body.requestId, 'my-trace-abc');
  assert.equal(r.headers['x-request-id'], 'my-trace-abc');
});

test('P0-3-10 不存在路由 -> 统一 404', async () => {
  const r = await get('/api/no-such-route');
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'NOT_FOUND');
  assert.equal(r.body.message, '接口不存在');
  assert.equal(r.body.details.path, '/api/no-such-route');
  assert.equal(r.body.details.method, 'GET');
});
