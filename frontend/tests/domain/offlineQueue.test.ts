import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OFFLINE_QUEUE_LIMIT,
  createAction,
  dequeue,
  enqueue,
  incrementRetry,
  nextBatch,
  parseStoredQueue,
  pendingCount,
  serializeQueue,
  shouldQueueRequest,
} from '../../src/domain/offlineQueue.ts'

test('OFQ.1 入队/出队/计数', () => {
  let queue = enqueue([], createAction('scan', { code: 'WO-1', action: 'start' }, 1000, () => 'a1'))
  queue = enqueue(queue, createAction('work_report', { work_order_id: 1 }, 2000, () => 'a2'))
  assert.equal(pendingCount(queue), 2)
  assert.equal(queue[0].id, 'a1')
  assert.equal(queue[0].retries, 0)
  queue = dequeue(queue, 'a1')
  assert.deepEqual(queue.map((item) => item.id), ['a2'])
})

test('OFQ.2 队列上限：超出丢弃最旧', () => {
  let queue: ReturnType<typeof createAction>[] = []
  for (let i = 0; i < OFFLINE_QUEUE_LIMIT + 5; i += 1) {
    queue = enqueue(queue, createAction('scan', { code: 'C' + i }, i, () => 'id-' + i))
  }
  assert.equal(queue.length, OFFLINE_QUEUE_LIMIT)
  assert.equal(queue[queue.length - 1].id, 'id-' + (OFFLINE_QUEUE_LIMIT + 4))
})

test('OFQ.3 重试计数与超限移除', () => {
  let queue = [createAction('scan', {}, 1000, () => 'r1')]
  for (let i = 0; i < 4; i += 1) queue = incrementRetry(queue, 'r1', 5)
  assert.equal(queue[0].retries, 4)
  queue = incrementRetry(queue, 'r1', 5)
  assert.equal(queue.length, 0, '达到最大重试后移除')
})

test('OFQ.4 重放批次取队首 N 条', () => {
  let queue: ReturnType<typeof createAction>[] = []
  for (let i = 0; i < 8; i += 1) queue = enqueue(queue, createAction('scan', { i }, i, () => 'b' + i))
  assert.deepEqual(nextBatch(queue, 5).map((item) => item.id), ['b0', 'b1', 'b2', 'b3', 'b4'])
})

test('OFQ.5 是否需要入队：网络错误/5xx/超时/限流', () => {
  assert.equal(shouldQueueRequest(undefined, true), true)
  assert.equal(shouldQueueRequest(500, false), true)
  assert.equal(shouldQueueRequest(503, false), true)
  assert.equal(shouldQueueRequest(408, false), true)
  assert.equal(shouldQueueRequest(429, false), true)
  assert.equal(shouldQueueRequest(400, false), false, '业务校验错误不入队')
  assert.equal(shouldQueueRequest(403, false), false, '权限错误不入队')
  assert.equal(shouldQueueRequest(200, false), false)
})

test('OFQ.6 本地存储序列化/反序列化容错', () => {
  const queue = [createAction('andon', { title: '缺料' }, 1000, () => 'c1')]
  const raw = serializeQueue(queue)
  const parsed = parseStoredQueue(raw)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].type, 'andon')
  assert.deepEqual(parseStoredQueue(null), [])
  assert.deepEqual(parseStoredQueue('not-json'), [])
  assert.deepEqual(parseStoredQueue('{"a":1}'), [])
  assert.deepEqual(parseStoredQueue('[{"id":"x","type":"bad","payload":{}}]'), [])
})
