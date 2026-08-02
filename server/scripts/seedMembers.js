require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { seedMembers } = require('../lib/seedMembers');
const { pool } = require('../db');

const membersPath = path.join(__dirname, 'members.seed.json');
const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));

seedMembers(members)
  .then((result) => {
    if (result.alreadyHadRows) {
      console.log(`members table already has ${result.alreadyHadRows} rows — skipping seed.`);
    } else {
      console.log(`Seeded ${result.seeded} members (skipped ${result.skipped} unnamed reserved rows).`);
    }
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
