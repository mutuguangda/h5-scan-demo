import { loadConfig } from './config.js';
import { accept, createDedupeState } from './dedupe.js';
import { createHostBridge } from './host-bridge.js';
import { createDrawCanvas, createScanner } from './scanner.js';
import { createUi } from './ui.js';

const ui = createUi(document);
const SCAN_HINT = '请将二维码置于取景框内扫描';
const state = {
  config: null,
  scanner: null,
  bridge: null,
  dedupe: createDedupeState(),
  count: 0,
  ended: false,
  starting: false,
  startAttempt: 0,
  disposed: false,
  requestId: 0,
  currentCode: '',
  hintTimer: null,
};

function updateStatus(text, tone = 'info') {
  ui.setStatus(text, tone);
}

function onHostResult(message) {
  if (state.ended || state.disposed) {
    return;
  }
  ui.setDebug('message', JSON.stringify(message));
  if (message.count !== null) {
    state.count = Math.max(state.count, message.count);
    ui.setCount(state.count);
  }
  if (message.type === 'init') {
    if (!state.requestId) {
      ui.setCurrentCode(message.currentCode);
    }
    return;
  }
  const matches = message.requestId !== null
    ? message.requestId === state.requestId
    : message.currentCode === state.currentCode;
  if (!matches) {
    return;
  }
  clearTimeout(state.hintTimer);
  ui.setCurrentCode(message.ok ? '' : message.currentCode);
  updateStatus(message.message || (message.ok ? '已接收' : '录入失败，请重试'), message.ok ? 'ok' : 'warn');
  scheduleHintRestore();
}

function scheduleHintRestore() {
  clearTimeout(state.hintTimer);
  if (!state.ended && !state.disposed) {
    state.hintTimer = setTimeout(() => {
      if (state.scanner?.running) {
        updateStatus(SCAN_HINT);
      }
    }, 1600);
  }
}

function handleCode(result) {
  if (state.ended || state.disposed || document.hidden) {
    return;
  }
  const decision = accept(result.code, performance.now(), state.dedupe, state.config.dedupeWindowMs);
  state.dedupe = decision.state;
  ui.setDebug('raw', result.format ? `${result.code} (${result.format})` : result.code);
  ui.setDebug('dedupe', decision.send ? `发送 · ${decision.reason}` : `抑制 · ${decision.reason}`);
  if (!decision.send) {
    return;
  }
  clearTimeout(state.hintTimer);
  state.currentCode = result.code;
  state.requestId += 1;
  ui.setCurrentCode(result.code);
  if (state.bridge.hosted) {
    const sent = state.bridge.sendCode(result.code, state.requestId);
    updateStatus(sent ? '正在查询包装详情…' : '发送失败，请返回收货页重新打开', sent ? 'info' : 'error');
    return;
  }
  state.count += 1;
  ui.setCount(state.count);
  updateStatus(`已识别 ${result.code}`, 'ok');
  scheduleHintRestore();
}

async function applyTorch() {
  if (!state.scanner?.running || ui.elements.torch.disabled) {
    return;
  }
  ui.elements.torch.disabled = true;
  const next = !state.scanner.torchOn;
  const ok = await state.scanner.setTorch(next);
  if (!state.scanner.running) {
    return;
  }
  ui.setTorchState({ visible: ok, on: ok && next });
  updateStatus(ok ? (next ? '闪光灯已打开' : '闪光灯已关闭') : '当前设备不支持闪光灯', ok ? 'info' : 'warn');
  scheduleHintRestore();
}

async function stopCamera() {
  state.startAttempt += 1;
  state.starting = false;
  ui.elements.restart.disabled = false;
  clearTimeout(state.hintTimer);
  ui.elements.app.classList.remove('is-scanning');
  ui.setTorchState({ visible: false, on: false });
  await state.scanner?.stop();
}

function cameraError(error) {
  const messages = {
    NotFoundError: '未找到可用相机，请在有摄像头的手机上打开。',
    DevicesNotFoundError: '未找到可用相机，请在有摄像头的手机上打开。',
    NotAllowedError: '相机权限未开启，请在浏览器或钉钉设置中允许使用相机后重试。',
    PermissionDeniedError: '相机权限未开启，请允许使用相机后重试。',
    NotReadableError: '相机可能被其他应用占用，请关闭占用相机的应用后重试。',
    TrackStartError: '相机可能被其他应用占用，请关闭其他应用后重试。',
    SecurityError: '当前环境无法使用相机，请通过 HTTPS 或 localhost 打开。',
    OverconstrainedError: '相机不支持当前参数，请更换设备后重试。',
  };
  return messages[error?.name] || '无法启动相机，请检查设备和相机权限后重试。';
}

async function startCamera() {
  if (state.starting || state.ended || state.disposed || document.hidden) {
    return;
  }
  const attempt = ++state.startAttempt;
  state.starting = true;
  ui.elements.restart.disabled = true;
  ui.setTorchState({ visible: false, on: false });
  updateStatus('正在启动相机…');
  try {
    const info = await state.scanner.start();
    if (attempt !== state.startAttempt || state.ended || state.disposed || document.hidden || !state.scanner.running) {
      return;
    }
    ui.hideOverlay();
    ui.elements.app.classList.add('is-scanning');
    ui.setTorchState({ visible: info.torch, on: false });
    if (state.config.torchDefault && info.torch) {
      await applyTorch();
    }
    updateStatus(SCAN_HINT);
  }
  catch (error) {
    if (attempt !== state.startAttempt || state.ended || state.disposed || document.hidden) {
      return;
    }
    const message = cameraError(error);
    ui.setDebug('message', `${error?.name || 'Error'}: ${error?.message || error}`);
    updateStatus(message, 'error');
    ui.showOverlay('相机不可用', message);
  }
  finally {
    if (attempt === state.startAttempt) {
      state.starting = false;
      ui.elements.restart.disabled = false;
    }
  }
}

async function endScan() {
  if (state.ended) {
    return;
  }
  state.ended = true;
  const notified = state.bridge.end();
  await stopCamera();
  updateStatus('已结束扫描，相机已停止');
  ui.showOverlay('已结束扫描', notified ? '正在返回收货页面；若未自动返回，请点击小程序左上角返回。' : '相机已停止，可点下方按钮重新开始。');
}

async function restart() {
  if (state.starting) {
    return;
  }
  state.ended = false;
  state.dedupe = createDedupeState();
  if (!state.bridge.hosted) {
    state.count = 0;
  }
  ui.setCount(state.count);
  ui.setCurrentCode('');
  await startCamera();
}

function dispose() {
  state.disposed = true;
  state.bridge?.dispose();
  void stopCamera();
}

async function boot() {
  state.config = await loadConfig();
  state.bridge = createHostBridge({ onResult: onHostResult });
  ui.setDebugOpen(state.config.debug);
  ui.setDebug('mode', state.bridge.hosted ? `宿主模式 (${state.config.hostName || 'dingtalk'} · ${state.bridge.channel})` : '独立浏览器模式');
  ui.setDebug('config', `同码窗口 ${state.config.dedupeWindowMs}ms · 扫描间隔 ${state.config.scanIntervalMs}ms · 解码宽度 ${state.config.decodeMaxWidth}px`);
  ui.on('torch', 'click', applyTorch);
  ui.on('end', 'click', endScan);
  ui.on('restart', 'click', restart);
  ui.on('debugClose', 'click', () => ui.setDebugOpen(false));
  state.scanner = await createScanner({
    video: ui.elements.video,
    frame: ui.elements.frame,
    canvas: createDrawCanvas(document),
    intervalMs: state.config.scanIntervalMs,
    maxWidth: state.config.decodeMaxWidth,
    onCode: handleCode,
    onFrame: ({ elapsed, engine }) => {
      if (!ui.elements.debug.hidden) {
        ui.setDebug('engine', engine);
        ui.setDebug('duration', `${elapsed.toFixed(1)} ms`);
      }
    },
    onError: error => ui.setDebug('message', String(error?.message || error)),
  });
  ui.setDebug('engine', state.scanner.engineName);
  if (state.scanner.engineName === 'none') {
    updateStatus('识码引擎不可用，请重新加载页面', 'error');
    return;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      void stopCamera();
    }
    else {
      void startCamera();
    }
  });
  window.addEventListener('pagehide', dispose);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      state.disposed = false;
      state.bridge = createHostBridge({ onResult: onHostResult });
      state.bridge.sendReady();
      void startCamera();
    }
  });
  state.bridge.sendReady();
  await startCamera();
}

boot().catch((error) => {
  updateStatus(error?.message || '页面初始化失败，请重新加载', 'error');
});
