// State
let families = [];
let foodItems = [];

// Initialize app
async function init() {
    await loadFamilies();
    await loadFood();
    renderFamilies();
    updateTotalCount();
    startCountdown();
}

// Countdown Timer
function startCountdown() {
    // Party date: December 13, 2025 at 6 PM
    const partyDate = new Date('December 13, 2025 18:00:00').getTime();

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

async function createFamily(name, status) {
    const response = await fetch('/api/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, status })
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

async function addMemberToFamily(familyId, memberName) {
    const response = await fetch(`/api/families/${familyId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: memberName })
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
    const statusInput = document.getElementById('familyStatusInput');
    const name = nameInput.value.trim();

    if (!name) {
        alert('Please enter a family name');
        return;
    }

    await createFamily(name, statusInput.value);
    await loadFamilies();
    renderFamilies();
    updateTotalCount();
    hideAddFamilyForm();
}

async function removeFamilyById(id) {
    if (!confirm('Are you sure you want to remove this family?')) {
        return;
    }

    await deleteFamily(id);
    await loadFamilies();
    await loadFood(); // Reload food in case this family had items
    renderFamilies();
    updateTotalCount();
}

async function changeStatus(familyId, newStatus) {
    await updateFamily(familyId, { status: newStatus });
    await loadFamilies();
    renderFamilies();
    updateTotalCount();
}

async function addMember(familyId) {
    const input = document.getElementById(`member-input-${familyId}`);
    const name = input.value.trim();

    if (!name) {
        alert('Please enter a name');
        return;
    }

    await addMemberToFamily(familyId, name);
    await loadFamilies();
    renderFamilies();
    updateTotalCount();
    input.value = '';
}

async function removeMember(familyId, memberId) {
    await removeMemberFromFamily(familyId, memberId);
    await loadFamilies();
    renderFamilies();
    updateTotalCount();
}

function renderFamilies() {
    const container = document.getElementById('familiesList');

    if (families.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No families added yet. Click "Add Family" to get started!</p>';
        return;
    }

    container.innerHTML = families.map(family => {
        // Get food items for this family
        const familyFoodItems = foodItems.filter(item => item.familyId === family.id);

        return `
        <div class="family-card">
            <div class="family-header">
                <div class="family-name">${escapeHtml(family.name)}</div>
                <div class="family-controls">
                    <select class="status-selector" onchange="changeStatus('${family.id}', this.value)">
                        <option value="invited" ${family.status === 'invited' ? 'selected' : ''}>📩 Invited</option>
                        <option value="confirmed" ${family.status === 'confirmed' ? 'selected' : ''}>✓ Confirmed</option>
                        <option value="maybe" ${family.status === 'maybe' ? 'selected' : ''}>? Maybe</option>
                        <option value="no" ${family.status === 'no' ? 'selected' : ''}>✗ Not Coming</option>
                    </select>
                    <button class="btn btn-danger btn-small" onclick="removeFamilyById('${family.id}')">Remove Family</button>
                </div>
            </div>

            <div class="members-section">
                <strong>👥 Family Members Attending:</strong>
                <div class="members-list">
                    ${family.members.map(member => `
                        <div class="member-tag">
                            <span class="member-name">${escapeHtml(member.name)}</span>
                            <button class="remove-member" onclick="removeMember('${family.id}', '${member.id}')" title="Remove">×</button>
                        </div>
                    `).join('')}
                </div>
                <div class="member-count">
                    ${family.members.length} ${family.members.length === 1 ? 'person' : 'people'}
                    ${family.status === 'confirmed' ? '(counted in total)' : '(not counted - update status to "Confirmed")'}
                </div>
                <div class="add-member-form">
                    <input type="text"
                           id="member-input-${family.id}"
                           placeholder="Add person attending..."
                           onkeypress="if(event.key === 'Enter') addMember('${family.id}')">
                    <button class="btn btn-primary btn-small" onclick="addMember('${family.id}')">Add Person</button>
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

function renderFood() {
    const container = document.getElementById('foodList');

    if (families.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Add families first to start planning food!</p>';
        return;
    }

    container.innerHTML = families.map(family => {
        const familyFoodItems = foodItems.filter(item => item.familyId === family.id);

        return `
            <div class="food-family">
                <div class="food-family-header">
                    <div class="food-family-name">${escapeHtml(family.name)}</div>
                </div>

                ${familyFoodItems.length > 0 ? `
                    <ul class="food-items">
                        ${familyFoodItems.map(item => `
                            <li class="food-item">
                                <span>${escapeHtml(item.item)}</span>
                                <button class="btn btn-danger btn-small" onclick="removeFood('${item.id}')">Remove</button>
                            </li>
                        `).join('')}
                    </ul>
                ` : '<p style="color: #666; font-style: italic; margin-bottom: 10px;">No items added yet</p>'}

                <div class="add-food-form">
                    <input type="text"
                           id="food-input-${family.id}"
                           placeholder="What is this family bringing?"
                           onkeypress="if(event.key === 'Enter') addFood('${family.id}')">
                    <button class="btn btn-primary btn-small" onclick="addFood('${family.id}')">Add Item</button>
                </div>
            </div>
        `;
    }).join('');
}

// Update total count
function updateTotalCount() {
    const total = families
        .filter(f => f.status === 'confirmed')
        .reduce((sum, f) => sum + f.members.length, 0);

    document.getElementById('totalCountSticky').textContent = total;
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

// Initialize on page load
init();
