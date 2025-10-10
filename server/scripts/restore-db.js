/*
 * 轻量数据库还原脚本：将最近一次备份从 server/logs/backups/<timestamp>/ 复制回 server/data
 * 注意：该操作会覆盖现有数据库文件，请谨慎执行。
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

  if (!fs.existsSync(backupRoot)) {
    console.error('[db:restore] 未找到备份目录');
    process.exit(1);
  }

  const entries = fs.readdirSync(backupRoot).filter(name => {
    const p = path.join(backupRoot, name);
    return fs.statSync(p).isDirectory();
  }).sort();

  if (entries.length === 0) {
    console.error('[db:restore] 备份目录为空');
    process.exit(1);
  }

  const latest = entries[entries.length - 1];
  const latestDir = path.join(backupRoot, latest);
  const files = fs.readdirSync(latestDir).filter(f => /\.(sqlite|db)(\-shm|\-wal)?$/i.test(f));
  if (files.length === 0) {
    console.error('[db:restore] 最近备份无数据库文件');
    process.exit(1);
  }

  for (const f of files) {
    copyFile(path.join(latestDir, f), path.join(dataDir, f));
  }

  console.log(`[db:restore] 已从 ${latestDir} 还原到 ${dataDir}`);
} catch (e) {
  console.error('[db:restore] 还原失败:', e && e.message || e);
  process.exit(1);
}

