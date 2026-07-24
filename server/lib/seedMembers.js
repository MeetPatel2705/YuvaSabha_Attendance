const db = require('../db');

const insert = db.prepare(
  'INSERT INTO members (sheet_row, sheet_no, name, mobile, gender) VALUES (?, ?, ?, ?, ?)'
);

// Shared by the one-time local `npm run seed` (scripts/seedMembers.js,
// reading from the gitignored members.seed.json) and the auto-seed-at-boot
// path (index.js, reading from the MEMBERS_SEED_JSON env var) — the latter
// exists for hosts with ephemeral disks (Render/Replit free tiers), where
// the members table resets on every redeploy/sleep-wake cycle and there's
// no shell to manually re-run the seed script each time.
//
// A handful of sheet rows are reserved (numbered) but have no name filled
// in yet in the source spreadsheet — skipped rather than seeding blank
// members.
function seedMembers(members) {
  const countRow = db.prepare('SELECT COUNT(*) AS n FROM members').get();
  if (countRow.n > 0) {
    return { seeded: 0, skipped: 0, alreadyHadRows: countRow.n };
  }

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

  return { seeded: withNames.length, skipped, alreadyHadRows: 0 };
}

module.exports = { seedMembers };
