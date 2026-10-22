export const DEDUPE_WINDOW_MS = 1500;
export const SCAN_INTERVAL_MS = 200;
export const DECODE_MAX_WIDTH = 1280;
export const TORCH_DEFAULT = false;
export const DEBUG_DEFAULT = false;

export const CONFIG_URL = new URL('../config.json', import.meta.url);

export const DEFAULT_CONFIG = Object.freeze({
  appName: '收货扫描',
  baseUrl: '',
  hostName: '',
  version: 'dev',
  debug: DEBUG_DEFAULT,
  dedupeWindowMs: DEDUPE_WINDOW_MS,
  scanIntervalMs: SCAN_INTERVAL_MS,
  decodeMaxWidth: DECODE_MAX_WIDTH,
  torchDefault: TORCH_DEFAULT,
});

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const text = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(text)) {
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

export function parseOverrides(search = '') {
  const params = new URLSearchParams(search);
  const overrides = {};

  if (params.has('debug')) {
    overrides.debug = toBool(params.get('debug'), DEFAULT_CONFIG.debug);
  }
  if (params.has('torch')) {
    overrides.torchDefault = toBool(params.get('torch'), DEFAULT_CONFIG.torchDefault);
  }
  if (params.has('dedupe')) {
    overrides.dedupeWindowMs = toNumber(params.get('dedupe'), DEFAULT_CONFIG.dedupeWindowMs, 0, 60_000);
  }
  if (params.has('interval')) {
    overrides.scanIntervalMs = toNumber(params.get('interval'), DEFAULT_CONFIG.scanIntervalMs, 30, 5000);
  }
  if (params.has('maxWidth')) {
    overrides.decodeMaxWidth = toNumber(params.get('maxWidth'), DEFAULT_CONFIG.decodeMaxWidth, 160, 4096);
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
    dedupeWindowMs: toNumber(raw.dedupeWindowMs, DEFAULT_CONFIG.dedupeWindowMs, 0, 60_000),
    scanIntervalMs: toNumber(raw.scanIntervalMs, DEFAULT_CONFIG.scanIntervalMs, 30, 5000),
    decodeMaxWidth: toNumber(raw.decodeMaxWidth, DEFAULT_CONFIG.decodeMaxWidth, 160, 4096),
    torchDefault: toBool(raw.torchDefault, DEFAULT_CONFIG.torchDefault),
  });
}

export async function loadConfig(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const search = options.search === undefined ? globalThis.location?.search ?? '' : options.search;
  let raw = {};

  if (typeof fetchImpl === 'function') {
    try {
      const response = await fetchImpl(CONFIG_URL, { cache: 'no-store' });
      if (response.ok) {
        raw = await response.json();
      }
    }
    catch {
      raw = {};
    }
  }

  return normalize({ ...raw, ...parseOverrides(search) });
}
