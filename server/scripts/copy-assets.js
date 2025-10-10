/*
 * 复制运行时所需的脚本到 dist（构建后）
 */
const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

try {
  const root = __dirname; // server/scripts
  const projectRoot = path.resolve(root, '..');
  const distRoot = path.join(projectRoot, 'dist');

  // 复制 streaming-monitor.sh 到 dist/scripts
  const srcScript = path.join(projectRoot, 'scripts', 'streaming-monitor.sh');
  const destScript = path.join(distRoot, 'scripts', 'streaming-monitor.sh');
  if (fs.existsSync(srcScript)) {
    copyFile(srcScript, destScript);
    try { fs.chmodSync(destScript, 0o755); } catch (_) {}
    console.log('[copy-assets] 已复制 streaming-monitor.sh -> dist/scripts');
  } else {
    console.warn('[copy-assets] 警告: 未找到 scripts/streaming-monitor.sh');
  }
} catch (e) {
  console.error('[copy-assets] 出错:', e && e.message || e);
  process.exitCode = 1;
}

