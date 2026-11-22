const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

const STATUSES = ['invited', 'coming', 'notcoming'];
const LIMITS = { name: 60, item: 120, song: 120, artist: 80, note: 200, karaokeTotal: 500 };

app.set('trust proxy', 'loopback'); // nginx on the same box passes the real client IP
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- storage ----------

async function readJSON(filename, fallback = []) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, filename), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

// Write to a temp file then rename, so a crash mid-write never leaves half a guest list.
async function writeJSON(filename, data) {
  const file = path.join(DATA_DIR, filename);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

// Every change is read-modify-write. Run them one at a time so two people
// RSVPing in the same second can't overwrite each other.
let queue = Promise.resolve();
function serialized(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readConfig() {
  for (const name of ['config.json', 'config.example.json']) {
    try {
      return JSON.parse(await fs.readFile(path.join(__dirname, name), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {};
}

// Last year's statuses were invited / swapping / attending / notcoming.
// Swapping is now its own yes/no, so map the old values onto the new shape.
function normalizePerson(m) {
  const legacy = { swapping: ['coming', true], attending: ['coming', false] };
  let status = m.status;
  let swap = Boolean(m.swap);
  if (legacy[status]) [status, swap] = [legacy[status][0], m.swap ?? legacy[status][1]];
  if (!STATUSES.includes(status)) status = 'invited';
  return {
    id: m.id, name: m.name, status, swap, karaoke: Boolean(m.karaoke),
    groupId: m.groupId || null, added: Boolean(m.added),
  };
}

// ---------- codes ----------
//
// There are no families any more, just people. Claiming a person ("that's me")
// hands out a code; claiming more people in the same browser puts them on the
// same code, so a household ends up sharing one. The code is the only key to
// change those people, their food and their song requests.

// Friendly, phone-typeable codes like "tinsel-reindeer-42".
const WORDS = ['tinsel', 'reindeer', 'snowman', 'cocoa', 'mitten', 'sleigh', 'garland', 'holly',
  'eggnog', 'chimney', 'nutcracker', 'snowflake', 'gingerbread', 'stocking', 'candycane', 'icicle',
  'toboggan', 'wreath', 'sugarplum', 'chestnut', 'jingle', 'frosty', 'mistletoe', 'cranberry',
  'pinecone', 'sweater', 'carol', 'lantern', 'snowball', 'fruitcake', 'tuque', 'elf'];

// The code alone identifies the group, so they must all be different.
function newCode(groups) {
  const taken = new Set(groups.map(g => g.code.toLowerCase()));
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  for (;;) {
    let a = pick(), b = pick();
    while (b === a) b = pick();
    const code = `${a}-${b}-${crypto.randomInt(10, 100)}`;
    if (!taken.has(code)) return code;
  }
}

const tidy = code => (typeof code === 'string' ? code.trim().toLowerCase().replace(/\s+/g, '-') : '');

function findGroupByCode(groups, given) {
  const code = Buffer.from(tidy(given));
  if (!code.length) return null;
  return groups.find(g => {
    const real = Buffer.from(g.code.toLowerCase());
    return real.length === code.length && crypto.timingSafeEqual(real, code);
  }) || null;
}

// One-time move from last version's families.json. Families that had already
// done something (an RSVP, food, a song) become a group whose code is their old
// family password, so nobody loses their answers or gets locked out. Everyone
// else is just a name on the list, waiting to be claimed.
async function migrateFromFamilies() {
  if (await readJSON('people.json', null)) return false;
  const families = await readJSON('families.json', null);
  if (!families) return false;
  const food = await readJSON('food.json');
  const karaoke = await readJSON('karaoke.json');
  const people = [];
  const groups = [];
  for (const f of families) {
    const members = (f.members || []).map(normalizePerson);
    const active = members.some(m => m.status !== 'invited')
      || food.some(i => i.familyId === f.id) || karaoke.some(r => r.familyId === f.id);
    if (active && f.password) {
      groups.push({ id: f.id, code: f.password, createdAt: new Date().toISOString() });
      members.forEach(m => { m.groupId = f.id; });
    }
    people.push(...members);
  }
  const groupIds = new Set(groups.map(g => g.id));
  await writeJSON('people.json', people);
  await writeJSON('groups.json', groups);
  await writeJSON('food.json', food.filter(i => groupIds.has(i.groupId || i.familyId))
    .map(({ familyId, ...i }) => ({ ...i, groupId: i.groupId || familyId })));
  await writeJSON('karaoke.json', karaoke.map(({ familyId, family, ...r }) => ({ ...r, groupId: r.groupId || familyId })));
  await fs.rename(path.join(DATA_DIR, 'families.json'), path.join(DATA_DIR, 'families.migrated.json'));
  console.log(`Migrated ${people.length} people from families.json (${groups.length} families kept their password as a code).`);
  return true;
}

const loadPeople = async () => (await readJSON('people.json')).map(normalizePerson);
const loadGroups = () => readJSON('groups.json');

// What signed-in guests see about everyone. groupId is an opaque id, not the code.
const guestView = ({ added, ...p }) => p;
// What anyone at all sees: a name to claim, and whether someone already has.
const publicView = p => ({ id: p.id, name: p.name, claimed: Boolean(p.groupId) });

const MAX_PER_GROUP = 10;

// ---------- rate limits ----------

// Slow down code guessing: 10 wrong tries per IP per 15 minutes.
function limiter(max, windowMs) {
  const hits = new Map();
  return {
    blocked(ip) {
      const now = Date.now();
      const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
      hits.set(ip, recent);
      return recent.length >= max;
    },
    note: ip => hits.set(ip, [...(hits.get(ip) || []), Date.now()]),
  };
}
const wrongCodes = limiter(10, 15 * 60e3);
const claims = limiter(20, 60 * 60e3); // a big household is ~6; 20 an hour is plenty

// ---------- who's asking ----------

async function isHost(req) {
  const { hostKey } = await readConfig();
  const given = req.get('X-Host-Key') || '';
  if (!hostKey || !given) return false;
  const a = Buffer.from(String(hostKey));
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns { host: true }, { group }, or null.
async function whoIs(req) {
  if (await isHost(req)) return { host: true };
  const given = req.get('X-Code');
  if (!given) return null;
  const group = findGroupByCode(await loadGroups(), given);
  if (!group) wrongCodes.note(req.ip);
  return group ? { group } : null;
}

const canEdit = (who, groupId) => who.host || (groupId && who.group?.id === groupId);

const bad = (res, msg) => res.status(400).json({ error: msg });
const missing = (res, what) => res.status(404).json({ error: `${what} not found` });
const forbidden = res => res.status(403).json({ error: 'You can only change the people on your code' });
const tooMany = res => res.status(429).json({ error: 'Too many wrong codes. Try again in 15 minutes.' });

// level: 'public' | 'guest' (any code or host) | 'host'
function route(level, handler) {
  return async (req, res) => {
    try {
      if (level !== 'public') {
        if (wrongCodes.blocked(req.ip)) return tooMany(res);
        const who = await whoIs(req);
        if (!who || (level === 'host' && !who.host)) {
          return res.status(401).json({ error: level === 'host' ? 'Hosts only' : 'Please sign in' });
        }
        req.who = who;
      }
      await handler(req, res);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Something went wrong' });
    }
  };
}

const newId = () => crypto.randomUUID();

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

// ---------- config & sign-in ----------

// Only the invitation basics are public, for the front door. The rest waits behind a code.
app.get('/api/config', route('public', async (req, res) => {
  const { party = {} } = await readConfig();
  const { title, hosts, date, timeLong, time, partyDateTime } = party;
  res.json({ party: { title, hosts, date, timeLong, time, partyDateTime } });
}));

app.get('/api/config/full', route('guest', async (req, res) => {
  const { hostKey, ...config } = await readConfig(); // never send the host key out
  res.json(config);
}));

// The guest list, names only, so people can find themselves.
app.get('/api/names', route('public', async (req, res) => {
  const people = await loadPeople();
  res.json(people.map(publicView).sort((a, b) => a.name.localeCompare(b.name)));
}));

// "That's me." Anyone can claim a name nobody has claimed yet. Send your code
// (X-Code) to add them to your group; without one you get a brand new code.
app.post('/api/names/:id/claim', route('public', async (req, res) => {
  if (wrongCodes.blocked(req.ip) || claims.blocked(req.ip)) {
    return res.status(429).json({ error: 'That’s a lot of people! Give Tom a shout and he’ll sort it out.' });
  }
  const given = req.get('X-Code');
  const result = await serialized(async () => {
    const [people, groups] = await Promise.all([loadPeople(), loadGroups()]);
    const person = people.find(p => p.id === req.params.id);
    if (!person) return { status: 404, error: 'Person not found' };
    if (person.groupId) {
      return { status: 409, error: `Someone has already RSVPed for ${person.name}. If that wasn’t you, tell Tom or Erin.` };
    }
    let group = given ? findGroupByCode(groups, given) : null;
    if (given && !group) { wrongCodes.note(req.ip); return { status: 401, error: 'That code isn’t one of ours' }; }
    if (group && people.filter(p => p.groupId === group.id).length >= MAX_PER_GROUP) {
      return { status: 400, error: 'That’s everyone one code can hold. Give Tom a shout.' };
    }
    if (!group) {
      group = { id: newId(), code: newCode(groups), createdAt: new Date().toISOString() };
      groups.push(group);
      await writeJSON('groups.json', groups);
    }
    person.groupId = group.id;
    await writeJSON('people.json', people);
    claims.note(req.ip);
    console.log(`claim: ${person.name} -> group ${group.id} from ${req.ip}`);
    return { group, people };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  const { group, people } = result;
  res.json({ code: group.code, groupId: group.id, names: people.filter(p => p.groupId === group.id).map(p => p.name) });
}));

app.post('/api/login', route('public', async (req, res) => {
  if (wrongCodes.blocked(req.ip)) return tooMany(res);
  const group = findGroupByCode(await loadGroups(), req.body.code);
  if (!group) {
    wrongCodes.note(req.ip);
    return res.status(401).json({ error: 'That code isn’t one of ours. Check for typos?' });
  }
  const names = (await loadPeople()).filter(p => p.groupId === group.id).map(p => p.name);
  res.json({ groupId: group.id, names });
}));

app.get('/api/me', route('guest', async (req, res) => {
  const { who } = req;
  if (who.host) return res.json({ host: true });
  const names = (await loadPeople()).filter(p => p.groupId === who.group.id).map(p => p.name);
  res.json({ groupId: who.group.id, code: who.group.code, names });
}));

// ---------- host: codes ----------

app.get('/api/host/groups', route('host', async (req, res) => {
  const [people, groups] = await Promise.all([loadPeople(), loadGroups()]);
  res.json(groups
    .map(g => ({ id: g.id, code: g.code, names: people.filter(p => p.groupId === g.id).map(p => p.name) }))
    .filter(g => g.names.length));
}));

app.post('/api/host/groups/:id/code', route('host', async (req, res) => {
  const code = await serialized(async () => {
    const groups = await loadGroups();
    const group = groups.find(g => g.id === req.params.id);
    if (!group) return null;
    group.code = newCode(groups);
    await writeJSON('groups.json', groups);
    return group.code;
  });
  code ? res.json({ code }) : missing(res, 'Code');
}));

// ---------- people ----------

app.get('/api/people', route('guest', async (req, res) => res.json((await loadPeople()).map(guestView))));

// Hosts add names to the guest list (unclaimed). A guest can add someone to
// their own code, e.g. a new partner, but only onto their own code.
app.post('/api/people', route('guest', async (req, res) => {
  const name = clean(req.body.name, LIMITS.name);
  if (!name) return bad(res, 'Name is required');
  const groupId = req.who.host ? null : req.who.group.id;
  const result = await serialized(async () => {
    const people = await loadPeople();
    if (groupId && people.filter(p => p.groupId === groupId).length >= MAX_PER_GROUP) return null;
    const person = normalizePerson({ id: newId(), name, status: 'invited', groupId, added: Boolean(groupId) });
    people.push(person);
    await writeJSON('people.json', people);
    return person;
  });
  result ? res.json(guestView(result)) : bad(res, 'That’s everyone one code can hold. Give Tom a shout.');
}));

app.put('/api/people/:id', route('guest', async (req, res) => {
  const { status, swap, karaoke } = req.body;
  if (status !== undefined && !STATUSES.includes(status)) return bad(res, 'Unknown status');
  const result = await serialized(async () => {
    const people = await loadPeople();
    const person = people.find(p => p.id === req.params.id);
    if (!person) return 'missing';
    if (!canEdit(req.who, person.groupId)) return 'forbidden';
    if (status !== undefined) person.status = status;
    if (swap !== undefined) person.swap = Boolean(swap);
    if (karaoke !== undefined) person.karaoke = Boolean(karaoke);
    if (person.status !== 'coming') { person.swap = false; person.karaoke = false; }
    await writeJSON('people.json', people);
    return person;
  });
  if (result === 'missing') return missing(res, 'Person');
  if (result === 'forbidden') return forbidden(res);
  res.json(guestView(result));
}));

// Take someone off your code. People you added yourself are removed; people from
// the guest list go back on it, unclaimed, with their answers cleared.
// Hosts can do either to anyone: { remove: true } deletes outright.
app.post('/api/people/:id/release', route('guest', async (req, res) => {
  const result = await serialized(async () => {
    const people = await loadPeople();
    const person = people.find(p => p.id === req.params.id);
    if (!person) return 'gone';
    if (!canEdit(req.who, person.groupId)) return 'forbidden';
    const remove = person.added || (req.who.host && req.body.remove);
    const next = remove ? people.filter(p => p !== person)
      : people.map(p => (p === person ? normalizePerson({ id: p.id, name: p.name, status: 'invited' }) : p));
    await writeJSON('people.json', next);
    return remove ? 'removed' : 'released';
  });
  result === 'forbidden' ? forbidden(res) : res.json({ result });
}));

// ---------- food ----------

app.get('/api/food', route('guest', async (req, res) => res.json(await readJSON('food.json'))));

app.post('/api/food', route('guest', async (req, res) => {
  const item = clean(req.body.item, LIMITS.item);
  const groupId = req.who.host ? clean(req.body.groupId, 64) : req.who.group.id;
  if (!item || !groupId) return bad(res, 'Food item is required');
  const result = await serialized(async () => {
    if (!(await loadGroups()).some(g => g.id === groupId)) return null;
    const food = await readJSON('food.json');
    const entry = { id: newId(), groupId, item };
    food.push(entry);
    await writeJSON('food.json', food);
    return entry;
  });
  result ? res.json(result) : missing(res, 'Code');
}));

app.delete('/api/food/:id', route('guest', async (req, res) => {
  const result = await serialized(async () => {
    const food = await readJSON('food.json');
    const entry = food.find(i => i.id === req.params.id);
    if (!entry) return 'gone';
    if (!canEdit(req.who, entry.groupId)) return 'forbidden';
    await writeJSON('food.json', food.filter(i => i.id !== req.params.id));
    return 'ok';
  });
  result === 'forbidden' ? forbidden(res) : res.json({ success: true });
}));

// ---------- karaoke (requests are secret: only the hosts can read them) ----------

app.get('/api/karaoke/summary', route('guest', async (req, res) => {
  const requests = await readJSON('karaoke.json');
  res.json({ count: requests.length });
}));

app.post('/api/karaoke', route('guest', async (req, res) => {
  const song = clean(req.body.song, LIMITS.song);
  const artist = clean(req.body.artist, LIMITS.artist);
  const note = clean(req.body.note, LIMITS.note);
  if (!song) return bad(res, 'Which song?');

  // You can only request as one of the people on your code. Hosts can pick anyone.
  const person = (await loadPeople()).find(p => p.id === req.body.memberId);
  if (!person || !(req.who.host || person.groupId === req.who.group.id)) return bad(res, 'Pick who’s asking');

  const ok = await serialized(async () => {
    const requests = await readJSON('karaoke.json');
    if (requests.length >= LIMITS.karaokeTotal) return false;
    requests.push({
      id: newId(), song, artist, note,
      groupId: person.groupId, memberId: person.id, from: person.name,
      at: new Date().toISOString(),
    });
    await writeJSON('karaoke.json', requests);
    return true;
  });
  if (!ok) return res.status(429).json({ error: 'The songbook is full!' });
  res.json({ success: true }); // deliberately does not echo the queue back
}));

app.get('/api/karaoke', route('host', async (req, res) => res.json(await readJSON('karaoke.json'))));

app.delete('/api/karaoke/:id', route('host', async (req, res) => {
  await serialized(async () => {
    const requests = await readJSON('karaoke.json');
    await writeJSON('karaoke.json', requests.filter(r => r.id !== req.params.id));
  });
  res.json({ success: true });
}));

// ---------- start ----------

fs.mkdir(DATA_DIR, { recursive: true }).then(() => serialized(migrateFromFamilies)).then(() => {
  app.listen(PORT, () => console.log(`🎄 Christmas Party Planner running on http://localhost:${PORT}`));
});
