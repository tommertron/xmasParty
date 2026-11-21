// ---------- state ----------
let config = {};
let families = [];
let food = [];
let songCount = 0;
let me = null;          // { familyId, name } once a family has signed in
let hostKey = null;
let isHost = false;     // only true once the server has accepted the key
let songbook = [];
let passwords = [];

const $ = id => document.getElementById(id);
const KEYS = { host: 'xmasHostKey', family: 'xmasFamilyPass', member: 'xmasReqMember' };
const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: k => { try { localStorage.removeItem(k); } catch {} },
};

function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message) {
    const t = $('toast');
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- api ----------
async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (hostKey) headers['X-Host-Key'] = hostKey;
    const familyPass = store.get(KEYS.family);
    if (familyPass) headers['X-Family-Pass'] = familyPass;
    const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    return data;
}

async function refresh() {
    [families, food, { count: songCount }] = await Promise.all([
        api('/families'), api('/food'), api('/karaoke/summary'),
    ]);
    render();
}

// Run a change, then reload everything so the page matches what's saved.
async function act(fn, successMessage) {
    try {
        await fn();
        await refresh();
        if (successMessage) toast(successMessage);
    } catch (e) {
        if (e.status === 401) return signedOut('Please sign in again');
        toast(e.message || 'That didn’t work. Try again?');
    }
}

// ---------- signing in ----------
async function enter() {
    // Who are we? Host first, then a remembered family password.
    me = null;
    isHost = false;
    try {
        const who = await api('/me');
        if (who.host) isHost = true; else me = who;
    } catch (e) {
        if (e.status === 429) toast(e.message);
        if (hostKey && e.status === 401) { hostKey = null; store.del(KEYS.host); }
        store.del(KEYS.family);
        return signedOut();
    }

    document.body.classList.add('signed-in');
    document.body.classList.toggle('is-host', isHost);
    $('signedInAs').innerHTML = isHost
        ? 'Host mode: you can change everything'
        : `Signed in as <b>${esc(me.name)}</b>`;

    config = await api('/config/full');
    applyConfig();
    await refresh();
    if (isHost) await Promise.all([loadSongbook(), loadPasswords()]);
}

function signedOut(message) {
    me = null;
    isHost = false;
    store.del(KEYS.family);
    document.body.classList.remove('signed-in', 'is-host');
    if (message) toast(message);
    setTimeout(() => $('loginPassword').focus(), 50);
}

// ---------- config ----------
function applyPublicConfig(party = {}) {
    const year = (party.partyDateTime || '').slice(0, 4) || new Date().getFullYear();
    document.title = `${party.title || 'Christmas Party'} · ${party.hosts || ''}'s`;
    $('hosts').textContent = party.hosts || '';
    $('year').textContent = year;
    $('footerYear').textContent = year;
    $('date').textContent = party.date || '';
    $('timeLong').textContent = party.timeLong || party.time || '';
}

function applyConfig() {
    const { party = {}, yankeeSwap = {}, karaoke = {}, donate } = config;
    applyPublicConfig(party);
    $('rsvpBy').textContent = party.rsvpBy ? `Please RSVP by ${party.rsvpBy}.` : '';

    if (yankeeSwap.enabled) {
        const theme = yankeeSwap.theme || {};
        $('giftLimitNum').textContent = String(yankeeSwap.giftLimit || '$20').replace('$', '');
        $('giftLimit').textContent = yankeeSwap.giftLimit || '$20';
        $('whoPlays').textContent = yankeeSwap.whoPlays || '';
        $('finalNote').textContent = yankeeSwap.finalNote || '';
        $('themeName').textContent = theme.name || 'Anything goes';
        $('themePitch').textContent = theme.pitch || '';
        $('themeFineprint').textContent = theme.fineprint || '';
        $('themeExamples').innerHTML = (theme.examples || []).map(([title, sub, detail]) => `
            <li><span class="ex-title">${esc(title)}</span><span class="ex-sub">${esc(sub)}</span><span class="ex-detail">→ ${esc(detail)}</span></li>
        `).join('');
    } else {
        ['tab-btn-swap', 'stat-swap-box'].forEach(id => $(id).hidden = true);
    }

    if (karaoke.enabled) {
        $('karaokePitch').textContent = karaoke.pitch || '';
    } else {
        ['tab-btn-karaoke', 'stat-karaoke-box'].forEach(id => $(id).hidden = true);
    }

    if (donate?.url) $('donate').href = donate.url;
}

// ---------- countdown ----------
let countdownTimer;
function startCountdown(partyDateTime) {
    const target = new Date(partyDateTime).getTime();
    if (!target) return;
    clearInterval(countdownTimer);
    const tick = () => {
        const left = target - Date.now();
        if (left <= 0) {
            $('countdown').innerHTML = '<p class="party-time">It’s party time! 🎉</p>';
            return clearInterval(countdownTimer);
        }
        const units = { days: 864e5, hours: 36e5, minutes: 6e4, seconds: 1e3 };
        let rest = left;
        for (const [name, ms] of Object.entries(units)) {
            $(`cd-${name}`).textContent = Math.floor(rest / ms);
            rest %= ms;
        }
    };
    countdownTimer = setInterval(tick, 1000);
    tick();
}

// ---------- rendering ----------
const everyone = () => families.flatMap(f => f.members.map(m => ({ ...m, family: f.name })));
const canEdit = familyId => isHost || me?.familyId === familyId;

function render() {
    renderFamilies();
    renderSwappers();
    renderSingers();
    renderMenu();
    renderStats();
    renderRequestForm();
    $('songCount').textContent = songCount;
    $('songCountLabel').textContent = songCount === 1 ? 'song' : 'songs';
}

function renderStats() {
    const people = everyone();
    $('stat-coming').textContent = people.filter(p => p.status === 'coming').length;
    $('stat-swap').textContent = people.filter(p => p.swap).length;
    $('stat-karaoke').textContent = people.filter(p => p.karaoke).length;
    $('stat-food').textContent = food.length;
}

function personRow(m) {
    const coming = m.status === 'coming';
    return `
    <li class="person status-${m.status}" data-member="${esc(m.id)}">
        <span class="person-name">${esc(m.name)}</span>
        <div class="rsvp" role="group" aria-label="RSVP for ${esc(m.name)}">
            <button class="pill ${coming ? 'on yes' : ''}" data-action="status" data-value="coming" aria-pressed="${coming}">Coming</button>
            <button class="pill ${m.status === 'notcoming' ? 'on no' : ''}" data-action="status" data-value="notcoming" aria-pressed="${m.status === 'notcoming'}">Can't</button>
        </div>
        <div class="extras" ${coming ? '' : 'hidden'}>
            ${config.yankeeSwap?.enabled ? `<button class="chip ${m.swap ? 'on' : ''}" data-action="toggle" data-field="swap" aria-pressed="${m.swap}" title="Playing the Yankee Swap">🎁 Swap</button>` : ''}
            ${config.karaoke?.enabled ? `<button class="chip ${m.karaoke ? 'on' : ''}" data-action="toggle" data-field="karaoke" aria-pressed="${m.karaoke}" title="Up for karaoke">🎤 Sing</button>` : ''}
        </div>
        <button class="icon-btn" data-action="remove-person" title="Remove ${esc(m.name)}" aria-label="Remove ${esc(m.name)}">×</button>
    </li>`;
}

function badge(f) {
    const n = f.members.filter(m => m.status === 'coming').length;
    const replied = f.members.some(m => m.status !== 'invited');
    return `<span class="badge ${n ? 'yes' : ''}">${n ? `${n} coming` : replied ? 'Can’t make it' : 'No reply yet'}</span>`;
}

function editableCard(f) {
    const dishes = food.filter(i => i.familyId === f.id);
    return `
    <article class="family card ${me?.familyId === f.id ? 'mine' : ''}" data-family="${esc(f.id)}">
        <header class="family-head"><h3>${esc(f.name)}</h3>${badge(f)}</header>
        <ul class="people">${f.members.map(personRow).join('') || '<li class="muted">Nobody added yet.</li>'}</ul>
        <form class="inline-form small" data-form="add-person">
            <input name="name" maxlength="60" placeholder="Add a person…" required>
            <button class="btn btn-small btn-ghost">Add</button>
        </form>
        <div class="bringing">
            <h4>🍽️ Bringing</h4>
            ${dishes.length ? `<ul class="dishes">${dishes.map(d => `
                <li>${esc(d.item)} <button class="icon-btn" data-action="remove-food" data-food="${esc(d.id)}" aria-label="Remove ${esc(d.item)}">×</button></li>`).join('')}</ul>` : ''}
            <form class="inline-form small" data-form="add-food">
                <input name="item" maxlength="120" placeholder="What are you bringing?" required>
                <button class="btn btn-small btn-ghost">Add</button>
            </form>
        </div>
        ${isHost ? '<button class="link-btn" data-action="remove-family">Remove this family (host)</button>' : ''}
    </article>`;
}

function readOnlyCard(f) {
    const icon = m => (m.swap ? ' 🎁' : '') + (m.karaoke ? ' 🎤' : '');
    return `
    <article class="family card readonly">
        <header class="family-head"><h3>${esc(f.name)}</h3>${badge(f)}</header>
        <ul class="ro-people">${f.members.map(m => `<li class="${m.status}">${esc(m.name)}${icon(m)}</li>`).join('')}</ul>
    </article>`;
}

function renderFamilies() {
    if (!families.length) {
        $('families').innerHTML = '<p class="empty card">No families yet.</p>';
        return;
    }
    if (isHost) {
        $('families').innerHTML = families.map(editableCard).join('');
        return;
    }
    const mine = families.find(f => f.id === me?.familyId);
    const others = families.filter(f => f !== mine);
    $('families').innerHTML =
        (mine ? editableCard(mine) : '') +
        (others.length ? `<p class="section-label">Everyone else</p>${others.map(readOnlyCard).join('')}` : '');
}

// "Who's asking?" dropdown: your own family's people (hosts pick a family first).
function renderRequestForm() {
    const famSel = $('reqFamily');
    if (isHost) {
        const keep = famSel.value;
        famSel.innerHTML = families.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
        if (families.some(f => f.id === keep)) famSel.value = keep;
    }
    const fam = families.find(f => f.id === (isHost ? famSel.value : me?.familyId));
    const memSel = $('reqMember');
    const keep = memSel.value || store.get(KEYS.member) || '';
    memSel.innerHTML = '<option value="">Choose…</option>' +
        (fam?.members || []).map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    if (fam?.members.some(m => m.id === keep)) memSel.value = keep;
}

function nameList(people, emptyText) {
    if (!people.length) return `<p class="empty">${emptyText}</p>`;
    return `<ul class="name-list">${people.map(p => `<li>${esc(p.name)} <small>${esc(p.family)}</small></li>`).join('')}</ul>`;
}

function renderSwappers() {
    $('swappers').innerHTML = nameList(everyone().filter(p => p.swap), 'Nobody yet. Who’s brave enough to go first?');
}

function renderSingers() {
    $('singers').innerHTML = nameList(everyone().filter(p => p.karaoke), 'No singers yet. The mic is waiting.');
}

function renderMenu() {
    if (!food.length) {
        $('menu').innerHTML = '<p class="empty card">Nothing on the menu yet. Be the hero who brings dessert.</p>';
        return;
    }
    $('menu').innerHTML = families
        .map(f => ({ f, items: food.filter(i => i.familyId === f.id) }))
        .filter(x => x.items.length)
        .map(({ f, items }) => `
            <div class="card menu-card">
                <h3>${esc(f.name)}</h3>
                <ul>${items.map(i => `<li>${esc(i.item)}</li>`).join('')}</ul>
            </div>`).join('');
}

// ---------- host (secret songbook + family passwords) ----------
function hostKeyFromUrl() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('host');
    if (fromUrl) {
        store.set(KEYS.host, fromUrl);
        params.delete('host');
        const qs = params.toString();
        history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    }
    return fromUrl || store.get(KEYS.host);
}

async function loadSongbook() {
    if (!isHost) return;
    songbook = await api('/karaoke');
    if (!songbook.length) {
        $('songbook').innerHTML = '<p class="empty">No requests yet.</p>';
        return;
    }
    const sorted = [...songbook].sort((a, b) => a.at.localeCompare(b.at));
    $('songbook').innerHTML = `<ol class="songbook">${sorted.map(r => `
        <li>
            <div><b>${esc(r.song)}</b>${r.artist ? ` <span class="muted">· ${esc(r.artist)}</span>` : ''}</div>
            <div class="muted small">from ${esc(r.from || 'someone')}${r.family ? ` (${esc(r.family)})` : ''}${r.note ? ` · “${esc(r.note)}”` : ''}</div>
            <button class="icon-btn" data-action="remove-song" data-song="${esc(r.id)}" aria-label="Remove ${esc(r.song)}">×</button>
        </li>`).join('')}</ol>`;
}

async function loadPasswords() {
    if (!isHost) return;
    passwords = await api('/host/families');
    $('passwords').innerHTML = passwords.map(p => `
        <li data-family="${esc(p.id)}">
            <b>${esc(p.name)}</b>
            <code>${esc(p.password)}</code>
            <button class="btn btn-small btn-ghost" type="button" data-action="new-password">New password</button>
        </li>`).join('') || '<li class="muted">No families yet.</li>';
}

// ---------- tabs ----------
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
    if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
    if (tab === 'karaoke' && isHost) loadSongbook().catch(() => {});
}

// ---------- events ----------
document.addEventListener('click', async e => {
    const tabBtn = e.target.closest('[data-tab], [data-goto]');
    if (tabBtn) {
        switchTab(tabBtn.dataset.tab || tabBtn.dataset.goto);
        if (tabBtn.dataset.goto) document.querySelector('.tabs').scrollIntoView({ behavior: 'smooth' });
        return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const familyId = btn.closest('[data-family]')?.dataset.family;
    const memberId = btn.closest('[data-member]')?.dataset.member;
    const member = families.find(f => f.id === familyId)?.members.find(m => m.id === memberId);
    const memberPath = `/families/${familyId}/members/${memberId}`;

    switch (btn.dataset.action) {
        case 'status': {
            // Tapping the selected answer again clears it back to "no reply yet".
            const status = member.status === btn.dataset.value ? 'invited' : btn.dataset.value;
            const msg = status === 'coming' ? `🎉 ${member.name} is coming!` : status === 'notcoming' ? `We'll miss you, ${member.name}` : null;
            return act(() => api(memberPath, { method: 'PUT', body: { status } }), msg);
        }
        case 'toggle': {
            const field = btn.dataset.field;
            return act(() => api(memberPath, { method: 'PUT', body: { [field]: !member[field] } }));
        }
        case 'remove-person':
            if (!confirm(`Remove ${member.name} from the list?`)) return;
            return act(() => api(memberPath, { method: 'DELETE' }));
        case 'remove-family': {
            const fam = families.find(f => f.id === familyId);
            if (!confirm(`Remove ${fam.name} and everyone in it?`)) return;
            return act(async () => { await api(`/families/${familyId}`, { method: 'DELETE' }); await loadPasswords(); });
        }
        case 'remove-food':
            return act(() => api(`/food/${btn.dataset.food}`, { method: 'DELETE' }));
        case 'remove-song':
            try {
                await api(`/karaoke/${btn.dataset.song}`, { method: 'DELETE' });
                await loadSongbook();
                await refresh();
            } catch (err) { toast(err.message); }
            return;
        case 'copy-songs': {
            const text = [...songbook].sort((a, b) => a.at.localeCompare(b.at))
                .map(r => `${r.song}${r.artist ? ` – ${r.artist}` : ''} (${r.from})${r.note ? ` [${r.note}]` : ''}`).join('\n');
            try { await navigator.clipboard.writeText(text); toast('Songbook copied'); } catch { toast('Couldn’t copy'); }
            return;
        }
        case 'copy-passwords': {
            const text = passwords.map(p => `${p.name}: ${p.password}`).join('\n');
            try { await navigator.clipboard.writeText(text); toast('Passwords copied'); } catch { toast('Couldn’t copy'); }
            return;
        }
        case 'new-password': {
            const fam = passwords.find(p => p.id === familyId);
            if (!confirm(`Give ${fam.name} a new password? Their old one stops working, and anyone signed in with it gets signed out.`)) return;
            try {
                await api(`/host/families/${familyId}/password`, { method: 'POST' });
                await loadPasswords();
                toast(`New password for ${fam.name}`);
            } catch (err) { toast(err.message); }
            return;
        }
        case 'logout':
            if (isHost) { hostKey = null; store.del(KEYS.host); }
            store.del(KEYS.family);
            return signedOut('Signed out. See you at the party!');
        case 'host-logout':
            hostKey = null;
            store.del(KEYS.host);
            toast('Left host mode');
            return enter();
    }
});

document.addEventListener('submit', async e => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const familyId = form.closest('[data-family]')?.dataset.family;

    switch (form.dataset.form) {
        case 'login':
            try {
                const res = await fetch('/api/login', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: data.password }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || 'That didn’t work');
                store.set(KEYS.family, data.password.trim());
                form.reset();
                await enter();
                toast(`Welcome, ${body.name}! 🎄`);
            } catch (err) {
                toast(err.message);
                $('loginPassword').select();
            }
            return;
        case 'add-family':
            await act(async () => { await api('/families', { method: 'POST', body: data }); await loadPasswords(); }, `Added ${data.name}`);
            break;
        case 'add-person':
            await act(() => api(`/families/${familyId}/members`, { method: 'POST', body: data }));
            break;
        case 'add-food':
            await act(() => api('/food', { method: 'POST', body: { familyId, item: data.item } }), 'Yum. Added to the menu.');
            break;
        case 'karaoke':
            try {
                await api('/karaoke', { method: 'POST', body: data });
                store.set(KEYS.member, data.memberId);
                ['song', 'artist', 'note'].forEach(n => { form.elements[n].value = ''; });
                toast('🤫 Sent to the secret songbook!');
                await refresh();
                if (isHost) await loadSongbook();
            } catch (err) {
                if (err.status === 401) return signedOut('Please sign in again');
                toast(err.message);
            }
            return;
    }
    form.reset();
});

$('reqFamily').addEventListener('change', renderRequestForm);

$('themeBtn').addEventListener('click', () => {
    const audio = $('themeAudio');
    if (audio.paused) {
        audio.play();
        $('themeBtn').textContent = '🔇 Stop the theme song';
    } else {
        audio.pause();
        audio.currentTime = 0;
        $('themeBtn').textContent = '🎵 Play the theme song';
    }
});
$('themeAudio').addEventListener('ended', () => { $('themeBtn').textContent = '🎵 Play the theme song'; });

// ---------- decorations ----------
function decorate() {
    document.querySelector('.lights').innerHTML = '<li></li>'.repeat(28);
    document.querySelector('.snow').innerHTML = Array.from({ length: 18 }, (_, i) =>
        `<i style="left:${(i * 37) % 100}%;animation-duration:${9 + (i * 7) % 9}s;animation-delay:-${(i * 3) % 11}s;font-size:${0.7 + (i % 4) * 0.3}em">${i % 2 ? '❆' : '❅'}</i>`
    ).join('');
}

// ---------- go ----------
async function init() {
    decorate();
    hostKey = hostKeyFromUrl();
    try {
        const { party } = await api('/config');
        applyPublicConfig(party);
        startCountdown(party.partyDateTime);
    } catch (e) {
        console.error(e);
    }
    if (hostKey || store.get(KEYS.family)) await enter(); else signedOut();
    const start = location.hash.slice(1);
    if (['rsvp', 'swap', 'karaoke', 'food'].includes(start)) switchTab(start);
}

init();
