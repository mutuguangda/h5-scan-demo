export function createUi(documentRef = document) {
  const $ = id => documentRef.getElementById(id);

  const elements = {
    video: $('video'),
    frame: $('frame'),
    currentCode: $('current-code'),
    count: $('count'),
    status: $('status'),
    results: $('results'),
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

  const rows = [];

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
    elements.currentCode.textContent = code || '—';
  }

  function setCount(count) {
    if (!elements.count) {
      return;
    }
    elements.count.textContent = String(Number.isFinite(count) ? count : 0);
  }

  function addResult(code) {
    if (!elements.results) {
      return;
    }
    elements.results.hidden = false;
    const item = documentRef.createElement('li');
    item.className = 'results__item';
    const index = documentRef.createElement('span');
    index.className = 'results__index';
    const text = documentRef.createElement('span');
    text.className = 'results__code';
    item.append(index, text);
    elements.results.prepend(item);
    rows.unshift({ item, index, text });
    while (rows.length > 30) {
      const dropped = rows.pop();
      dropped.item.remove();
    }
    text.textContent = code;
    rows.forEach((row, position) => {
      row.index.textContent = `${rows.length - position}`;
    });
  }

  function clearResults() {
    rows.length = 0;
    if (elements.results) {
      elements.results.replaceChildren();
      elements.results.hidden = true;
    }
  }

  function setTorchState({ visible, on }) {
    if (!elements.torch) {
      return;
    }
    elements.torch.hidden = !visible;
    elements.torch.disabled = !visible;
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
    addResult,
    clearResults,
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
