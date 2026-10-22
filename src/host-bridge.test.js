import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMessage } from './host-bridge.js';

test('接收宿主直接对象和容器事件中的扫码结果', () => {
  const result = { type: 'result', ok: true, currentCode: 'PK001', count: 1, message: '录入成功' };
  for (const event of [result, { data: result }, { detail: { data: [result] } }, { data: JSON.stringify(result) }]) {
    assert.deepEqual(readMessage(event), result);
  }
});

test('失败结果和非法消息不会变成成功结果', () => {
  assert.equal(readMessage({ type: 'result', ok: false, message: '包装查询失败' }).ok, false);
  assert.equal(readMessage({ type: 'scan', code: 'PK001' }), null);
  assert.equal(readMessage({ data: '{' }), null);
});
