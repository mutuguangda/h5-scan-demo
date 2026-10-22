export function createUi(documentRef = document) {
  const $ = id => documentRef.getElementById(id);

  const elements = {
    video: $('video'),
    frame: $('frame'),
    currentCode: $('current-code'),
    count: $('count'),
    status: $('status'),
    torch: $('torch'),
    debugToggle: $('debug-toggle'),
    end: $('end'),
    debug: $('debug'),
    debugClose: $('debug-close'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayText: $('overlay-text'),
    restart: $('restart'),
    dbgEngine: $('dbg-engine'),
    dbgRaw: $('dbg-raw'),
    dbgDuration: $('dbg-duration'),
    dbgDedupe: $('dbg-dedupe'),
    dbgMessage: $('dbg-message'),
    dbgMode: $('dbg-mode'),
    dbgConfig: $('dbg-config'),
  };

  function setStatus(text, tone = 'info') {
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
    elements.currentCode.textContent = code || '';
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
    }
    else {
      elements.torch.hidden = true;
      elements.torch.disabled = true;
    }
    elements.torch.setAttribute('aria-pressed', on ? 'true' : 'false');
    elements.torch.classList.toggle('is-on', Boolean(on));
  }

  function setDebugOpen(open) {
    if (elements.debug) {
      elements.debug.hidden = !open;
    }
    if (elements.debugToggle) {
      elements.debugToggle.setAttribute('aria-pressed', open ? 'true' : 'false');
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
      config: elements.dbgConfig,
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
    },
  };
}
