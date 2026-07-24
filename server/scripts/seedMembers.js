const fs = require('fs');
const path = require('path');
const { seedMembers } = require('../lib/seedMembers');

const membersPath = path.join(__dirname, 'members.seed.json');
const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));

const result = seedMembers(members);
if (result.alreadyHadRows) {
  console.log(`members table already has ${result.alreadyHadRows} rows — skipping seed. Delete the DB file to reseed.`);
} else {
  console.log(`Seeded ${result.seeded} members (skipped ${result.skipped} unnamed reserved rows).`);
}
