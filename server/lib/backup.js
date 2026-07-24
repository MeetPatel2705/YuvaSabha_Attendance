const fs = require('fs');
const path = require('path');
const db = require('../db');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
const RETENTION_DAYS = 14;

// SQLite is the sole source of truth for attendance data, so it needs its
// own backups. VACUUM INTO writes a clean, self-consistent snapshot to a new
// file in one atomic step — safer than a plain file copy, which could grab a
// half-written page if it landed mid-transaction.
function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `attendance-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  pruneOldBackups();
  return backupPath;
}

function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(BACKUP_DIR)) {
    const filePath = path.join(BACKUP_DIR, file);
    if (fs.statSync(filePath).mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
    }
  }
}

module.exports = { runBackup, BACKUP_DIR };
