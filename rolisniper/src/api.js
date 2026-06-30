// Rolimons API calls for the sniper bot.
// Only reads public data — no authentication needed.

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://www.rolimons.com/',
};

// ---------- Item catalog cache ----------
let itemCatalogCache = null;
let itemCatalogFetchedAt = 0;
const CATALOG_TTL_MS = 5 * 60 * 1000;

async function getItemCatalog() {
  const now = Date.now();
  if (itemCatalogCache && (now - itemCatalogFetchedAt) < CATALOG_TTL_MS) {
    return itemCatalogCache;
  }
  const res = await fetch('https://www.rolimons.com/itemapi/itemdetails', { headers: HEADERS });
  if (!res.ok) throw new Error(`itemdetails fetch failed: ${res.status}`);
  const data = await res.json();
  const list = Object.entries(data.items || {}).map(([id, fields]) => ({
    id,
    name: fields[0],
    acronym: fields[1],
    rap: fields[2],
    value: fields[3],
  }));
  itemCatalogCache = list;
  itemCatalogFetchedAt = now;
  return list;
}

async function searchItemCatalog(query) {
  const list = await getItemCatalog();
  const q = query.toLowerCase();
  return list
    .filter(item =>
      item.name.toLowerCase().includes(q) ||
      (item.acronym && item.acronym.toLowerCase().includes(q))
    )
    .slice(0, 25);
}

// ---------- Trade ad feed ----------
// Rolimons officially documents this for bot use.
// Returns all trade ads posted in the past 3 minutes.
async function getRecentTradeAds() {
  const res = await fetch('https://api.rolimons.com/tradeads/v1/getrecentads', {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`getrecentads failed: ${res.status}`);
  return res.json();
}

// ---------- Player thumbnail ----------
async function getPlayerThumbnail(userId) {
  try {
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`,
      { headers: { 'User-Agent': HEADERS['User-Agent'] } }
    );
    const data = await res.json();
    return data?.data?.[0]?.imageUrl || null;
  } catch {
    return null;
  }
}

// ---------- Player ID lookup ----------
async function getPlayerIdByUsername(username) {
  const res = await fetch(
    `https://api.rolimons.com/players/v1/playersearch?searchstring=${encodeURIComponent(username)}`,
    { headers: HEADERS }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.players?.[0]?.[0] ?? null;
}

module.exports = {
  getItemCatalog,
  searchItemCatalog,
  getRecentTradeAds,
  getPlayerThumbnail,
  getPlayerIdByUsername,
};
