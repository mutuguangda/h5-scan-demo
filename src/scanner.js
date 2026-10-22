import { DEDUPE_WINDOW_MS, SCAN_INTERVAL_MS } from './config.js';

const ZX = () => globalThis.ZXing;

const FORMAT_NAMES = [
  'CODE_128',
  'CODE_39',
  'CODE_93',
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'ITF',
  'CODABAR',
  'QR_CODE',
  'DATA_MATRIX',
  'PDF_417',
  'AZTEC',
];

function supportedFormats() {
  const zx = ZX();
  if (!zx) {
    return null;
  }
  return FORMAT_NAMES.map(name => zx.BarcodeFormat[name]).filter(value => value !== undefined);
}

export function createZxingEngine() {
  const zx = ZX();
  if (!zx || typeof zx.MultiFormatReader !== 'function' || typeof zx.BinaryBitmap !== 'function') {
    return null;
  }
  const reader = new zx.MultiFormatReader(false);
  const hints = new Map();
  const formats = supportedFormats();
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
          // 忽略
        }
      }
    },
  };
}

export function createBarcodeDetectorEngine() {
  const Detector = globalThis.BarcodeDetector;
  if (typeof Detector !== 'function') {
    return null;
  }
  let formats = [];
  try {
    const supported = typeof Detector.getSupportedFormats === 'function'
      ? Detector.getSupportedFormats()
      : [];
    const wanted = ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'data_matrix', 'itf', 'codabar'];
    formats = wanted.filter(item => supported.includes(item));
    if (!formats.length) {
      return null;
    }
  }
  catch {
    return null;
  }

  const detector = new Detector({ formats });

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

export function createEngine() {
  const detector = createBarcodeDetectorEngine();
  if (detector) {
    return detector;
  }
  const zxing = createZxingEngine();
  if (zxing) {
    return zxing;
  }
  return null;
}

export function createScanner(options = {}) {
  const video = options.video;
  const canvas = options.canvas || document.createElement('canvas');
  const engine = options.engine || createEngine();
  const intervalMs = options.intervalMs || SCAN_INTERVAL_MS;
  const maxWidth = options.maxWidth || 1280;
  const onCode = options.onCode || (() => {});
  const onError = options.onError || (() => {});
  const onFrame = options.onFrame || (() => {});

  const context = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let timer = null;
  let running = false;
  let busy = false;
  let torchOn = false;

  function stopTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function releaseStream() {
    if (!stream) {
      return;
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      }
      catch {
        // 忽略
      }
    }
    stream = null;
    if (video) {
      video.srcObject = null;
    }
  }

  async function openCamera() {
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
    if (video) {
      video.srcObject = next;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play().catch(() => {});
    }
    stream = next;
    return next;
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
    const track = stream.getVideoTracks()[0];
    if (!track) {
      return false;
    }
    try {
      await track.applyConstraints({ advanced: [{ torch: Boolean(next) }] });
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
    const scale = Math.min(1, maxWidth / width);
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    return canvas;
  }

  async function tick() {
    if (!running) {
      return;
    }
    if (!busy) {
      busy = true;
      const start = performance.now();
      try {
        const frame = drawFrame();
        if (frame) {
          const raw = await Promise.resolve(engine ? engine.decode(frame) : null);
          const elapsed = performance.now() - start;
          onFrame({ raw, elapsed, engine: engine ? engine.name : 'none' });
          if (raw && raw.code) {
            onCode({ code: String(raw.code), format: raw.format || '', elapsed });
          }
        }
      }
      catch (error) {
        onError(error);
      }
      finally {
        busy = false;
      }
    }
    timer = setTimeout(tick, intervalMs);
  }

  return {
    get engineName() {
      return engine ? engine.name : 'none';
    },
    get running() {
      return running;
    },
    async start() {
      if (!engine) {
        throw new Error('识码引擎未加载，无法识别条码');
      }
      await openCamera();
      running = true;
      tick();
      return { torch: supportsTorch() };
    },
    async stop() {
      running = false;
      stopTimer();
      if (torchOn) {
        await setTorch(false);
      }
      releaseStream();
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
