// ---------- state ----------
let config = {};
let people = [];        // everyone, once signed in
let names = [];         // the public guest list: { id, name, claimed }
let food = [];
let songCount = 0;
let me = null;          // { groupId, code, names } once signed in with a code
let hostKey = null;
let isHost = false;     // only true once the server has accepted the key
let songbook = [];
let codes = [];

const $ = id => document.getElementById(id);
const KEYS = { host: 'xmasHostKey', code: 'xmasCode', member: 'xmasReqMember' };
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

// "Tom", "Tom & Erin", "Tom, Erin & Maggie"
function joinNames(list) {
    if (list.length < 3) return list.join(' & ');
    return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
}

// ---------- api ----------
async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (hostKey) headers['X-Host-Key'] = hostKey;
    const code = store.get(KEYS.code);
    if (code) headers['X-Code'] = code;
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
    [people, food, { count: songCount }, names] = await Promise.all([
        api('/people'), api('/food'), api('/karaoke/summary'), api('/names'),
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
    // Who are we? Host first, then a remembered code.
    me = null;
    isHost = false;
    try {
        const who = await api('/me');
        if (who.host) isHost = true; else me = who;
    } catch (e) {
        if (e.status === 429) toast(e.message);
        if (hostKey && e.status === 401) { hostKey = null; store.del(KEYS.host); }
        store.del(KEYS.code);
        return signedOut();
    }

    document.body.classList.add('signed-in');
    document.body.classList.toggle('is-host', isHost);
    $('signedInAs').innerHTML = isHost
        ? 'Host mode: you can change everything'
        : `Your code: <code class="my-code">${esc(me.code)}</code> <button class="link-btn" type="button" data-action="copy-code">Copy</button> · share it with your household`;

    config = await api('/config/full');
    applyConfig();
    await refresh();
    if (isHost) await Promise.all([loadSongbook(), loadCodes()]);
}

async function signedOut(message) {
    me = null;
    isHost = false;
    store.del(KEYS.code);
    document.body.classList.remove('signed-in', 'is-host');
    if (message) toast(message);
    try {
        names = await api('/names');
    } catch { names = []; }
    renderNamePicker($('nameList'), 'Nobody on the list yet.');
}

// ---------- claiming a name ----------
function ask(dialog) {
    return new Promise(resolve => {
        dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
        dialog.returnValue = '';
        dialog.showModal();
    });
}

async function claim(personId) {
    const person = names.find(n => n.id === personId);
    if (!person || person.claimed) return;
    const hadCode = Boolean(store.get(KEYS.code));
    $('claimText').innerHTML = hadCode
        ? `Add <b>${esc(person.name)}</b> to your code? You'll be able to change their RSVP.`
        : `You're about to RSVP as, or for, <b>${esc(person.name)}</b>.`;
    $('claimYes').textContent = hadCode ? `Yes, add ${person.name}` : 'Yes, that’s us';
    if (await ask($('claimDialog')) !== 'yes') return;

    try {
        const res = await api(`/names/${personId}/claim`, { method: 'POST' });
        store.set(KEYS.code, res.code);
        if (!hadCode) {
            $('codeShown').textContent = res.code;
            await enter();
            await ask($('codeDialog'));
            toast(`Welcome, ${person.name}! 🎄`);
        } else {
            await enter();
            toast(`${person.name} is on your code now`);
        }
    } catch (e) {
        if (e.status === 401 && hadCode) { await signedOut('Please sign in again'); return; }
        toast(e.message);
        names = await api('/names').catch(() => names);
        if (document.body.classList.contains('signed-in')) render(); else renderNamePicker($('nameList'));
    }
}

function renderNamePicker(el, emptyText = '') {
    const open = names.filter(n => !n.claimed);
    const taken = names.filter(n => n.claimed);
    if (!names.length) { el.innerHTML = `<p class="muted">${emptyText}</p>`; return; }
    el.innerHTML =
        (open.length
            ? open.map(n => `<button class="name-btn" type="button" data-action="claim" data-person="${esc(n.id)}">${esc(n.name)}</button>`).join('')
            : '<p class="muted">Everyone on the list has RSVPed. 🎉</p>') +
        (taken.length && !document.body.classList.contains('signed-in')
            ? `<p class="muted small taken">Already in: ${taken.map(n => esc(n.name)).join(', ')}</p>`
            : '');
}

// ---------- config ----------
function applyPublicConfig(party = {}) {
    const year = (party.partyDateTime || '').slice(0, 4) || new Date().getFullYear();
    document.title = `${party.title || 'Christmas Party'} · ${party.hosts || ''}'s`;
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
const nameOf = groupId => joinNames(people.filter(p => p.groupId === groupId).map(p => p.name));
const canEdit = groupId => isHost || (groupId && me?.groupId === groupId);

function render() {
    renderPeople();
    renderSwappers();
    renderSingers();
    renderMenu();
    renderStats();
    renderRequestForm();
    if (!isHost) renderNamePicker($('claimList'));
    $('claimMore').hidden = isHost || !names.some(n => !n.claimed);
    $('songCount').textContent = songCount;
    $('songCountLabel').textContent = songCount === 1 ? 'song' : 'songs';
}

function renderStats() {
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
        <button class="icon-btn" data-action="remove-person" title="Take ${esc(m.name)} off" aria-label="Take ${esc(m.name)} off">×</button>
    </li>`;
}

function badge(list) {
    const n = list.filter(m => m.status === 'coming').length;
    const replied = list.some(m => m.status !== 'invited');
    return `<span class="badge ${n ? 'yes' : ''}">${n ? `${n} coming` : replied ? 'Can’t make it' : 'No reply yet'}</span>`;
}

// One card per code. groupId null = names nobody has claimed (host only).
function editableCard(groupId, title) {
    const list = people.filter(p => p.groupId === groupId);
    const dishes = groupId ? food.filter(i => i.groupId === groupId) : [];
    return `
    <article class="family card ${me?.groupId === groupId ? 'mine' : ''}" data-group="${esc(groupId || '')}">
        <header class="family-head"><h3>${esc(title)}</h3>${badge(list)}</header>
        <ul class="people">${list.map(personRow).join('') || '<li class="muted">Nobody here.</li>'}</ul>
        ${groupId && !isHost ? `
        <form class="inline-form small" data-form="add-person">
            <input name="name" maxlength="60" placeholder="Someone not on the list? Add them…" required>
            <button class="btn btn-small btn-ghost">Add</button>
        </form>` : ''}
        ${groupId ? `
        <div class="bringing">
            <h4>🍽️ Bringing</h4>
            ${dishes.length ? `<ul class="dishes">${dishes.map(d => `
                <li>${esc(d.item)} <button class="icon-btn" data-action="remove-food" data-food="${esc(d.id)}" aria-label="Remove ${esc(d.item)}">×</button></li>`).join('')}</ul>` : ''}
            <form class="inline-form small" data-form="add-food">
                <input name="item" maxlength="120" placeholder="What are you bringing?" required>
                <button class="btn btn-small btn-ghost">Add</button>
            </form>
        </div>` : ''}
    </article>`;
}

function everyoneCard(list) {
    const icon = m => (m.swap ? ' 🎁' : '') + (m.karaoke ? ' 🎤' : '');
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return `
    <article class="family card readonly">
        <header class="family-head"><h3>Everyone else</h3>${badge(list)}</header>
        <ul class="ro-people">${sorted.map(m => `<li class="${m.status}">${esc(m.name)}${icon(m)}</li>`).join('')}</ul>
    </article>`;
}

function renderPeople() {
    if (!people.length) {
        $('families').innerHTML = '<p class="empty card">Nobody on the list yet.</p>';
        return;
    }
    if (isHost) {
        const groupIds = [...new Set(people.map(p => p.groupId).filter(Boolean))];
        const unclaimed = people.some(p => !p.groupId) ? editableCard(null, 'Not claimed yet') : '';
        $('families').innerHTML = groupIds.map(id => editableCard(id, nameOf(id))).join('') + unclaimed;
        return;
    }
    const others = people.filter(p => p.groupId !== me?.groupId);
    $('families').innerHTML =
        (me ? editableCard(me.groupId, 'You') : '') +
        (others.length ? everyoneCard(others) : '');
}

// "Who's asking?" dropdown: the people on your code (hosts: anyone claimed).
function renderRequestForm() {
    const choices = people.filter(p => (isHost ? p.groupId : p.groupId === me?.groupId));
    const memSel = $('reqMember');
    const keep = memSel.value || store.get(KEYS.member) || '';
    memSel.innerHTML = '<option value="">Choose…</option>' +
        choices.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    if (choices.some(m => m.id === keep)) memSel.value = keep;
}

function nameList(list, emptyText) {
    if (!list.length) return `<p class="empty">${emptyText}</p>`;
    return `<ul class="name-list">${list.map(p => `<li>${esc(p.name)}</li>`).join('')}</ul>`;
}

function renderSwappers() {
    $('swappers').innerHTML = nameList(people.filter(p => p.swap), 'Nobody yet. Who’s brave enough to go first?');
}

function renderSingers() {
    $('singers').innerHTML = nameList(people.filter(p => p.karaoke), 'No singers yet. The mic is waiting.');
}

function renderMenu() {
    if (!food.length) {
        $('menu').innerHTML = '<p class="empty card">Nothing on the menu yet. Be the hero who brings dessert.</p>';
        return;
    }
    const groupIds = [...new Set(food.map(i => i.groupId))];
    $('menu').innerHTML = groupIds.map(id => `
            <div class="card menu-card">
                <h3>${esc(nameOf(id) || 'Someone')}</h3>
                <ul>${food.filter(i => i.groupId === id).map(i => `<li>${esc(i.item)}</li>`).join('')}</ul>
            </div>`).join('');
}

// ---------- host (secret songbook + codes) ----------
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
            <div class="muted small">from ${esc(r.from || 'someone')}${r.note ? ` · “${esc(r.note)}”` : ''}</div>
            <button class="icon-btn" data-action="remove-song" data-song="${esc(r.id)}" aria-label="Remove ${esc(r.song)}">×</button>
        </li>`).join('')}</ol>`;
}

async function loadCodes() {
    if (!isHost) return;
    codes = await api('/host/groups');
    $('codes').innerHTML = codes.map(g => `
        <li data-group="${esc(g.id)}">
            <b>${esc(joinNames(g.names))}</b>
            <code>${esc(g.code)}</code>
            <button class="btn btn-small btn-ghost" type="button" data-action="new-code">New code</button>
        </li>`).join('') || '<li class="muted">Nobody has claimed a name yet.</li>';
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
    const groupId = btn.closest('[data-group]')?.dataset.group;
    const memberId = btn.closest('[data-member]')?.dataset.member;
    const member = people.find(p => p.id === memberId);
    const memberPath = `/people/${memberId}`;

    switch (btn.dataset.action) {
        case 'claim':
            return claim(btn.dataset.person);
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
        case 'remove-person': {
            if (isHost) {
                const unclaim = member.groupId && confirm(`Put ${member.name} back on the list, unclaimed? (Cancel for more options.)`);
                if (unclaim) return act(() => api(`${memberPath}/release`, { method: 'POST' }), `${member.name} is unclaimed`);
                if (!confirm(`Delete ${member.name} from the guest list entirely?`)) return;
                return act(() => api(`${memberPath}/release`, { method: 'POST', body: { remove: true } }), `Removed ${member.name}`);
            }
            if (!confirm(`Take ${member.name} off your code? Their RSVP is cleared and their name goes back on the list.`)) return;
            const lastOne = people.filter(p => p.groupId === me?.groupId).length === 1;
            try {
                await api(`${memberPath}/release`, { method: 'POST' });
            } catch (err) { return toast(err.message); }
            if (lastOne) return signedOut(`${member.name} is back on the list`);
            return act(async () => {}, `${member.name} is off your code`);
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
        case 'copy-code': {
            const code = store.get(KEYS.code) || '';
            try { await navigator.clipboard.writeText(code); toast('Code copied'); } catch { toast('Couldn’t copy'); }
            return;
        }
        case 'copy-codes': {
            const text = codes.map(g => `${joinNames(g.names)}: ${g.code}`).join('\n');
            try { await navigator.clipboard.writeText(text); toast('Codes copied'); } catch { toast('Couldn’t copy'); }
            return;
        }
        case 'new-code': {
            const g = codes.find(c => c.id === groupId);
            if (!confirm(`Give ${joinNames(g.names)} a new code? The old one stops working, and anyone signed in with it gets signed out.`)) return;
            try {
                await api(`/host/groups/${groupId}/code`, { method: 'POST' });
                await loadCodes();
                toast('New code made');
            } catch (err) { toast(err.message); }
            return;
        }
        case 'logout':
            if (!isHost && !confirm(`Sign out? You'll need your code (${store.get(KEYS.code)}) to get back in.`)) return;
            if (isHost) { hostKey = null; store.del(KEYS.host); }
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
    const groupId = form.closest('[data-group]')?.dataset.group;

    switch (form.dataset.form) {
        case 'login':
            try {
                const res = await fetch('/api/login', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: data.code }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || 'That didn’t work');
                store.set(KEYS.code, data.code.trim().toLowerCase().replace(/\s+/g, '-'));
                form.reset();
                await enter();
                toast(`Welcome, ${joinNames(body.names)}! 🎄`);
            } catch (err) {
                toast(err.message);
                $('loginCode').select();
            }
            return;
        case 'add-name':
            await act(() => api('/people', { method: 'POST', body: data }), `Added ${data.name} to the list`);
            break;
        case 'add-person':
            await act(() => api('/people', { method: 'POST', body: data }), `Added ${data.name}`);
            break;
        case 'add-food':
            await act(() => api('/food', { method: 'POST', body: { groupId, item: data.item } }), 'Yum. Added to the menu.');
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
    const oldPass = store.get('xmasFamilyPass'); // last version's family password is now that family's code
    if (oldPass) { if (!store.get(KEYS.code)) store.set(KEYS.code, oldPass); store.del('xmasFamilyPass'); }
    try {
        const { party } = await api('/config');
        applyPublicConfig(party);
        startCountdown(party.partyDateTime);
    } catch (e) {
        console.error(e);
    }
    if (hostKey || store.get(KEYS.code)) await enter(); else await signedOut();
    const start = location.hash.slice(1);
    if (['rsvp', 'swap', 'karaoke', 'food'].includes(start)) switchTab(start);
}

init();
