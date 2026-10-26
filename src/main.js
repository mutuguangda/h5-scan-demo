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
  hintTimer: null,
};

function describeConfig(config) {
  const parts = [`同码窗口 ${config.dedupeWindowMs}ms`, `扫描间隔 ${config.scanIntervalMs}ms`, `解码宽度 ${config.decodeMaxWidth}px`];
  if (config.baseUrl) {
    parts.push(`部署地址 ${config.baseUrl}`);
  }
  return parts.join(' · ');
}

function updateStatus(text, tone = 'info') {
  ui.setStatus(text, tone);
}

function onHostResult(message) {
  clearTimeout(state.hintTimer);
  if (message.count !== null) {
    state.count = message.count;
    ui.setCount(state.count);
  }
  if (message.ok) {
    ui.setCurrentCode(message.currentCode || '');
  }
  if (message.message) {
    updateStatus(message.message, message.ok ? 'ok' : 'warn');
  }
  else if (message.ok) {
    updateStatus(`已接收 ${message.currentCode || ''}`.trim(), 'ok');
  }
  ui.setDebug('message', JSON.stringify(message));
}

function scheduleHintRestore() {
  if (state.ended) {
    return;
  }
  clearTimeout(state.hintTimer);
  state.hintTimer = setTimeout(() => {
    if (!state.ended) {
      updateStatus(SCAN_HINT);
    }
  }, 1600);
}

function handleCode(result) {
  const now = performance.now();
  const decision = accept(result.code, now, state.dedupe, state.config.dedupeWindowMs);
  state.dedupe = decision.state;

  const raw = result.format ? `${result.code} (${result.format})` : result.code;
  ui.setDebug('raw', raw);
  ui.setDebug('dedupe', decision.send ? `发送 · ${decision.reason}` : `抑制 · ${decision.reason}`);

  if (!decision.send) {
    return;
  }

  ui.setCurrentCode(result.code);

  if (state.bridge.hosted) {
    const sent = state.bridge.sendCode(result.code);
    updateStatus(sent ? '正在查询包装详情…' : '发送失败，请返回收货页重新打开', sent ? 'info' : 'error');
    return;
  }

  state.count += 1;
  ui.setCount(state.count);
  updateStatus(`已识别 ${result.code}`, 'ok');
  scheduleHintRestore();
}

function handleFrame({ elapsed, engine }) {
  ui.setDebug('engine', engine);
  ui.setDebug('duration', `${elapsed.toFixed(1)} ms`);
}

async function applyTorch() {
  if (!state.scanner) {
    return;
  }
  const next = !state.scanner.torchOn;
  const ok = await state.scanner.setTorch(next);
  if (ok) {
    ui.setTorchState({ visible: true, on: next });
    updateStatus(next ? '闪光灯已打开' : '闪光灯已关闭');
  }
  else {
    ui.setTorchState({ visible: false, on: false });
    updateStatus('当前设备不支持闪光灯', 'warn');
  }
}

async function stopCamera(message) {
  if (state.scanner) {
    try {
      await state.scanner.stop();
    }
    catch {
      // 停止失败不影响页面收尾
    }
  }
  ui.setTorchState({ visible: false, on: false });
  updateStatus(message);
}

async function endScan() {
  if (state.ended) {
    return;
  }
  state.ended = true;
  const notified = state.bridge.end();
  await stopCamera(notified ? '已通知小程序结束扫描' : '已结束扫描，相机已停止');
  ui.showOverlay(
    '已结束扫描',
    notified ? '正在返回收货页面；若未自动返回，请点击小程序左上角返回。' : '相机已停止，可点下方按钮重新开始。',
  );
}

async function startCamera() {
  const torchInfo = await state.scanner.start();
  ui.setTorchState({ visible: torchInfo.torch, on: false });
  if (state.config.torchDefault && torchInfo.torch) {
    await applyTorch();
  }
  updateStatus(SCAN_HINT);
}

async function restart() {
  state.ended = false;
  state.dedupe = createDedupeState();
  if (!state.bridge.hosted) {
    state.count = 0;
  }
  ui.hideOverlay();
  ui.setCount(state.count);
  ui.setCurrentCode('');
  try {
    await startCamera();
  }
  catch (error) {
    updateStatus(error && error.message ? error.message : '无法打开相机', 'error');
  }
}

function bindControls() {
  ui.on('torch', 'click', applyTorch);
  ui.on('end', 'click', endScan);
  ui.on('restart', 'click', restart);
  ui.on('debugToggle', 'click', () => {
    const willOpen = ui.elements.debug ? ui.elements.debug.hidden : false;
    ui.setDebugOpen(willOpen);
  });
  ui.on('debugClose', 'click', () => ui.setDebugOpen(false));
}

async function boot() {
  state.config = await loadConfig();
  state.bridge = createHostBridge({ onResult: onHostResult });

  ui.setDebug(
    'mode',
    state.bridge.hosted
      ? `宿主模式 (${state.config.hostName || 'dingtalk'} · ${state.bridge.channel})`
      : '独立浏览器模式',
  );
  ui.setDebug('config', describeConfig(state.config));
  ui.setDebug('engine', '检测中');
  ui.setDebugOpen(state.config.debug);
  ui.setCount(0);

  bindControls();

  state.scanner = createScanner({
    video: ui.elements.video,
    canvas: createDrawCanvas(document),
    intervalMs: state.config.scanIntervalMs,
    maxWidth: state.config.decodeMaxWidth,
    onCode: handleCode,
    onFrame: handleFrame,
    onError: error => updateStatus(error && error.message ? error.message : '识码异常', 'warn'),
  });

  ui.setDebug('engine', state.scanner.engineName);
  if (state.scanner.engineName === 'none') {
    updateStatus('识码引擎不可用，请确认 vendor/zxing.min.js 已加载', 'error');
    return;
  }

  try {
    await startCamera();
  }
  catch (error) {
    updateStatus(error && error.message ? error.message : '无法打开相机，请检查浏览器权限', 'error');
    ui.showOverlay('相机不可用', '请确认已允许相机权限，并使用 HTTPS 或 localhost 打开本页面。');
  }
}

boot().catch((error) => {
  updateStatus(error && error.message ? error.message : '页面初始化失败', 'error');
});
