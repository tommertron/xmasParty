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
function normalizeMember(m) {
  const legacy = { swapping: ['coming', true], attending: ['coming', false] };
  let status = m.status;
  let swap = Boolean(m.swap);
  if (legacy[status]) [status, swap] = [legacy[status][0], m.swap ?? legacy[status][1]];
  if (!STATUSES.includes(status)) status = 'invited';
  return { id: m.id, name: m.name, status, swap, karaoke: Boolean(m.karaoke) };
}

// Internal shape, including each family's password. Never send this out as-is.
async function loadFamilies() {
  const families = await readJSON('families.json');
  return families.map(f => ({
    id: f.id, name: f.name, password: f.password || null,
    members: (f.members || []).map(normalizeMember),
  }));
}

const publicFamilies = families => families.map(({ password, ...f }) => f);

// ---------- passwords ----------

// Friendly, phone-typeable passwords like "tinsel-reindeer-42".
const WORDS = ['tinsel', 'reindeer', 'snowman', 'cocoa', 'mitten', 'sleigh', 'garland', 'holly',
  'eggnog', 'chimney', 'nutcracker', 'snowflake', 'gingerbread', 'stocking', 'candycane', 'icicle',
  'toboggan', 'wreath', 'sugarplum', 'chestnut', 'jingle', 'frosty', 'mistletoe', 'cranberry',
  'pinecone', 'sweater', 'carol', 'lantern', 'snowball', 'fruitcake', 'tuque', 'elf'];

// The password alone identifies the family, so they must all be different.
function newPassword(families) {
  const taken = new Set(families.map(f => (f.password || '').toLowerCase()));
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  for (;;) {
    let a = pick(), b = pick();
    while (b === a) b = pick();
    const pw = `${a}-${b}-${crypto.randomInt(10, 100)}`;
    if (!taken.has(pw)) return pw;
  }
}

const tidy = pw => (typeof pw === 'string' ? pw.trim().toLowerCase().replace(/\s+/g, '-') : '');

function findFamilyByPassword(families, given) {
  const pw = Buffer.from(tidy(given));
  if (!pw.length) return null;
  return families.find(f => {
    if (!f.password) return false;
    const real = Buffer.from(f.password.toLowerCase());
    return real.length === pw.length && crypto.timingSafeEqual(real, pw);
  }) || null;
}

// Slow down password guessing: 10 wrong tries per IP per 15 minutes.
const failures = new Map();
function tooManyFailures(ip) {
  const now = Date.now();
  const recent = (failures.get(ip) || []).filter(t => now - t < 15 * 60e3);
  failures.set(ip, recent);
  return recent.length >= 10;
}
const noteFailure = ip => failures.set(ip, [...(failures.get(ip) || []), Date.now()]);

// ---------- who's asking ----------

async function isHost(req) {
  const { hostKey } = await readConfig();
  const given = req.get('X-Host-Key') || '';
  if (!hostKey || !given) return false;
  const a = Buffer.from(String(hostKey));
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns { host: true }, { family }, or null.
async function whoIs(req) {
  if (await isHost(req)) return { host: true };
  const given = req.get('X-Family-Pass');
  if (!given) return null;
  const family = findFamilyByPassword(await loadFamilies(), given);
  if (!family) noteFailure(req.ip);
  return family ? { family } : null;
}

const canEdit = (who, familyId) => who.host || who.family?.id === familyId;

const bad = (res, msg) => res.status(400).json({ error: msg });
const missing = (res, what) => res.status(404).json({ error: `${what} not found` });
const forbidden = res => res.status(403).json({ error: 'You can only change your own family' });

// level: 'public' | 'guest' (any family or host) | 'host'
function route(level, handler) {
  return async (req, res) => {
    try {
      if (level !== 'public') {
        if (tooManyFailures(req.ip)) {
          return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
        }
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

// Only the invitation basics are public, for the sign-in page. The rest waits behind the door.
app.get('/api/config', route('public', async (req, res) => {
  const { party = {} } = await readConfig();
  const { title, hosts, date, timeLong, time, partyDateTime } = party;
  res.json({ party: { title, hosts, date, timeLong, time, partyDateTime } });
}));

app.get('/api/config/full', route('guest', async (req, res) => {
  const { hostKey, ...config } = await readConfig(); // never send the host key out
  res.json(config);
}));

app.post('/api/login', route('public', async (req, res) => {
  if (tooManyFailures(req.ip)) {
    return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
  }
  const family = findFamilyByPassword(await loadFamilies(), req.body.password);
  if (!family) {
    noteFailure(req.ip);
    return res.status(401).json({ error: 'That password isn’t one of ours. Check your invite?' });
  }
  res.json({ familyId: family.id, name: family.name });
}));

app.get('/api/me', route('guest', async (req, res) => {
  const { who } = req;
  res.json(who.host ? { host: true } : { familyId: who.family.id, name: who.family.name });
}));

// ---------- host: family passwords ----------

// Hosts see every family's password; any family missing one gets one now.
app.get('/api/host/families', route('host', async (req, res) => {
  const families = await serialized(async () => {
    const list = await loadFamilies();
    if (list.some(f => !f.password)) {
      list.forEach(f => { f.password ||= newPassword(list); });
      await writeJSON('families.json', list);
    }
    return list;
  });
  res.json(families.map(f => ({ id: f.id, name: f.name, password: f.password })));
}));

app.post('/api/host/families/:id/password', route('host', async (req, res) => {
  const password = await serialized(async () => {
    const families = await loadFamilies();
    const family = families.find(f => f.id === req.params.id);
    if (!family) return null;
    family.password = newPassword(families);
    await writeJSON('families.json', families);
    return family.password;
  });
  password ? res.json({ password }) : missing(res, 'Family');
}));

// ---------- families & people ----------

app.get('/api/families', route('guest', async (req, res) => res.json(publicFamilies(await loadFamilies()))));

app.post('/api/families', route('host', async (req, res) => {
  const name = clean(req.body.name, LIMITS.name);
  if (!name) return bad(res, 'Family name is required');
  const family = await serialized(async () => {
    const families = await loadFamilies();
    const f = { id: newId(), name, password: newPassword(families), members: [] };
    families.push(f);
    await writeJSON('families.json', families);
    return f;
  });
  res.json(publicFamilies([family])[0]);
}));

app.delete('/api/families/:id', route('host', async (req, res) => {
  await serialized(async () => {
    const families = await loadFamilies();
    await writeJSON('families.json', families.filter(f => f.id !== req.params.id));
    const food = await readJSON('food.json');
    await writeJSON('food.json', food.filter(i => i.familyId !== req.params.id));
  });
  res.json({ success: true });
}));

app.post('/api/families/:id/members', route('guest', async (req, res) => {
  if (!canEdit(req.who, req.params.id)) return forbidden(res);
  const name = clean(req.body.name, LIMITS.name);
  if (!name) return bad(res, 'Name is required');
  const result = await serialized(async () => {
    const families = await loadFamilies();
    const family = families.find(f => f.id === req.params.id);
    if (!family) return null;
    const member = normalizeMember({ id: newId(), name, status: 'invited' });
    family.members.push(member);
    await writeJSON('families.json', families);
    return member;
  });
  result ? res.json(result) : missing(res, 'Family');
}));

app.put('/api/families/:familyId/members/:memberId', route('guest', async (req, res) => {
  if (!canEdit(req.who, req.params.familyId)) return forbidden(res);
  const { status, swap, karaoke } = req.body;
  if (status !== undefined && !STATUSES.includes(status)) return bad(res, 'Unknown status');
  const result = await serialized(async () => {
    const families = await loadFamilies();
    const member = families.find(f => f.id === req.params.familyId)
      ?.members.find(m => m.id === req.params.memberId);
    if (!member) return null;
    if (status !== undefined) member.status = status;
    if (swap !== undefined) member.swap = Boolean(swap);
    if (karaoke !== undefined) member.karaoke = Boolean(karaoke);
    if (member.status !== 'coming') { member.swap = false; member.karaoke = false; }
    await writeJSON('families.json', families);
    return member;
  });
  result ? res.json(result) : missing(res, 'Person');
}));

app.delete('/api/families/:familyId/members/:memberId', route('guest', async (req, res) => {
  if (!canEdit(req.who, req.params.familyId)) return forbidden(res);
  await serialized(async () => {
    const families = await loadFamilies();
    const family = families.find(f => f.id === req.params.familyId);
    if (family) family.members = family.members.filter(m => m.id !== req.params.memberId);
    await writeJSON('families.json', families);
  });
  res.json({ success: true });
}));

// ---------- food ----------

app.get('/api/food', route('guest', async (req, res) => res.json(await readJSON('food.json'))));

app.post('/api/food', route('guest', async (req, res) => {
  const item = clean(req.body.item, LIMITS.item);
  const familyId = clean(req.body.familyId, 64);
  if (!item || !familyId) return bad(res, 'Food item is required');
  if (!canEdit(req.who, familyId)) return forbidden(res);
  const result = await serialized(async () => {
    const families = await loadFamilies();
    if (!families.some(f => f.id === familyId)) return null;
    const food = await readJSON('food.json');
    const entry = { id: newId(), familyId, item };
    food.push(entry);
    await writeJSON('food.json', food);
    return entry;
  });
  result ? res.json(result) : missing(res, 'Family');
}));

app.delete('/api/food/:id', route('guest', async (req, res) => {
  const result = await serialized(async () => {
    const food = await readJSON('food.json');
    const entry = food.find(i => i.id === req.params.id);
    if (!entry) return 'gone';
    if (!canEdit(req.who, entry.familyId)) return 'forbidden';
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

  // A family can only request as one of its own people. Hosts can pick any family.
  const familyId = req.who.host ? req.body.familyId : req.who.family.id;
  const families = await loadFamilies();
  const family = families.find(f => f.id === familyId);
  const member = family?.members.find(m => m.id === req.body.memberId);
  if (!family || !member) return bad(res, 'Pick who’s asking');

  const ok = await serialized(async () => {
    const requests = await readJSON('karaoke.json');
    if (requests.length >= LIMITS.karaokeTotal) return false;
    requests.push({
      id: newId(), song, artist, note,
      familyId: family.id, memberId: member.id, from: member.name, family: family.name,
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

fs.mkdir(DATA_DIR, { recursive: true }).then(() => {
  app.listen(PORT, () => console.log(`🎄 Christmas Party Planner running on http://localhost:${PORT}`));
});
