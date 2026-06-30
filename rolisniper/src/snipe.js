// Snipe engine — polls Rolimons trade ad feed every 2 minutes,
// finds ads requesting a specific item, posts embed notifications.

const { EmbedBuilder } = require('discord.js');
const api = require('./api');

// Active snipes: Map<key, { itemId, itemName, acronym, pingMode, pingThreshold, channel, discordId, handle, seenAdIds }>
const activeSnipes = new Map();

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes, matching Rolimons' ~3 min feed window

function formatValue(val) {
  if (!val || val < 0) return '?';
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(val);
}

function calcDeal(offerValue, requestValue) {
  if (!offerValue || !requestValue || offerValue <= 0 || requestValue <= 0) {
    return { label: 'Unknown value', color: 0x888888, isOverpay: false, diff: 0, pct: 0 };
  }
  const diff = offerValue - requestValue;
  const pct = ((diff / requestValue) * 100);
  const absDiff = Math.abs(diff);

  if (Math.abs(pct) < 2) {
    return { label: 'Even', color: 0x888888, isOverpay: true, diff, pct };
  }
  if (diff > 0) {
    return {
      label: `${formatValue(absDiff)} Overpay`,
      color: 0x00b386,
      isOverpay: true,
      diff,
      pct,
    };
  }
  return {
    label: `${formatValue(absDiff)} Lowball`,
    color: 0xff4444,
    isOverpay: false,
    diff,
    pct,
  };
}

async function buildEmbed(ad, targetItemId, targetItemName, targetItemAcronym, catalog, discordId) {
  // Rolimons getrecentads response shape (confirmed via live API):
  // Each ad is an array:
  // [0] = player_id
  // [1] = username
  // [2] = offer_item_ids []
  // [3] = request_item_ids []
  // [4] = request_tags []
  // [5] = offer_robux
  // NOTE: These indices are our best construction — if the shape is wrong,
  // the bot logs the raw response so we can fix it quickly.
  const offererPlayerId = ad[0];
  const offererUsername = ad[1] || 'Unknown';
  const offerItemIds = ad[2] || [];
  const requestItemIds = ad[3] || [];
  const requestTags = ad[4] || [];
  const offerRobux = ad[5] || 0;

  const catalogById = new Map(catalog.map(i => [String(i.id), i]));

  const offerItems = offerItemIds.map(id => {
    const c = catalogById.get(String(id));
    return { name: c?.name || `Item ${id}`, acronym: c?.acronym || '—', value: c?.value || 0, rap: c?.rap || 0 };
  });

  const requestItems = requestItemIds.map(id => {
    const c = catalogById.get(String(id));
    return { name: c?.name || `Item ${id}`, acronym: c?.acronym || '—', value: c?.value || 0, rap: c?.rap || 0 };
  });

  const totalOfferValue = offerItems.reduce((s, i) => s + i.value, 0);
  const totalRequestValue = requestItems.reduce((s, i) => s + i.value, 0);
  const totalOfferRap = offerItems.reduce((s, i) => s + i.rap, 0);
  const totalRequestRap = requestItems.reduce((s, i) => s + i.rap, 0);

  const deal = calcDeal(totalOfferValue, totalRequestValue);

  const offerLines = [
    ...offerItems.map(i => `**${i.acronym}** - ${formatValue(i.value)}`),
    ...(offerRobux > 0 ? [`**Robux** - ${offerRobux.toLocaleString()}`] : []),
  ].join('\n') || '(nothing)';

  const requestLines = [
    ...requestItems.map(i => `**${i.acronym}** - ${formatValue(i.value)}`),
    ...(requestTags.length ? [`Tags: ${requestTags.join(', ')}`] : []),
  ].join('\n') || '(any)';

  const valueLine = `Value: ${formatValue(totalRequestValue)} → ${formatValue(totalOfferValue)} (${deal.diff > 0 ? '+' : ''}${formatValue(Math.abs(deal.diff))}, ${deal.pct > 0 ? '+' : ''}${deal.pct.toFixed(2)}%)`;
  const rapLine = `RAP: ${formatValue(totalRequestRap)} → ${formatValue(totalOfferRap)}`;

  const thumbnail = await api.getPlayerThumbnail(offererPlayerId);

  const embed = new EmbedBuilder()
    .setTitle(`${deal.label} on ${targetItemName}`)
    .setColor(deal.color)
    .setURL(`https://www.rolimons.com/tradeads`)
    .addFields(
      {
        name: `🟢 ${offererUsername} offering`,
        value: offerLines,
        inline: true,
      },
      {
        name: `🔵 <@${discordId}> requesting`,
        value: requestLines,
        inline: true,
      },
      {
        name: '\u200B',
        value: `${valueLine}\n${rapLine}\n\n[View on Rolimons](https://www.rolimons.com/tradeads)`,
      }
    )
    .setFooter({ text: `RoliSniper • Sniping ${targetItemAcronym}` })
    .setTimestamp();

  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

async function startSnipe(config) {
  const { itemId, itemName, acronym, pingMode, pingThreshold, channel, discordId } = config;
  const key = `${discordId}_${itemId}`;
  if (activeSnipes.has(key)) return { ok: false, reason: 'already_sniping' };

  const seenAdIds = new Set();

  const poll = async () => {
    try {
      const data = await api.getRecentTradeAds();
      const ads = data.trade_ads || data.ads || data.tradeAds || [];

      if (!Array.isArray(ads)) {
        console.error('snipe: unexpected getrecentads shape:', JSON.stringify(data).slice(0, 300));
        return;
      }

      const catalog = await api.getItemCatalog();

      for (const ad of ads) {
        const adId = `${ad[0]}_${ad[7] || JSON.stringify(ad).length}`;
        if (seenAdIds.has(adId)) continue;
        seenAdIds.add(adId);

        const requestItemIds = (ad[3] || []).map(String);
        if (!requestItemIds.includes(String(itemId))) continue;

        // Apply ping mode filter
        if (pingMode !== 'all') {
          const catalogById = new Map(catalog.map(i => [String(i.id), i]));
          const offerValue = (ad[2] || []).reduce((s, id) => s + (catalogById.get(String(id))?.value || 0), 0);
          const targetValue = catalogById.get(String(itemId))?.value || 0;

          if (pingMode === 'overpay' && offerValue <= targetValue) continue;
          if (pingMode === 'threshold') {
            const pct = targetValue > 0 ? ((offerValue - targetValue) / targetValue) * 100 : 0;
            if (pct < (pingThreshold || 10)) continue;
          }
        }

        try {
          const embed = await buildEmbed(ad, itemId, itemName, acronym, catalog, discordId);
          await channel.send({ content: `<@${discordId}>`, embeds: [embed] });
        } catch (err) {
          console.error('snipe embed error:', err.message);
        }
      }
    } catch (err) {
      console.error('snipe poll error:', err.message);
    }
  };

  await poll();
  const handle = setInterval(poll, POLL_INTERVAL_MS);
  activeSnipes.set(key, { itemId, itemName, acronym, handle, seenAdIds, discordId, channelId: channel.id, pingMode, pingThreshold });
  return { ok: true };
}

function stopSnipe(discordId, itemId) {
  const key = `${discordId}_${itemId}`;
  const s = activeSnipes.get(key);
  if (!s) return null;
  clearInterval(s.handle);
  activeSnipes.delete(key);
  return s;
}

function stopAllSnipesForUser(discordId) {
  const stopped = [];
  for (const [key, s] of activeSnipes.entries()) {
    if (s.discordId === discordId) {
      clearInterval(s.handle);
      activeSnipes.delete(key);
      stopped.push(s);
    }
  }
  return stopped;
}

function getActiveSnipes(discordId) {
  return [...activeSnipes.values()].filter(s => s.discordId === discordId);
}

function stopAllSnipesInChannel(channelId) {
  for (const [key, s] of activeSnipes.entries()) {
    if (s.channelId === channelId) {
      clearInterval(s.handle);
      activeSnipes.delete(key);
    }
  }
}

module.exports = { startSnipe, stopSnipe, stopAllSnipesForUser, getActiveSnipes, stopAllSnipesInChannel };
