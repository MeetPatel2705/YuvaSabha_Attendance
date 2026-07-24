const fs = require('fs');
const path = require('path');
const db = require('../db');

const membersPath = path.join(__dirname, 'members.seed.json');
const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));

const countRow = db.prepare('SELECT COUNT(*) AS n FROM members').get();
if (countRow.n > 0) {
  console.log(`members table already has ${countRow.n} rows — skipping seed. Delete the DB file to reseed.`);
  process.exit(0);
}

const insert = db.prepare(
  'INSERT INTO members (sheet_row, sheet_no, name, mobile, gender) VALUES (?, ?, ?, ?, ?)'
);

// A handful of sheet rows are reserved (numbered) but have no name filled in yet
// in the source spreadsheet — skip those rather than seeding blank members.
const withNames = members.filter((m) => m.name && m.name.trim());
const skipped = members.length - withNames.length;

db.exec('BEGIN');
try {
  for (const m of withNames) {
    const mobile = m.mobile ? m.mobile.trim().replace(/\s+/g, '') : null;
    const cleanMobile = !mobile || mobile.toUpperCase() === 'NA' ? null : mobile;
    insert.run(m.row, Number(m.no), m.name.trim(), cleanMobile, m.gender);
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}

console.log(`Seeded ${withNames.length} members (skipped ${skipped} unnamed reserved rows).`);
