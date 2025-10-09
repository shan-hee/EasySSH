export function getCssVarRaw(varName: string, fallback: string = ''): string {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
    return (v || '').trim() || fallback;
  } catch (_) {
    return fallback;
  }
}

export function getMsVar(varName: string, fallbackMs: number = 0): number {
  const raw = getCssVarRaw(varName, '');
  if (!raw) return fallbackMs;
  const v = raw.toLowerCase();
  try {
    if (v.endsWith('ms')) return parseFloat(v);
    if (v.endsWith('s')) return parseFloat(v) * 1000;
    const n = parseFloat(v);
    return isNaN(n) ? fallbackMs : n;
  } catch (_) {
    return fallbackMs;
  }
}

export default { getCssVarRaw, getMsVar };
