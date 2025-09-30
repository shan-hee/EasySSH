import { getMsVar } from '@/utils/cssVars';

export function getXtermElement(terminalStore, id) {
  try {
    if (!id || !terminalStore?.hasTerminal(id)) return null;
    const term = terminalStore.getTerminal(id);
    if (term?.element) return term.element;
  } catch (_) {}
  try {
    return document.querySelector(`.xterm[data-terminal-id="${id}"]`);
  } catch (_) {
    return null;
  }
}

export function softRefitTerminalUtil(terminalStore, activeConnectionIdRef, explicitId, durations) {
  try {
    const id = explicitId || (activeConnectionIdRef && activeConnectionIdRef.value);
    if (!id || !terminalStore?.hasTerminal(id)) return;
    const el = getXtermElement(terminalStore, id);
    if (!el) {
      terminalStore.fitTerminal(id);
      return;
    }
    const timing = getMsVar('--motion-tiny', durations?.motionTiny || 120);
    const transFrag = `opacity ${timing}ms var(--theme-transition-timing)`;
    el.style.transition = el.style.transition ? `${el.style.transition}, ${transFrag}` : transFrag;
    el.style.willChange = 'opacity';
    el.style.opacity = '0.01';

    requestAnimationFrame(() => {
      try {
        terminalStore.fitTerminal(id);
      } catch (_) {}
      requestAnimationFrame(() => {
        el.style.opacity = '1';
        const releaseDelay = durations?.motionFast || getMsVar('--motion-fast', 160);
        setTimeout(() => {
          el.style.willChange = '';
        }, releaseDelay);
      });
    });
  } catch (_) {
    try {
      terminalStore.fitTerminal(explicitId || (activeConnectionIdRef && activeConnectionIdRef.value));
    } catch (_) {}
  }
}

export function lockRightAreaAndRefit(rightAreaEl, terminalStore, activeConnectionIdRef, durations, softRefit = softRefitTerminalUtil) {
  if (!rightAreaEl) {
    softRefit(terminalStore, activeConnectionIdRef, null, durations);
    return;
  }
  try {
    const rect = rightAreaEl.getBoundingClientRect();
    rightAreaEl.style.width = `${Math.round(rect.width)}px`;
    requestAnimationFrame(() => {
      softRefit(terminalStore, activeConnectionIdRef, null, durations);
      const releaseDelay = durations?.motionFast || getMsVar('--motion-fast', 160);
      setTimeout(() => {
        rightAreaEl.style.width = '';
      }, releaseDelay);
    });
  } catch (_) {
    softRefit(terminalStore, activeConnectionIdRef, null, durations);
  }
}

export default { getXtermElement, softRefitTerminalUtil, lockRightAreaAndRefit };

