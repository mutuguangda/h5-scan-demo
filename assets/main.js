"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/runtime.js
  var runtime = typeof window === "undefined" ? globalThis : window;

  // src/config.js
  var DEDUPE_WINDOW_MS = 1500;
  var SCAN_INTERVAL_MS = 200;
  var DECODE_MAX_WIDTH = 1280;
  var TORCH_DEFAULT = false;
  var DEBUG_DEFAULT = false;
  var CONFIG_URL = "config.json";
  var DEFAULT_CONFIG = Object.freeze({
    appName: "收货扫描",
    baseUrl: "",
    hostName: "",
    version: "dev",
    debug: DEBUG_DEFAULT,
    dedupeWindowMs: DEDUPE_WINDOW_MS,
    scanIntervalMs: SCAN_INTERVAL_MS,
    decodeMaxWidth: DECODE_MAX_WIDTH,
    torchDefault: TORCH_DEFAULT
  });
  function toBool(value, fallback) {
    if (value === void 0 || value === null || value === "") {
      return fallback;
    }
    const text = String(value).toLowerCase();
    if (["1", "true", "yes", "on"].includes(text)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(text)) {
      return false;
    }
    return fallback;
  }
  function toNumber(value, fallback, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, num));
  }
  function parseOverrides(search = "") {
    const params = new URLSearchParams(search);
    const overrides = {};
    if (params.has("debug")) {
      overrides.debug = toBool(params.get("debug"), DEFAULT_CONFIG.debug);
    }
    if (params.has("torch")) {
      overrides.torchDefault = toBool(params.get("torch"), DEFAULT_CONFIG.torchDefault);
    }
    if (params.has("dedupe")) {
      overrides.dedupeWindowMs = toNumber(params.get("dedupe"), DEFAULT_CONFIG.dedupeWindowMs, 0, 6e4);
    }
    if (params.has("interval")) {
      overrides.scanIntervalMs = toNumber(params.get("interval"), DEFAULT_CONFIG.scanIntervalMs, 30, 5e3);
    }
    if (params.has("maxWidth")) {
      overrides.decodeMaxWidth = toNumber(params.get("maxWidth"), DEFAULT_CONFIG.decodeMaxWidth, 160, 4096);
    }
    return overrides;
  }
  function normalize(raw = {}) {
    return Object.freeze({
      appName: raw.appName ? String(raw.appName) : DEFAULT_CONFIG.appName,
      baseUrl: raw.baseUrl ? String(raw.baseUrl) : DEFAULT_CONFIG.baseUrl,
      hostName: raw.hostName ? String(raw.hostName) : DEFAULT_CONFIG.hostName,
      version: raw.version ? String(raw.version) : DEFAULT_CONFIG.version,
      debug: toBool(raw.debug, DEFAULT_CONFIG.debug),
      dedupeWindowMs: toNumber(raw.dedupeWindowMs, DEFAULT_CONFIG.dedupeWindowMs, 0, 6e4),
      scanIntervalMs: toNumber(raw.scanIntervalMs, DEFAULT_CONFIG.scanIntervalMs, 30, 5e3),
      decodeMaxWidth: toNumber(raw.decodeMaxWidth, DEFAULT_CONFIG.decodeMaxWidth, 160, 4096),
      torchDefault: toBool(raw.torchDefault, DEFAULT_CONFIG.torchDefault)
    });
  }
  async function loadConfig(options = {}) {
    const fetchImpl = options.fetchImpl || runtime.fetch;
    const search = options.search === void 0 ? runtime.location ? runtime.location.search : "" : options.search;
    let raw = {};
    if (typeof fetchImpl === "function") {
      try {
        const response = await fetchImpl(CONFIG_URL, { cache: "no-store" });
        if (response.ok) {
          raw = await response.json();
        }
      } catch (e) {
        raw = {};
      }
    }
    return normalize(__spreadValues(__spreadValues({}, raw), parseOverrides(search)));
  }

  // src/dedupe.js
  function createDedupeState() {
    return Object.freeze({ lastCode: null, lastAt: Number.NEGATIVE_INFINITY });
  }
  function normalize2(code) {
    return typeof code === "string" ? code.trim() : "";
  }
  function shouldSend(code, now, state2 = createDedupeState(), windowMs = DEDUPE_WINDOW_MS) {
    const normalized = normalize2(code);
    if (!normalized) {
      return { send: false, reason: "empty" };
    }
    if (state2.lastCode === normalized && now - state2.lastAt < windowMs) {
      return { send: false, reason: "same-code-in-window" };
    }
    return { send: true, reason: state2.lastCode === normalized ? "window-expired" : "code-changed" };
  }
  function markSent(code, now) {
    return Object.freeze({ lastCode: normalize2(code), lastAt: now });
  }
  function accept(code, now, state2 = createDedupeState(), windowMs = DEDUPE_WINDOW_MS) {
    const decision = shouldSend(code, now, state2, windowMs);
    return decision.send ? __spreadProps(__spreadValues({}, decision), { state: markSent(code, now) }) : __spreadProps(__spreadValues({}, decision), { state: state2 });
  }

  // src/host-bridge.js
  function getGlobal(name) {
    return runtime[name];
  }
  function detectSendChannel() {
    const dd = getGlobal("dd");
    if (dd && typeof dd.postMessage === "function") {
      return { channel: "dd", send: (message) => dd.postMessage(message) };
    }
    const my = getGlobal("my");
    if (my && typeof my.postMessage === "function") {
      return { channel: "my", send: (message) => my.postMessage(message) };
    }
    const win = getGlobal("window");
    if (win && win.parent && win.parent !== win && typeof win.parent.postMessage === "function") {
      return { channel: "parent", send: (message) => win.parent.postMessage(message, "*") };
    }
    return { channel: "none", send: null };
  }
  function pickPayload(event) {
    if (!event || typeof event !== "object") {
      return null;
    }
    if (event.data !== void 0) {
      return event.data;
    }
    const detail = event.detail;
    if (detail && Array.isArray(detail.data)) {
      return detail.data.length ? detail.data[0] : null;
    }
    if (detail && detail.data !== void 0) {
      return detail.data;
    }
    return event;
  }
  function readMessage(event) {
    let payload = pickPayload(event);
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        return null;
      }
    }
    if (Array.isArray(payload)) {
      payload = payload[0];
    }
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (payload.type === "init") {
      return {
        type: "init",
        requestId: payload.requestId === void 0 || payload.requestId === null ? null : payload.requestId,
        ok: true,
        currentCode: typeof payload.currentCode === "string" ? payload.currentCode : "",
        count: payload.count === null || payload.count === void 0 || payload.count === "" ? null : Number.isFinite(Number(payload.count)) ? Number(payload.count) : null,
        message: typeof payload.message === "string" ? payload.message : ""
      };
    }
    if (payload.type !== "result") {
      return null;
    }
    return {
      type: "result",
      requestId: payload.requestId === void 0 || payload.requestId === null ? null : payload.requestId,
      ok: Boolean(payload.ok),
      currentCode: typeof payload.currentCode === "string" ? payload.currentCode : "",
      count: payload.count === null || payload.count === void 0 || payload.count === "" ? null : Number.isFinite(Number(payload.count)) ? Number(payload.count) : null,
      message: typeof payload.message === "string" ? payload.message : ""
    };
  }
  function detectReceiveChannel(listener) {
    const dd = getGlobal("dd");
    if (dd && typeof dd.postMessage === "function") {
      try {
        dd.onMessage = listener;
        return {
          channel: "dd",
          dispose() {
            try {
              dd.onMessage = null;
            } catch (e) {
            }
          }
        };
      } catch (e) {
      }
    }
    const my = getGlobal("my");
    if (my && typeof my.postMessage === "function") {
      try {
        my.onMessage = listener;
        return {
          channel: "my",
          dispose() {
            try {
              my.onMessage = null;
            } catch (e) {
            }
          }
        };
      } catch (e) {
      }
    }
    const win = getGlobal("window");
    if (win && typeof win.addEventListener === "function") {
      win.addEventListener("message", listener);
      return {
        channel: "window",
        dispose() {
          win.removeEventListener("message", listener);
        }
      };
    }
    return { channel: "none", dispose() {
    } };
  }
  function createHostBridge(handlers = {}) {
    const sender = detectSendChannel();
    const onResult = typeof handlers.onResult === "function" ? handlers.onResult : () => {
    };
    const listener = (event) => {
      const message = readMessage(event);
      if (message) {
        onResult(message);
      }
    };
    const hosted = sender.channel !== "none";
    const receiver = hosted ? detectReceiveChannel(listener) : { channel: "none", dispose() {
    } };
    function emit(message) {
      if (!sender.send) {
        return false;
      }
      try {
        sender.send(message);
        return true;
      } catch (e) {
        return false;
      }
    }
    return {
      hosted,
      mode: hosted ? "host" : "standalone",
      channel: "".concat(sender.channel, "/").concat(receiver.channel),
      sendCode(code, requestId) {
        return emit({ type: "scan", code, requestId });
      },
      sendReady() {
        return emit({ type: "ready" });
      },
      end() {
        return emit({ type: "end" });
      },
      dispose() {
        receiver.dispose();
      }
    };
  }

  // src/scanner.js
  var ZX = () => runtime.ZXing;
  var FORMAT_NAMES = ["QR_CODE", "CODE_128"];
  function supportedFormats(names = FORMAT_NAMES) {
    const zx = ZX();
    if (!zx) {
      return null;
    }
    return names.map((name) => zx.BarcodeFormat[name]).filter((value) => value !== void 0);
  }
  function createZxingEngine(options = {}) {
    const zx = ZX();
    if (!zx || typeof zx.MultiFormatReader !== "function" || typeof zx.BinaryBitmap !== "function") {
      return null;
    }
    const reader = new zx.MultiFormatReader(false);
    const hints = /* @__PURE__ */ new Map();
    const formats = supportedFormats(options.formats);
    if (formats && formats.length) {
      hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, formats);
    }
    hints.set(zx.DecodeHintType.TRY_HARDER, true);
    return {
      name: "zxing",
      decode(canvas) {
        let source;
        try {
          source = new zx.HTMLCanvasElementLuminanceSource(canvas);
        } catch (e) {
          return null;
        }
        const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(source));
        try {
          const result = reader.decode(bitmap, hints);
          const text = result.getText();
          return text ? { code: text, format: String(result.getBarcodeFormat()) } : null;
        } catch (e) {
          return null;
        } finally {
          try {
            reader.reset();
          } catch (e) {
          }
        }
      }
    };
  }
  async function createBarcodeDetectorEngine(options = {}) {
    const Detector = runtime.BarcodeDetector;
    if (typeof Detector !== "function") {
      return null;
    }
    let detector;
    let formats = [];
    try {
      const supported = typeof Detector.getSupportedFormats === "function" ? await Detector.getSupportedFormats() : [];
      const wanted = (options.formats || FORMAT_NAMES).map((name) => name.toLowerCase());
      formats = wanted.filter((item) => supported.includes(item));
      if (!formats.length) {
        return null;
      }
      detector = new Detector({ formats });
    } catch (e) {
      return null;
    }
    return {
      name: "barcode-detector",
      async decode(canvas) {
        try {
          const results = await detector.detect(canvas);
          const first = Array.isArray(results) ? results[0] : null;
          if (!first || !first.rawValue) {
            return null;
          }
          return { code: first.rawValue, format: String(first.format || "") };
        } catch (e) {
          return null;
        }
      }
    };
  }
  async function createEngine(options = {}) {
    const detector = await createBarcodeDetectorEngine(options);
    if (detector) {
      return detector;
    }
    const zxing = createZxingEngine(options);
    if (zxing) {
      return zxing;
    }
    return null;
  }
  async function createScanner(options = {}) {
    const video = options.video;
    const canvas = options.canvas || document.createElement("canvas");
    const engine = await (options.engine || createEngine(options));
    const intervalMs = options.intervalMs || SCAN_INTERVAL_MS;
    const maxWidth = options.maxWidth || 1280;
    const onCode = options.onCode || (() => {
    });
    const onError = options.onError || (() => {
    });
    const onFrame = options.onFrame || (() => {
    });
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let stream = null;
    let timer = null;
    let running = false;
    let generation = 0;
    let starting = null;
    let torchOn = false;
    function stopTimer() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }
    function releaseStream(target) {
      if (!target) {
        return;
      }
      for (const track of target.getTracks()) {
        try {
          track.stop();
        } catch (e) {
        }
      }
      if (video && video.srcObject === target) {
        video.srcObject = null;
      }
      if (stream === target) {
        stream = null;
        torchOn = false;
      }
    }
    async function openCamera(id) {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        throw new Error("当前浏览器不支持相机接口，请使用手机浏览器并在 HTTPS 下打开");
      }
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      if (id !== generation) {
        releaseStream(next);
        return false;
      }
      releaseStream(stream);
      stream = next;
      try {
        if (video) {
          video.srcObject = next;
          video.setAttribute("playsinline", "true");
          video.muted = true;
          await video.play();
        }
      } catch (error) {
        releaseStream(next);
        throw error;
      }
      if (id !== generation) {
        releaseStream(next);
        return false;
      }
      return true;
    }
    function supportsTorch() {
      if (!stream) {
        return false;
      }
      const track = stream.getVideoTracks()[0];
      if (!track || typeof track.getCapabilities !== "function") {
        return false;
      }
      try {
        const caps = track.getCapabilities();
        return Boolean(caps && caps.torch);
      } catch (e) {
        return false;
      }
    }
    async function setTorch(next) {
      if (!stream) {
        return false;
      }
      const current = stream;
      const track = current.getVideoTracks()[0];
      if (!track) {
        return false;
      }
      try {
        await track.applyConstraints({ advanced: [{ torch: Boolean(next) }] });
        if (stream !== current) {
          return false;
        }
        torchOn = Boolean(next);
        return true;
      } catch (e) {
        return false;
      }
    }
    function drawFrame() {
      if (!video || !context) {
        return null;
      }
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        return null;
      }
      let x = 0;
      let y = 0;
      let cropWidth = width;
      let cropHeight = height;
      if (options.frame) {
        const rect = video.getBoundingClientRect();
        const frame = options.frame.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          return null;
        }
        const scale2 = Math.max(rect.width / width, rect.height / height);
        const offsetX = (width * scale2 - rect.width) / 2;
        const offsetY = (height * scale2 - rect.height) / 2;
        const left = Math.max(rect.left, frame.left);
        const top = Math.max(rect.top, frame.top);
        const right = Math.min(rect.left + rect.width, frame.left + frame.width);
        const bottom = Math.min(rect.top + rect.height, frame.top + frame.height);
        if (right <= left || bottom <= top) {
          return null;
        }
        x = (left - rect.left + offsetX) / scale2;
        y = (top - rect.top + offsetY) / scale2;
        cropWidth = (right - left) / scale2;
        cropHeight = (bottom - top) / scale2;
      }
      const scale = Math.min(1, maxWidth / cropWidth);
      const targetWidth = Math.max(1, Math.round(cropWidth * scale));
      const targetHeight = Math.max(1, Math.round(cropHeight * scale));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      context.drawImage(video, x, y, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);
      return canvas;
    }
    async function tick(id) {
      if (!running || id !== generation) {
        return;
      }
      const start = performance.now();
      try {
        const frame = drawFrame();
        if (frame) {
          const raw = await engine.decode(frame);
          if (!running || id !== generation) {
            return;
          }
          const elapsed = performance.now() - start;
          onFrame({ raw, elapsed, engine: engine.name });
          if (running && id === generation && raw && raw.code) {
            onCode({ code: String(raw.code), format: raw.format || "", elapsed });
          }
        }
      } catch (error) {
        if (running && id === generation) {
          onError(error);
        }
      } finally {
        if (running && id === generation) {
          timer = setTimeout(() => tick(id), intervalMs);
        }
      }
    }
    return {
      get engineName() {
        return engine ? engine.name : "none";
      },
      get running() {
        return running;
      },
      start() {
        if (starting) {
          return starting;
        }
        if (running) {
          return Promise.resolve({ torch: supportsTorch() });
        }
        if (!engine) {
          return Promise.reject(new Error("识码引擎未加载，无法识别条码"));
        }
        const id = ++generation;
        const pending = (async () => {
          if (!await openCamera(id)) {
            return { torch: false };
          }
          running = true;
          tick(id);
          return { torch: supportsTorch() };
        })();
        starting = pending;
        const clear = () => {
          if (starting === pending) {
            starting = null;
          }
        };
        pending.then(clear, clear);
        return pending;
      },
      async stop() {
        ++generation;
        running = false;
        starting = null;
        stopTimer();
        releaseStream(stream);
      },
      supportsTorch,
      setTorch,
      get torchOn() {
        return torchOn;
      }
    };
  }
  function createDrawCanvas(documentRef = document) {
    const canvas = documentRef.createElement("canvas");
    canvas.getContext("2d", { willReadFrequently: true });
    return canvas;
  }

  // src/ui.js
  function createUi(documentRef = document) {
    const $ = (id) => documentRef.getElementById(id);
    const elements = {
      video: $("video"),
      frame: $("frame"),
      currentCode: $("current-code"),
      count: $("count"),
      status: $("status"),
      torch: $("torch"),
      app: $("app"),
      end: $("end"),
      debug: $("debug"),
      debugClose: $("debug-close"),
      overlay: $("overlay"),
      overlayTitle: $("overlay-title"),
      overlayText: $("overlay-text"),
      restart: $("restart"),
      dbgEngine: $("dbg-engine"),
      dbgRaw: $("dbg-raw"),
      dbgDuration: $("dbg-duration"),
      dbgDedupe: $("dbg-dedupe"),
      dbgMessage: $("dbg-message"),
      dbgMode: $("dbg-mode"),
      dbgConfig: $("dbg-config")
    };
    function setStatus(text, tone = "info") {
      if (!elements.status) {
        return;
      }
      elements.status.textContent = text;
      elements.status.dataset.tone = tone;
    }
    function setCurrentCode(code) {
      if (!elements.currentCode) {
        return;
      }
      elements.currentCode.textContent = code || "";
    }
    function setCount(count) {
      if (!elements.count) {
        return;
      }
      elements.count.textContent = String(Number.isFinite(count) ? count : 0);
    }
    function setTorchState({ visible, on }) {
      if (!elements.torch) {
        return;
      }
      if (visible) {
        elements.torch.hidden = false;
        elements.torch.disabled = false;
      } else {
        elements.torch.hidden = true;
        elements.torch.disabled = true;
      }
      elements.torch.setAttribute("aria-pressed", on ? "true" : "false");
      elements.torch.classList.toggle("is-on", Boolean(on));
    }
    function setDebugOpen(open) {
      if (elements.debug) {
        elements.debug.hidden = !open;
        elements.app.classList.toggle("is-debug", open);
      }
    }
    function setDebug(field, text) {
      const map = {
        engine: elements.dbgEngine,
        raw: elements.dbgRaw,
        duration: elements.dbgDuration,
        dedupe: elements.dbgDedupe,
        message: elements.dbgMessage,
        mode: elements.dbgMode,
        config: elements.dbgConfig
      };
      const target = map[field];
      if (target) {
        target.textContent = text;
      }
    }
    function showOverlay(title, text) {
      if (!elements.overlay) {
        return;
      }
      if (elements.overlayTitle) {
        elements.overlayTitle.textContent = title;
      }
      if (elements.overlayText) {
        elements.overlayText.textContent = text;
      }
      elements.overlay.hidden = false;
    }
    function hideOverlay() {
      if (elements.overlay) {
        elements.overlay.hidden = true;
      }
    }
    return {
      elements,
      setStatus,
      setCurrentCode,
      setCount,
      setTorchState,
      setDebugOpen,
      setDebug,
      showOverlay,
      hideOverlay,
      on(id, event, handler) {
        const target = elements[id];
        if (target) {
          target.addEventListener(event, handler);
        }
      }
    };
  }

  // src/main.js
  var ui = createUi(document);
  var SCAN_HINT = "请将二维码置于取景框内扫描";
  var state = {
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
    currentCode: "",
    hintTimer: null
  };
  function updateStatus(text, tone = "info") {
    ui.setStatus(text, tone);
  }
  function onHostResult(message) {
    if (state.ended || state.disposed) {
      return;
    }
    ui.setDebug("message", JSON.stringify(message));
    if (message.count !== null) {
      state.count = Math.max(state.count, message.count);
      ui.setCount(state.count);
    }
    if (message.type === "init") {
      if (!state.requestId) {
        ui.setCurrentCode(message.currentCode);
      }
      return;
    }
    const matches = message.requestId !== null ? message.requestId === state.requestId : message.currentCode === state.currentCode;
    if (!matches) {
      return;
    }
    clearTimeout(state.hintTimer);
    ui.setCurrentCode(message.ok ? "" : message.currentCode);
    updateStatus(message.message || (message.ok ? "已接收" : "录入失败，请重试"), message.ok ? "ok" : "warn");
    scheduleHintRestore();
  }
  function scheduleHintRestore() {
    clearTimeout(state.hintTimer);
    if (!state.ended && !state.disposed) {
      state.hintTimer = setTimeout(() => {
        if (state.scanner && state.scanner.running) {
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
    ui.setDebug("raw", result.format ? "".concat(result.code, " (").concat(result.format, ")") : result.code);
    ui.setDebug("dedupe", decision.send ? "发送 · ".concat(decision.reason) : "抑制 · ".concat(decision.reason));
    if (!decision.send) {
      return;
    }
    clearTimeout(state.hintTimer);
    state.currentCode = result.code;
    state.requestId += 1;
    ui.setCurrentCode(result.code);
    if (state.bridge.hosted) {
      const sent = state.bridge.sendCode(result.code, state.requestId);
      updateStatus(sent ? "正在查询包装详情…" : "发送失败，请返回收货页重新打开", sent ? "info" : "error");
      return;
    }
    state.count += 1;
    ui.setCount(state.count);
    updateStatus("已识别 ".concat(result.code), "ok");
    scheduleHintRestore();
  }
  async function applyTorch() {
    if (!(state.scanner && state.scanner.running) || ui.elements.torch.disabled) {
      return;
    }
    ui.elements.torch.disabled = true;
    const next = !state.scanner.torchOn;
    const ok = await state.scanner.setTorch(next);
    if (!state.scanner.running) {
      return;
    }
    ui.setTorchState({ visible: ok, on: ok && next });
    updateStatus(ok ? next ? "闪光灯已打开" : "闪光灯已关闭" : "当前设备不支持闪光灯", ok ? "info" : "warn");
    scheduleHintRestore();
  }
  async function stopCamera() {
    state.startAttempt += 1;
    state.starting = false;
    ui.elements.restart.disabled = false;
    clearTimeout(state.hintTimer);
    ui.elements.app.classList.remove("is-scanning");
    ui.setTorchState({ visible: false, on: false });
    if (state.scanner) {
      await state.scanner.stop();
    }
  }
  function cameraError(error) {
    const messages = {
      NotFoundError: "未找到可用相机，请在有摄像头的手机上打开。",
      DevicesNotFoundError: "未找到可用相机，请在有摄像头的手机上打开。",
      NotAllowedError: "相机权限未开启，请在浏览器或钉钉设置中允许使用相机后重试。",
      PermissionDeniedError: "相机权限未开启，请允许使用相机后重试。",
      NotReadableError: "相机可能被其他应用占用，请关闭占用相机的应用后重试。",
      TrackStartError: "相机可能被其他应用占用，请关闭其他应用后重试。",
      SecurityError: "当前环境无法使用相机，请通过 HTTPS 或 localhost 打开。",
      OverconstrainedError: "相机不支持当前参数，请更换设备后重试。"
    };
    return messages[error && error.name] || "无法启动相机，请检查设备和相机权限后重试。";
  }
  async function startCamera() {
    if (state.starting || state.ended || state.disposed || document.hidden) {
      return;
    }
    const attempt = ++state.startAttempt;
    state.starting = true;
    ui.elements.restart.disabled = true;
    ui.setTorchState({ visible: false, on: false });
    updateStatus("正在启动相机…");
    try {
      const info = await state.scanner.start();
      if (attempt !== state.startAttempt || state.ended || state.disposed || document.hidden || !state.scanner.running) {
        return;
      }
      ui.hideOverlay();
      ui.elements.app.classList.add("is-scanning");
      ui.setTorchState({ visible: info.torch, on: false });
      if (state.config.torchDefault && info.torch) {
        await applyTorch();
      }
      updateStatus(SCAN_HINT);
    } catch (error) {
      if (attempt !== state.startAttempt || state.ended || state.disposed || document.hidden) {
        return;
      }
      const message = cameraError(error);
      ui.setDebug("message", "".concat(error && error.name || "Error", ": ").concat(error && error.message || error));
      updateStatus(message, "error");
      ui.showOverlay("相机不可用", message);
    } finally {
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
    updateStatus("已结束扫描，相机已停止");
    ui.showOverlay("已结束扫描", notified ? "正在返回收货页面；若未自动返回，请点击小程序左上角返回。" : "相机已停止，可点下方按钮重新开始。");
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
    ui.setCurrentCode("");
    await startCamera();
  }
  function dispose() {
    state.disposed = true;
    if (state.bridge) {
      state.bridge.dispose();
    }
    void stopCamera();
  }
  async function boot() {
    state.config = await loadConfig();
    state.bridge = createHostBridge({ onResult: onHostResult });
    ui.setDebugOpen(state.config.debug);
    ui.setDebug("mode", state.bridge.hosted ? "宿主模式 (".concat(state.config.hostName || "dingtalk", " · ").concat(state.bridge.channel, ")") : "独立浏览器模式");
    ui.setDebug("config", "同码窗口 ".concat(state.config.dedupeWindowMs, "ms · 扫描间隔 ").concat(state.config.scanIntervalMs, "ms · 解码宽度 ").concat(state.config.decodeMaxWidth, "px"));
    ui.on("torch", "click", applyTorch);
    ui.on("end", "click", endScan);
    ui.on("restart", "click", restart);
    ui.on("debugClose", "click", () => ui.setDebugOpen(false));
    state.scanner = await createScanner({
      video: ui.elements.video,
      frame: ui.elements.frame,
      canvas: createDrawCanvas(document),
      intervalMs: state.config.scanIntervalMs,
      maxWidth: state.config.decodeMaxWidth,
      onCode: handleCode,
      onFrame: ({ elapsed, engine }) => {
        if (!ui.elements.debug.hidden) {
          ui.setDebug("engine", engine);
          ui.setDebug("duration", "".concat(elapsed.toFixed(1), " ms"));
        }
      },
      onError: (error) => ui.setDebug("message", String(error && error.message || error))
    });
    ui.setDebug("engine", state.scanner.engineName);
    if (state.scanner.engineName === "none") {
      updateStatus("识码引擎不可用，请重新加载页面", "error");
      return;
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        void stopCamera();
      } else {
        void startCamera();
      }
    });
    window.addEventListener("pagehide", dispose);
    window.addEventListener("pageshow", (event) => {
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
    updateStatus(error && error.message || "页面初始化失败，请重新加载", "error");
  });
})();
