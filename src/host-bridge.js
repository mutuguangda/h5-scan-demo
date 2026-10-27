/**
 * 宿主通道探测顺序（理由见 docs/specs 与 /tmp 探索结论）：
 * - `dd.postMessage` / `dd.onMessage`：spec 里写的形式，未在 dingtalk-jsapi 中证实，但保留为第一优先级。
 * - `my.postMessage` / `my.onMessage`：支付宝小程序容器暴露的 API，实际最可能生效。
 * - `window.parent.postMessage` / `window.addEventListener('message')`：普通 iframe 兜底。
 * 三者都没有时静默降级为独立浏览器模式。
 */

function getGlobal(name) {
  if (typeof globalThis === 'undefined') {
    return undefined;
  }
  return globalThis[name];
}

export function detectSendChannel() {
  const dd = getGlobal('dd');
  if (dd && typeof dd.postMessage === 'function') {
    return { channel: 'dd', send: message => dd.postMessage(message) };
  }
  const my = getGlobal('my');
  if (my && typeof my.postMessage === 'function') {
    return { channel: 'my', send: message => my.postMessage(message) };
  }
  const win = getGlobal('window');
  if (win && win.parent && win.parent !== win && typeof win.parent.postMessage === 'function') {
    return { channel: 'parent', send: message => win.parent.postMessage(message, '*') };
  }
  return { channel: 'none', send: null };
}

function pickPayload(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  if (event.data !== undefined) {
    return event.data;
  }
  const detail = event.detail;
  if (detail && Array.isArray(detail.data)) {
    return detail.data[0] ?? null;
  }
  if (detail && detail.data !== undefined) {
    return detail.data;
  }
  return event;
}

export function readMessage(event) {
  let payload = pickPayload(event);
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    }
    catch {
      return null;
    }
  }
  if (Array.isArray(payload)) {
    payload = payload[0];
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (payload.type === 'init') {
    return {
      type: 'init',
      requestId: payload.requestId ?? null,
      ok: true,
      currentCode: typeof payload.currentCode === 'string' ? payload.currentCode : '',
      count: payload.count === null || payload.count === undefined || payload.count === ''
        ? null
        : (Number.isFinite(Number(payload.count)) ? Number(payload.count) : null),
      message: typeof payload.message === 'string' ? payload.message : '',
    };
  }
  if (payload.type !== 'result') {
    return null;
  }
  return {
    type: 'result',
    requestId: payload.requestId ?? null,
    ok: Boolean(payload.ok),
    currentCode: typeof payload.currentCode === 'string' ? payload.currentCode : '',
    count: payload.count === null || payload.count === undefined || payload.count === ''
      ? null
      : (Number.isFinite(Number(payload.count)) ? Number(payload.count) : null),
    message: typeof payload.message === 'string' ? payload.message : '',
  };
}

export function detectReceiveChannel(listener) {
  const dd = getGlobal('dd');
  if (dd && typeof dd.postMessage === 'function') {
    try {
      dd.onMessage = listener;
      return {
        channel: 'dd',
        dispose() {
          try {
            dd.onMessage = null;
          }
          catch {
            // 忽略
          }
        },
      };
    }
    catch {
      // 落到下一个通道
    }
  }

  const my = getGlobal('my');
  if (my && typeof my.postMessage === 'function') {
    try {
      my.onMessage = listener;
      return {
        channel: 'my',
        dispose() {
          try {
            my.onMessage = null;
          }
          catch {
            // 忽略
          }
        },
      };
    }
    catch {
      // 落到下一个通道
    }
  }

  const win = getGlobal('window');
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('message', listener);
    return {
      channel: 'window',
      dispose() {
        win.removeEventListener('message', listener);
      },
    };
  }

  return { channel: 'none', dispose() {} };
}

export function createHostBridge(handlers = {}) {
  const sender = detectSendChannel();
  const onResult = typeof handlers.onResult === 'function' ? handlers.onResult : () => {};

  const listener = (event) => {
    const message = readMessage(event);
    if (message) {
      onResult(message);
    }
  };

  // 只有能发出的通道才算宿主；window 的 message 监听只是接收兜底，独立浏览器里不启用
  const hosted = sender.channel !== 'none';
  const receiver = hosted
    ? detectReceiveChannel(listener)
    : { channel: 'none', dispose() {} };

  function emit(message) {
    if (!sender.send) {
      return false;
    }
    try {
      sender.send(message);
      return true;
    }
    catch {
      return false;
    }
  }

  return {
    hosted,
    mode: hosted ? 'host' : 'standalone',
    channel: `${sender.channel}/${receiver.channel}`,
    sendCode(code, requestId) {
      return emit({ type: 'scan', code, requestId });
    },
    sendReady() {
      return emit({ type: 'ready' });
    },
    end() {
      return emit({ type: 'end' });
    },
    dispose() {
      receiver.dispose();
    },
  };
}
