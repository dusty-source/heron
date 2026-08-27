// src/utils/viewportDiagnostic.ts
// On-device geometry probe. Reports the resolved viewport size and the four
// CSS safe-area insets so we can verify the app truly fills the screen on a
// physical device (insets ~0 => edge-to-edge). Runs only when explicitly
// enabled: window.__HERON_DEBUG === true, or URL has ?debug / #debug.
// In normal builds it logs nothing and renders nothing.

let instance: HTMLDivElement | null = null;

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).__HERON_DEBUG) return true;
  try {
    return /[?#&]debug/.test(window.location.href || '');
  } catch {
    return false;
  }
}

export function readInsets(): { top: number; bottom: number; left: number; right: number } {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  (probe.style as any).paddingTop = 'env(safe-area-inset-top)';
  (probe.style as any).paddingBottom = 'env(safe-area-inset-bottom)';
  (probe.style as any).paddingLeft = 'env(safe-area-inset-left)';
  (probe.style as any).paddingRight = 'env(safe-area-inset-right)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const parse = (v: string) => (v && numericValue(v)) || 0;
  const result = {
    top: parse(cs.paddingTop),
    bottom: parse(cs.paddingBottom),
    left: parse(cs.paddingLeft),
    right: parse(cs.paddingRight),
  };
  probe.remove();
  return result;
}

function numericValue(v: string): number {
  const m = /([0-9.]+)/.exec(v || '');
  return m ? parseFloat(m[1]) : 0;
}

export function logViewport(where: string) {
  if (!isEnabled()) return;
  const insets = readInsets();
  console.info(`[heron:viewport] ${where}`, {
    inner: `${window.innerWidth}x${window.innerHeight}`,
    client: `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
    dpr: window.devicePixelRatio,
    insets,
  });
}

// Shows a small dismissible on-screen readout when debug is enabled.
export function mountViewportReadout(getLabel: () => string) {
  if (!isEnabled()) return () => {};
  if (instance) return () => {};
  instance = document.createElement('div');
  instance.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:99999;background:rgba(0,0,0,0.85);color:#0f0;' +
    'font:10px/1.3 monospace;padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre;';
  const upd = () => {
    if (!instance) return;
    const i = readInsets();
    instance.textContent =
      typeof getLabel === 'function' ? getLabel() : '';
    instance.textContent +=
      `screen ${window.innerWidth}x${window.innerHeight} ` +
      `client ${document.documentElement.clientWidth}x${document.documentElement.clientHeight}\n` +
      `dpr ${window.devicePixelRatio}\n` +
      `sat/sab/sal/sar\n${i.top} / ${i.bottom} / ${i.left} / ${i.right}`;
  };
  upd();
  window.addEventListener('resize', upd);
  document.body.appendChild(instance);
  return () => {
    window.removeEventListener('resize', upd);
    if (instance) instance.remove();
    instance = null;
  };
}