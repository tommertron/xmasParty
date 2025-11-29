const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

// Helper functions for reading/writing JSON
async function readJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  try {
    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return empty array
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeJSON(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
}

// API Endpoints - Families
app.get('/api/families', async (req, res) => {
  try {
    const families = await readJSON('families.json');
    res.json(families);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read families' });
  }
});

app.post('/api/families', async (req, res) => {
  try {
    const families = await readJSON('families.json');
    const newFamily = {
      id: Date.now().toString(),
      name: req.body.name,
      status: req.body.status || 'maybe',
      members: []
    };
    families.push(newFamily);
    await writeJSON('families.json', families);
    res.json(newFamily);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create family' });
  }
});

app.put('/api/families/:id', async (req, res) => {
  try {
    const families = await readJSON('families.json');
    const index = families.findIndex(f => f.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Family not found' });
    }
    families[index] = { ...families[index], ...req.body };
    await writeJSON('families.json', families);
    res.json(families[index]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update family' });
  }
});

app.delete('/api/families/:id', async (req, res) => {
  try {
    const families = await readJSON('families.json');
    const filtered = families.filter(f => f.id !== req.params.id);
    await writeJSON('families.json', filtered);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete family' });
  }
});

// API Endpoints - Family Members
app.post('/api/families/:id/members', async (req, res) => {
  try {
    const families = await readJSON('families.json');
    const family = families.find(f => f.id === req.params.id);
    if (!family) {
      return res.status(404).json({ error: 'Family not found' });
    }
    const newMember = {
      id: Date.now().toString(),
      name: req.body.name,
      status: req.body.status || 'invited'
    };
    family.members.push(newMember);
    await writeJSON('families.json', families);
    res.json(newMember);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});

app.put('/api/families/:familyId/members/:memberId', async (req, res) => {
  try {
    const families = await readJSON('families.json');
    const family = families.find(f => f.id === req.params.familyId);
    if (!family) {
      return res.status(404).json({ error: 'Family not found' });
    }
    const member = family.members.find(m => m.id === req.params.memberId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    Object.assign(member, req.body);
    await writeJSON('families.json', families);
    res.json(member);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update member' });
  }
});

app.delete('/api/families/:familyId/members/:memberId', async (req, res) => {
  try {
    const families = await readJSON('families.json');
    const family = families.find(f => f.id === req.params.familyId);
    if (!family) {
      return res.status(404).json({ error: 'Family not found' });
    }
    family.members = family.members.filter(m => m.id !== req.params.memberId);
    await writeJSON('families.json', families);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// API Endpoints - Food Items
app.get('/api/food', async (req, res) => {
  try {
    const foodItems = await readJSON('food.json');
    res.json(foodItems);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read food items' });
  }
});

app.post('/api/food', async (req, res) => {
  try {
    const foodItems = await readJSON('food.json');
    const newItem = {
      id: Date.now().toString(),
      familyId: req.body.familyId,
      item: req.body.item
    };
    foodItems.push(newItem);
    await writeJSON('food.json', foodItems);
    res.json(newItem);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add food item' });
  }
});

app.delete('/api/food/:id', async (req, res) => {
  try {
    const foodItems = await readJSON('food.json');
    const filtered = foodItems.filter(f => f.id !== req.params.id);
    await writeJSON('food.json', filtered);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete food item' });
  }
});

// Start server
ensureDataDir().then(() => {
  app.listen(PORT, () => {
    console.log(`🎄 Christmas Party Planner running on http://localhost:${PORT}`);
  });
});
