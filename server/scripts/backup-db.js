/*
 * 轻量数据库备份脚本：复制 server/data 下的 *.sqlite* 到 server/logs/backups/<timestamp>/
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
  const projectRoot = path.resolve(__dirname, '..');
  const dataDir = path.join(projectRoot, 'data');
  const backupRoot = path.join(projectRoot, 'logs', 'backups');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupRoot, stamp);

  ensureDir(backupDir);

  const files = fs.readdirSync(dataDir).filter(f => /\.sqlite(\-shm|\-wal)?$/i.test(f) || /\.db(\-shm|\-wal)?$/i.test(f));
  if (files.length === 0) {
    console.log('[db:backup] 未发现需要备份的数据库文件');
    process.exit(0);
  }

  for (const f of files) {
    copyFile(path.join(dataDir, f), path.join(backupDir, f));
  }

  console.log(`[db:backup] 备份完成 -> ${backupDir}`);
} catch (e) {
  console.error('[db:backup] 备份失败:', e && e.message || e);
  process.exit(1);
}

