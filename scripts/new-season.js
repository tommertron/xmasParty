#!/usr/bin/env node
// Start a new party year with last year's guest list.
//
//   node scripts/new-season.js 2025          # dry run: shows what would happen
//   node scripts/new-season.js 2025 --apply  # does it
//
// Copies data/*.json to data/archive/<year>/, then keeps every person but resets
// them all to "invited" and unclaimed (so last year's codes stop working), and
// empties the food list and the karaoke requests.

const fs = require('fs');
const path = require('path');

const [year, flag] = process.argv.slice(2);
const apply = flag === '--apply';
if (!/^\d{4}$/.test(year || '')) {
  console.error('Usage: node scripts/new-season.js <last-year> [--apply]');
  process.exit(1);
}

const dataDir = path.join(__dirname, '..', 'data');
const archiveDir = path.join(dataDir, 'archive', year);
const read = (f, fallback) => {
  const p = path.join(dataDir, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
};

const people = read('people.json', []);
const food = read('food.json', []);
const karaoke = read('karaoke.json', []);

console.log(`${people.length} people carried over: ${people.map(p => p.name).join(', ')}`);
console.log('Everyone goes back to unclaimed, so last year\'s codes stop working.');
console.log(`${food.length} food items and ${karaoke.length} karaoke requests will be cleared (archived first).`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to do it.');
  process.exit(0);
}
if (fs.existsSync(archiveDir)) {
  console.error(`\n${archiveDir} already exists; refusing to overwrite last year's archive.`);
  process.exit(1);
}

fs.mkdirSync(archiveDir, { recursive: true });
for (const f of ['people.json', 'groups.json', 'food.json', 'karaoke.json']) {
  const p = path.join(dataDir, f);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(archiveDir, f));
}

const reset = people.map(p => ({ id: p.id, name: p.name, status: 'invited', swap: false, karaoke: false, groupId: null }));
fs.writeFileSync(path.join(dataDir, 'people.json'), JSON.stringify(reset, null, 2));
for (const f of ['groups.json', 'food.json', 'karaoke.json']) fs.writeFileSync(path.join(dataDir, f), '[]\n');
console.log(`\nDone. Last year is in ${archiveDir}.`);
