// State
let families = [];
let foodItems = [];
let config = null;
let currentTab = 'families';

// Tab Navigation
function switchTab(tabId) {
    currentTab = tabId;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabId}`);
    });

    // Close mobile menu after selection
    closeMobileMenu();

    // Render tab-specific content
    if (tabId === 'food') {
        renderAllFood();
    } else if (tabId === 'yankee-swap') {
        renderSwappers();
    }
}

function toggleMobileMenu() {
    const hamburger = document.querySelector('.hamburger-btn');
    const tabButtons = document.querySelector('.tab-buttons');

    hamburger.classList.toggle('open');
    tabButtons.classList.toggle('open');
}

function closeMobileMenu() {
    const hamburger = document.querySelector('.hamburger-btn');
    const tabButtons = document.querySelector('.tab-buttons');

    hamburger.classList.remove('open');
    tabButtons.classList.remove('open');
}

// Initialize app
async function init() {
    try {
        await loadConfig();
        await loadFamilies();
        await loadFood();
        applyConfig();
        renderFamilies();
        updateCounts();
        startCountdown();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        document.getElementById('stickyTitle').textContent = 'Error loading - check console';
    }
}

// Load and apply config
async function loadConfig() {
    const response = await fetch('/api/config');
    if (!response.ok) {
        throw new Error(`Config API failed: ${response.status}`);
    }
    config = await response.json();
}

function applyConfig() {
    if (!config) return;

    const { party, yankeeSwap } = config;

    // Update page title
    document.title = `${party.title} - ${party.hosts}'s`;

    // Update sticky header
    document.getElementById('stickyTitle').textContent = party.title;
    document.getElementById('stickyDate').textContent = party.dateShort;
    document.getElementById('stickyLocation').textContent = party.hosts + "'s";
    document.getElementById('stickyTime').textContent = party.time;

    // Update Yankee Swap section
    if (yankeeSwap && yankeeSwap.enabled) {
        document.getElementById('yankeeSwapSection').style.display = 'block';
        document.getElementById('giftLimit').textContent = yankeeSwap.giftLimit;
        document.getElementById('giftLimitRules').textContent = yankeeSwap.giftLimit;
        document.getElementById('whoPlays').textContent = yankeeSwap.whoPlays;
        document.getElementById('finalNote').textContent = yankeeSwap.finalNote;
    } else {
        document.getElementById('yankeeSwapSection').style.display = 'none';
        document.querySelector('.yankee-link-btn').style.display = 'none';
        document.querySelector('.swapper-box').style.display = 'none';
        // Hide Yankee Swap tab and switch to Families tab
        document.querySelector('[data-tab="yankee-swap"]').style.display = 'none';
        switchTab('families');
    }
}

// Countdown Timer
function startCountdown() {
    if (!config) return;
    const partyDate = new Date(config.party.partyDateTime).getTime();

    function updateCountdown() {
        const now = new Date().getTime();
        const distance = partyDate - now;

        if (distance < 0) {
            // Party has started or passed
            document.getElementById('days').textContent = '0';
            document.getElementById('hours').textContent = '0';
            document.getElementById('minutes').textContent = '0';
            document.getElementById('seconds').textContent = '0';
            document.querySelector('.countdown-label').textContent = "Party Time! 🎉";
            return;
        }

        // Calculate time units
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        // Update display
        document.getElementById('days').textContent = days;
        document.getElementById('hours').textContent = hours;
        document.getElementById('minutes').textContent = minutes;
        document.getElementById('seconds').textContent = seconds;
    }

    // Update immediately and then every second
    updateCountdown();
    setInterval(updateCountdown, 1000);
}

// API calls
async function loadFamilies() {
    const response = await fetch('/api/families');
    families = await response.json();
}

async function loadFood() {
    const response = await fetch('/api/food');
    foodItems = await response.json();
}

async function createFamily(name) {
    const response = await fetch('/api/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    return await response.json();
}

async function updateFamily(id, updates) {
    const response = await fetch(`/api/families/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    return await response.json();
}

async function deleteFamily(id) {
    await fetch(`/api/families/${id}`, { method: 'DELETE' });
}

async function addMemberToFamily(familyId, memberName, status = 'invited') {
    const response = await fetch(`/api/families/${familyId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: memberName, status })
    });
    return await response.json();
}

async function updateMemberStatus(familyId, memberId, status) {
    const response = await fetch(`/api/families/${familyId}/members/${memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    });
    return await response.json();
}

async function removeMemberFromFamily(familyId, memberId) {
    await fetch(`/api/families/${familyId}/members/${memberId}`, {
        method: 'DELETE'
    });
}

async function addFoodItem(familyId, item) {
    const response = await fetch('/api/food', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId, item })
    });
    return await response.json();
}

async function deleteFoodItem(id) {
    await fetch(`/api/food/${id}`, { method: 'DELETE' });
}

// UI Functions - Family Management
function showAddFamilyForm() {
    document.getElementById('addFamilyForm').style.display = 'flex';
    document.getElementById('familyNameInput').focus();
}

function hideAddFamilyForm() {
    document.getElementById('addFamilyForm').style.display = 'none';
    document.getElementById('familyNameInput').value = '';
}

async function addFamily() {
    const nameInput = document.getElementById('familyNameInput');
    const name = nameInput.value.trim();

    if (!name) {
        alert('Please enter a family name');
        return;
    }

    await createFamily(name);
    await loadFamilies();
    renderFamilies();
    updateCounts();
    hideAddFamilyForm();
}

async function removeFamilyById(id) {
    if (!confirm('Are you sure you want to remove this family?')) {
        return;
    }

    await deleteFamily(id);
    await loadFamilies();
    await loadFood();
    renderFamilies();
    updateCounts();
}

async function addMember(familyId) {
    const input = document.getElementById(`member-input-${familyId}`);
    const name = input.value.trim();

    if (!name) {
        alert('Please enter a name');
        return;
    }

    await addMemberToFamily(familyId, name, 'invited');
    await loadFamilies();
    renderFamilies();
    updateCounts();
    input.value = '';
}

async function removeMember(familyId, memberId) {
    await removeMemberFromFamily(familyId, memberId);
    await loadFamilies();
    renderFamilies();
    updateCounts();
}

async function changeMemberStatus(familyId, memberId, newStatus) {
    await updateMemberStatus(familyId, memberId, newStatus);
    await loadFamilies();
    renderFamilies();
    updateCounts();
}

// Drag and Drop
let draggedMember = null;

function handleDragStart(e, familyId, memberId) {
    draggedMember = { familyId, memberId };
    e.target.classList.add('dragging');
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedMember = null;
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e, familyId, newStatus) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');

    if (draggedMember && draggedMember.familyId === familyId) {
        await changeMemberStatus(familyId, draggedMember.memberId, newStatus);
    }
}

// Mobile arrow navigation for moving between columns
const statusOrder = ['invited', 'swapping', 'attending', 'notcoming'];

async function moveMemberUp(familyId, memberId, currentStatus) {
    const currentIndex = statusOrder.indexOf(currentStatus);
    if (currentIndex > 0) {
        const newStatus = statusOrder[currentIndex - 1];
        await changeMemberStatus(familyId, memberId, newStatus);
    }
}

async function moveMemberDown(familyId, memberId, currentStatus) {
    const currentIndex = statusOrder.indexOf(currentStatus);
    if (currentIndex < statusOrder.length - 1) {
        const newStatus = statusOrder[currentIndex + 1];
        await changeMemberStatus(familyId, memberId, newStatus);
    }
}

function renderFamilies() {
    const container = document.getElementById('familiesList');

    if (families.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No families added yet. Click "Add Family" to get started!</p>';
        return;
    }

    container.innerHTML = families.map(family => {
        const familyFoodItems = foodItems.filter(item => item.familyId === family.id);

        // Group members by status
        const invited = family.members.filter(m => !m.status || m.status === 'invited');
        const swapping = family.members.filter(m => m.status === 'swapping');
        const attending = family.members.filter(m => m.status === 'attending');
        const notcoming = family.members.filter(m => m.status === 'notcoming');

        const renderMemberTag = (member, status) => {
            const statusIndex = statusOrder.indexOf(status);
            const canMoveUp = statusIndex > 0;
            const canMoveDown = statusIndex < statusOrder.length - 1;

            return `
            <div class="member-tag status-${status}"
                 draggable="true"
                 ondragstart="handleDragStart(event, '${family.id}', '${member.id}')"
                 ondragend="handleDragEnd(event)">
                <div class="mobile-arrows">
                    <button class="arrow-btn arrow-up ${canMoveUp ? '' : 'disabled'}"
                            onclick="event.stopPropagation(); ${canMoveUp ? `moveMemberUp('${family.id}', '${member.id}', '${status}')` : ''}"
                            title="Move up"
                            ${canMoveUp ? '' : 'disabled'}>▲</button>
                    <button class="arrow-btn arrow-down ${canMoveDown ? '' : 'disabled'}"
                            onclick="event.stopPropagation(); ${canMoveDown ? `moveMemberDown('${family.id}', '${member.id}', '${status}')` : ''}"
                            title="Move down"
                            ${canMoveDown ? '' : 'disabled'}>▼</button>
                </div>
                <span class="member-name">${escapeHtml(member.name)}</span>
                <button class="remove-member" onclick="removeMember('${family.id}', '${member.id}')" title="Remove">×</button>
            </div>
        `};


        const renderColumn = (title, members, status, colorClass) => `
            <div class="member-column ${colorClass}"
                 ondragover="handleDragOver(event)"
                 ondragleave="handleDragLeave(event)"
                 ondrop="handleDrop(event, '${family.id}', '${status}')">
                <div class="column-header">${title}</div>
                <div class="column-members">
                    ${members.length > 0
                        ? members.map(m => renderMemberTag(m, status)).join('')
                        : '<div class="empty-column">Move people here</div>'
                    }
                </div>
            </div>
        `;

        return `
        <div class="family-card">
            <div class="family-header">
                <div class="family-name">${escapeHtml(family.name)}</div>
                <button class="btn btn-danger btn-small" onclick="removeFamilyById('${family.id}')">Remove Family</button>
            </div>

            <div class="members-section">
                <div class="add-member-form">
                    <input type="text"
                           id="member-input-${family.id}"
                           placeholder="Add a person..."
                           onkeypress="if(event.key === 'Enter') addMember('${family.id}')">
                    <button class="btn btn-primary btn-small" onclick="addMember('${family.id}')">Add Person</button>
                </div>

                <div class="member-columns">
                    ${renderColumn('Invited', invited, 'invited', 'col-invited')}
                    ${renderColumn('Coming + Swapping', swapping, 'swapping', 'col-swapping')}
                    ${renderColumn('Coming (No Swap)', attending, 'attending', 'col-attending')}
                    ${renderColumn('Not Coming', notcoming, 'notcoming', 'col-notcoming')}
                </div>
            </div>

            <div class="food-section-inline">
                <strong>🍽️ Bringing to the Party:</strong>
                ${familyFoodItems.length > 0 ? `
                    <ul class="food-items-inline">
                        ${familyFoodItems.map(item => `
                            <li class="food-item-inline">
                                <span>${escapeHtml(item.item)}</span>
                                <button class="btn btn-danger btn-small" onclick="removeFood('${item.id}')">Remove</button>
                            </li>
                        `).join('')}
                    </ul>
                ` : '<p class="no-food-yet">No items added yet</p>'}
                <div class="add-food-form">
                    <input type="text"
                           id="food-input-${family.id}"
                           placeholder="What is this family bringing?"
                           onkeypress="if(event.key === 'Enter') addFood('${family.id}')">
                    <button class="btn btn-primary btn-small" onclick="addFood('${family.id}')">Add Item</button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// Render swappers list for Yankee Swap tab
function renderSwappers() {
    const container = document.getElementById('swappersList');
    if (!container) return;

    const swappers = [];
    families.forEach(family => {
        family.members.forEach(member => {
            if (member.status === 'swapping') {
                swappers.push({ name: member.name, familyName: family.name });
            }
        });
    });

    if (swappers.length === 0) {
        container.innerHTML = '<p class="no-swappers">No swappers yet. Move people to "Coming + Swapping" in the Families tab!</p>';
        return;
    }

    container.innerHTML = `
        <ul class="swappers-names">
            ${swappers.map(s => `<li>${escapeHtml(s.name)} <span class="swapper-family">(${escapeHtml(s.familyName)})</span></li>`).join('')}
        </ul>
    `;
}

// Render all food items for the Food tab
function renderAllFood() {
    const container = document.getElementById('allFoodList');

    if (!foodItems || foodItems.length === 0) {
        container.innerHTML = '<p class="no-food-message">No food items yet. Add them in the Families tab!</p>';
        return;
    }

    // Group food items by family
    const foodByFamily = {};
    foodItems.forEach(item => {
        const family = families.find(f => f.id === item.familyId);
        const familyName = family ? family.name : 'Unknown Family';

        if (!foodByFamily[familyName]) {
            foodByFamily[familyName] = [];
        }
        foodByFamily[familyName].push(item);
    });

    // Render grouped food items
    container.innerHTML = Object.entries(foodByFamily).map(([familyName, items]) => `
        <div class="food-category-card">
            <h3>${escapeHtml(familyName)}</h3>
            <ul class="food-category-list">
                ${items.map(item => `
                    <li class="food-category-item">
                        <span class="food-item-name">${escapeHtml(item.item)}</span>
                    </li>
                `).join('')}
            </ul>
        </div>
    `).join('');
}

// UI Functions - Food Management
async function addFood(familyId) {
    const input = document.getElementById(`food-input-${familyId}`);
    const item = input.value.trim();

    if (!item) {
        alert('Please enter a food item');
        return;
    }

    await addFoodItem(familyId, item);
    await loadFood();
    renderFamilies();
    input.value = '';
}

async function removeFood(id) {
    await deleteFoodItem(id);
    await loadFood();
    renderFamilies();
}

// Update counts
function updateCounts() {
    let guestCount = 0;
    let swapperCount = 0;

    families.forEach(family => {
        family.members.forEach(member => {
            if (member.status === 'swapping') {
                guestCount++;
                swapperCount++;
            } else if (member.status === 'attending') {
                guestCount++;
            }
        });
    });

    document.getElementById('guestCount').textContent = guestCount;
    document.getElementById('swapperCount').textContent = swapperCount;
    document.getElementById('foodCount').textContent = foodItems.length;

    // Update swappers list if on that tab
    if (currentTab === 'yankee-swap') {
        renderSwappers();
    }
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Yankee Swap toggle
function toggleYankeeRules() {
    const rules = document.getElementById('yankeeRules');
    const btn = document.getElementById('expandBtn');
    if (rules.style.display === 'none') {
        rules.style.display = 'block';
        btn.textContent = '▲ Hide Rules';
    } else {
        rules.style.display = 'none';
        btn.textContent = '▼ Show Rules';
    }
}

// Yankee Swap theme music
function toggleTheme(e) {
    if (e) e.stopPropagation();
    const audio = document.getElementById('yankeeTheme');
    const btn = document.getElementById('themeBtn');
    if (audio.paused) {
        audio.play();
        btn.textContent = '🔊 Stop Theme';
    } else {
        audio.pause();
        audio.currentTime = 0;
        btn.textContent = '🎵 Play Theme';
    }
}

// Reset button when audio ends
document.addEventListener('DOMContentLoaded', () => {
    const audio = document.getElementById('yankeeTheme');
    if (audio) {
        audio.addEventListener('ended', () => {
            document.getElementById('themeBtn').textContent = '🎵 Play Theme';
        });
    }
});

// Initialize on page load
init();
