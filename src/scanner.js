import { DEDUPE_WINDOW_MS, SCAN_INTERVAL_MS } from './config.js';

const ZX = () => globalThis.ZXing;

const FORMAT_NAMES = ['QR_CODE', 'CODE_128'];

function supportedFormats(names = FORMAT_NAMES) {
  const zx = ZX();
  if (!zx) {
    return null;
  }
  return names.map(name => zx.BarcodeFormat[name]).filter(value => value !== undefined);
}

export function createZxingEngine(options = {}) {
  const zx = ZX();
  if (!zx || typeof zx.MultiFormatReader !== 'function' || typeof zx.BinaryBitmap !== 'function') {
    return null;
  }
  const reader = new zx.MultiFormatReader(false);
  const hints = new Map();
  const formats = supportedFormats(options.formats);
  if (formats && formats.length) {
    hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, formats);
  }
  hints.set(zx.DecodeHintType.TRY_HARDER, true);

  return {
    name: 'zxing',
    decode(canvas) {
      let source;
      try {
        source = new zx.HTMLCanvasElementLuminanceSource(canvas);
      }
      catch {
        return null;
      }
      const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(source));
      try {
        const result = reader.decode(bitmap, hints);
        const text = result.getText();
        return text ? { code: text, format: String(result.getBarcodeFormat()) } : null;
      }
      catch {
        return null;
      }
      finally {
        try {
          reader.reset();
        }
        catch {
        }
      }
    },
  };
}

export async function createBarcodeDetectorEngine(options = {}) {
  const Detector = globalThis.BarcodeDetector;
  if (typeof Detector !== 'function') {
    return null;
  }
  let detector;
  let formats = [];
  try {
    const supported = typeof Detector.getSupportedFormats === 'function'
      ? await Detector.getSupportedFormats()
      : [];
    const wanted = (options.formats || FORMAT_NAMES).map(name => name.toLowerCase());
    formats = wanted.filter(item => supported.includes(item));
    if (!formats.length) {
      return null;
    }
    detector = new Detector({ formats });
  }
  catch {
    return null;
  }

  return {
    name: 'barcode-detector',
    async decode(canvas) {
      try {
        const results = await detector.detect(canvas);
        const first = Array.isArray(results) ? results[0] : null;
        if (!first || !first.rawValue) {
          return null;
        }
        return { code: first.rawValue, format: String(first.format || '') };
      }
      catch {
        return null;
      }
    },
  };
}

export async function createEngine(options = {}) {
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

export async function createScanner(options = {}) {
  const video = options.video;
  const canvas = options.canvas || document.createElement('canvas');
  const engine = await (options.engine || createEngine(options));
  const intervalMs = options.intervalMs || SCAN_INTERVAL_MS;
  const maxWidth = options.maxWidth || 1280;
  const onCode = options.onCode || (() => {});
  const onError = options.onError || (() => {});
  const onFrame = options.onFrame || (() => {});

  const context = canvas.getContext('2d', { willReadFrequently: true });
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
      }
      catch {}
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
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('当前浏览器不支持相机接口，请使用手机浏览器并在 HTTPS 下打开');
    }
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
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
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play();
      }
    }
    catch (error) {
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
    if (!track || typeof track.getCapabilities !== 'function') {
      return false;
    }
    try {
      const caps = track.getCapabilities();
      return Boolean(caps && caps.torch);
    }
    catch {
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
    }
    catch {
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
      const scale = Math.max(rect.width / width, rect.height / height);
      const offsetX = (width * scale - rect.width) / 2;
      const offsetY = (height * scale - rect.height) / 2;
      const left = Math.max(rect.left, frame.left);
      const top = Math.max(rect.top, frame.top);
      const right = Math.min(rect.left + rect.width, frame.left + frame.width);
      const bottom = Math.min(rect.top + rect.height, frame.top + frame.height);
      if (right <= left || bottom <= top) {
        return null;
      }
      x = (left - rect.left + offsetX) / scale;
      y = (top - rect.top + offsetY) / scale;
      cropWidth = (right - left) / scale;
      cropHeight = (bottom - top) / scale;
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
          onCode({ code: String(raw.code), format: raw.format || '', elapsed });
        }
      }
    }
    catch (error) {
      if (running && id === generation) {
        onError(error);
      }
    }
    finally {
      if (running && id === generation) {
        timer = setTimeout(() => tick(id), intervalMs);
      }
    }
  }

  return {
    get engineName() {
      return engine ? engine.name : 'none';
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
        return Promise.reject(new Error('识码引擎未加载，无法识别条码'));
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
    },
  };
}

export function createDrawCanvas(documentRef = document) {
  const canvas = documentRef.createElement('canvas');
  canvas.getContext('2d', { willReadFrequently: true });
  return canvas;
}

export const __internal = { supportedFormats, FORMAT_NAMES, DEDUPE_WINDOW_MS };
