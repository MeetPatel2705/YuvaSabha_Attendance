const { query, withTransaction } = require('../db');

// Shared by the one-time local `npm run seed` (scripts/seedMembers.js,
// reading from the gitignored members.seed.json) and the auto-seed-at-boot
// path (index.js, reading from the MEMBERS_SEED_JSON env var) — the latter
// is a safety net for a brand-new empty database, so a fresh deploy comes up
// with the roster without a manual step. No-op if the table already has rows.
//
// A handful of sheet rows are reserved (numbered) but have no name filled
// in yet in the source spreadsheet — skipped rather than seeding blank
// members.
async function seedMembers(members) {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM members');
  if (rows[0].n > 0) {
    return { seeded: 0, skipped: 0, alreadyHadRows: rows[0].n };
  }

  const withNames = members.filter((m) => m.name && m.name.trim());
  const skipped = members.length - withNames.length;

  await withTransaction(async (client) => {
    for (const m of withNames) {
      const mobile = m.mobile ? m.mobile.trim().replace(/\s+/g, '') : null;
      const cleanMobile = !mobile || mobile.toUpperCase() === 'NA' ? null : mobile;
      await client.query(
        'INSERT INTO members (sheet_row, sheet_no, name, mobile, gender) VALUES ($1, $2, $3, $4, $5)',
        [m.row, Number(m.no), m.name.trim(), cleanMobile, m.gender]
      );
    }
  });

  return { seeded: withNames.length, skipped, alreadyHadRows: 0 };
}

module.exports = { seedMembers };
