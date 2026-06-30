const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'users.json');

function loadAll() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}

function saveAll(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getUser(discordId) {
  return loadAll()[discordId] || null;
}

function setUser(discordId, patch) {
  const all = loadAll();
  all[discordId] = { ...(all[discordId] || {}), ...patch };
  saveAll(all);
  return all[discordId];
}

module.exports = { getUser, setUser };
