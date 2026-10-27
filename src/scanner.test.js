import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBarcodeDetectorEngine, createEngine, createScanner, createZxingEngine } from './scanner.js';

function mockGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (original)
      Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(t, getUserMedia, overrides = {}) {
  t.mock.method(globalThis, 'setTimeout', () => 1);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  t.after(() => {
    if (original)
      Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
  const draws = [];
  const video = {
    videoWidth: 1920,
    videoHeight: 1080,
    srcObject: null,
    setAttribute() {},
    async play() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 600 }),
    ...overrides,
  };
  const canvas = { getContext: () => ({ drawImage: (...args) => draws.push(args) }) };
  return { video, canvas, draws, engine: { name: 'test', decode: () => null } };
}

function media() {
  let stops = 0;
  const track = { stop() { stops++; } };
  return { getTracks: () => [track], getVideoTracks: () => [track], get stops() { return stops; } };
}

async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

test('native support is awaited and constructor failures fall back to ZXing', async (t) => {
  const support = deferred();
  let formats;
  class Detector {
    static getSupportedFormats() { return support.promise; }
    constructor(options) { formats = options.formats; }
    async detect() { return [{ rawValue: '123', format: 'code_128' }]; }
  }
  mockGlobal(t, 'BarcodeDetector', Detector);
  const pending = createBarcodeDetectorEngine();
  support.resolve(['qr_code', 'code_128', 'ean_13']);
  const engine = await pending;
  assert.deepEqual(formats, ['qr_code', 'code_128']);
  assert.equal((await engine.decode({})).code, '123');
  mockGlobal(t, 'ZXing', { MultiFormatReader: class {}, BinaryBitmap: class {}, BarcodeFormat: { QR_CODE: 1, CODE_128: 2 }, DecodeHintType: {} });
  mockGlobal(t, 'BarcodeDetector', class extends Detector { constructor() { throw new Error('unsupported'); } });
  assert.equal((await createEngine()).name, 'zxing');
  assert.equal(createZxingEngine().name, 'zxing');
});

test('unsupported and rejected native formats return null', async (t) => {
  mockGlobal(t, 'BarcodeDetector', class { static async getSupportedFormats() { return ['ean_13']; } });
  assert.equal(await createBarcodeDetectorEngine(), null);
  mockGlobal(t, 'BarcodeDetector', class { static async getSupportedFormats() { throw new Error('failed'); } });
  assert.equal(await createBarcodeDetectorEngine(), null);
});

test('duplicate starts share acquisition; stop releases a late stream', async (t) => {
  const request = deferred();
  let calls = 0;
  const f = fixture(t, () => { calls++; return request.promise; });
  const scanner = await createScanner(f);
  const first = scanner.start();
  assert.equal(scanner.start(), first);
  await scanner.stop();
  const stream = media();
  request.resolve(stream);
  await first;
  assert.equal(calls, 1);
  assert.equal(stream.stops, 1);
  assert.equal(scanner.running, false);
  assert.equal(f.video.srcObject, null);
});

test('restart keeps new stream when old acquisition resolves', async (t) => {
  const old = deferred();
  const fresh = media();
  let calls = 0;
  const f = fixture(t, () => ++calls === 1 ? old.promise : Promise.resolve(fresh));
  const scanner = await createScanner(f);
  const first = scanner.start();
  await scanner.stop();
  await scanner.start();
  await scanner.start();
  const stale = media();
  old.resolve(stale);
  await first;
  assert.equal(calls, 2);
  assert.equal(stale.stops, 1);
  assert.equal(f.video.srcObject, fresh);
  assert.equal(scanner.running, true);
  await scanner.stop();
  assert.equal(fresh.stops, 1);
});

test('play failures reject and release camera; retry works', async (t) => {
  const first = media();
  const second = media();
  let calls = 0;
  const f = fixture(t, async () => ++calls === 1 ? first : second, { async play() {
    if (calls === 1)
      throw new Error('play failed');
  } });
  const scanner = await createScanner(f);
  await assert.rejects(scanner.start(), /play failed/);
  assert.equal(first.stops, 1);
  assert.equal(f.video.srcObject, null);
  assert.equal(scanner.running, false);
  await scanner.start();
  assert.equal(scanner.running, true);
  await scanner.stop();
});

test('stop suppresses late decode callbacks and supports restart', async (t) => {
  const result = deferred();
  const f = fixture(t, async () => media());
  let codes = 0;
  let frames = 0;
  f.engine.decode = () => result.promise;
  const scanner = await createScanner({ ...f, onCode: () => codes++, onFrame: () => frames++ });
  await scanner.start();
  await scanner.stop();
  result.resolve({ code: 'stale' });
  await flush();
  assert.equal(codes, 0);
  assert.equal(frames, 0);
  f.engine.decode = () => ({ code: 'fresh' });
  await scanner.start();
  await flush();
  assert.equal(codes, 1);
  await scanner.stop();
});

test('cover ROI maps centered portrait viewport to source pixels', async (t) => {
  const f = fixture(t, async () => media());
  const frame = { getBoundingClientRect: () => ({ left: 50, top: 200, width: 200, height: 100 }) };
  const scanner = await createScanner({ ...f, frame, maxWidth: 180 });
  await scanner.start();
  const [, x, y, width, height, dx, dy, targetWidth, targetHeight] = f.draws[0];
  assert.equal(x, 780);
  assert.equal(y, 360);
  assert.equal(width, 360);
  assert.equal(height, 180);
  assert.deepEqual([dx, dy, targetWidth, targetHeight], [0, 0, 180, 90]);
  await scanner.stop();
});
