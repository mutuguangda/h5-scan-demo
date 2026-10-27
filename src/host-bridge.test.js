import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMessage } from './host-bridge.js';

test('接收宿主直接对象和容器事件中的扫码结果', () => {
  const result = { type: 'result', ok: true, currentCode: 'PK001', count: 1, message: '录入成功' };
  for (const event of [result, { data: result }, { detail: { data: [result] } }, { data: JSON.stringify(result) }]) {
    assert.deepEqual(readMessage(event), { ...result, requestId: null });
  }
});

test('失败结果和非法消息不会变成成功结果', () => {
  assert.equal(readMessage({ type: 'result', ok: false, message: '包装查询失败' }).ok, false);
  assert.equal(readMessage({ type: 'scan', code: 'PK001' }), null);
  assert.equal(readMessage({ data: '{' }), null);
});

test('接收宿主打开页面时同步的计数', () => {
  const init = { type: 'init', count: 7, currentCode: '' };
  for (const event of [init, { data: init }, { detail: { data: [init] } }, { data: JSON.stringify(init) }]) {
    assert.deepEqual(readMessage(event), { ...init, requestId: null, ok: true, message: '' });
  }
});

test('解析消息时保留 requestId，缺失时兼容为 null', () => {
  for (const type of ['init', 'result']) {
    for (const requestId of ['scan-1', 0, 12, '']) {
      const message = { type, requestId };
      for (const event of [message, { data: message }, { detail: { data: [message] } }, { data: JSON.stringify(message) }]) {
        assert.equal(readMessage(event).requestId, requestId);
      }
    }
    assert.equal(readMessage({ type }).requestId, null);
    assert.equal(readMessage({ type, requestId: null }).requestId, null);
  }
});

test('缺少计数的初始化消息保持计数为 null', () => {
  assert.equal(readMessage({ type: 'init', count: '' }).count, null);
});
