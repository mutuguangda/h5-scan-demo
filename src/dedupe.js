import { DEDUPE_WINDOW_MS } from './config.js';

export function createDedupeState() {
  return Object.freeze({ lastCode: null, lastAt: Number.NEGATIVE_INFINITY });
}

function normalize(code) {
  return typeof code === 'string' ? code.trim() : '';
}

export function shouldSend(code, now, state = createDedupeState(), windowMs = DEDUPE_WINDOW_MS) {
  const normalized = normalize(code);
  if (!normalized) {
    return { send: false, reason: 'empty' };
  }
  if (state.lastCode === normalized && now - state.lastAt < windowMs) {
    return { send: false, reason: 'same-code-in-window' };
  }
  return { send: true, reason: state.lastCode === normalized ? 'window-expired' : 'code-changed' };
}

export function markSent(code, now) {
  return Object.freeze({ lastCode: normalize(code), lastAt: now });
}

export function accept(code, now, state = createDedupeState(), windowMs = DEDUPE_WINDOW_MS) {
  const decision = shouldSend(code, now, state, windowMs);
  return decision.send ? { ...decision, state: markSent(code, now) } : { ...decision, state };
}
