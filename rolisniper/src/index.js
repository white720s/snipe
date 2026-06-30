require('dotenv').config();
const {
  Client, GatewayIntentBits, ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
} = require('discord.js');
const api = require('./api');
const snipeEngine = require('./snipe');
const store = require('./store');

const SNIPE_CATEGORY_NAME = process.env.SNIPE_CATEGORY_NAME || 'ad viewer';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Auto-stop snipes if user leaves server
client.on('guildMemberRemove', (member) => {
  const stopped = snipeEngine.stopAllSnipesForUser(member.id);
  if (stopped.length > 0) {
    console.log(`Stopped ${stopped.length} snipe(s) for ${member.id} (left server).`);
  }
});

// ---------- Autocomplete ----------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isAutocomplete()) return;

  const focused = interaction.options.getFocused();
  const discordId = interaction.user.id;

  try {
    if (interaction.commandName === 'snipe') {
      const matches = await api.searchItemCatalog(focused);
      if (matches.length === 0) {
        return interaction.respond([{ name: 'No options match your search', value: '' }]);
      }
      return interaction.respond(
        matches.map(item => ({
          name: `${item.name} (${item.acronym || '—'})`,
          value: item.id,
        }))
      );
    }

    if (interaction.commandName === 'stopsnipe') {
      const active = snipeEngine.getActiveSnipes(discordId);
      if (active.length === 0) {
        return interaction.respond([{ name: 'No active snipes', value: '' }]);
      }
      return interaction.respond(
        active.map(s => ({ name: `${s.itemName} (${s.acronym})`, value: s.itemId }))
      );
    }
  } catch (err) {
    console.error('autocomplete error:', err.message);
    return interaction.respond([]).catch(() => {});
  }
});

// ---------- Commands ----------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const discordId = interaction.user.id;

  // ---------- /snipe ----------
  if (interaction.commandName === 'snipe') {
    const robloxUsername = interaction.options.getString('roblox_username');
    const itemId = interaction.options.getString('item');

    if (!itemId) {
      return interaction.reply({ content: '❌ Please pick an item from the suggestions.', ephemeral: true });
    }

    // Look up the item in catalog to get its real name/acronym
    const catalog = await api.getItemCatalog();
    const item = catalog.find(i => String(i.id) === String(itemId));
    if (!item) {
      return interaction.reply({ content: '❌ Item not recognized. Please pick from the autocomplete suggestions.', ephemeral: true });
    }

    // Find "ad viewer" category
    const category = interaction.guild.channels.cache.find(
      c => c.type === 4 && c.name.toLowerCase() === SNIPE_CATEGORY_NAME.toLowerCase()
    );
    if (!category) {
      return interaction.reply({
        content: `❌ Could not find a category named "${SNIPE_CATEGORY_NAME}". Please create it first.`,
        ephemeral: true,
      });
    }

    // Build channel name: snipe-username-acronym
    const safeUsername = robloxUsername.toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeItem = (item.acronym || item.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    const channelName = `snipe-${safeUsername}-${safeItem}`;

    // Reuse or create the channel
    let snipeChannel = interaction.guild.channels.cache.find(
      c => c.name === channelName && c.parentId === category.id
    );

    if (!snipeChannel) {
      snipeChannel = await interaction.guild.channels.create({
        name: channelName,
        parent: category.id,
        topic: `Snipe alerts for ${robloxUsername} — ${item.name}`,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: ['ViewChannel'] },
          { id: discordId, allow: ['ViewChannel', 'ReadMessageHistory'] },
          { id: interaction.client.user.id, allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'] },
        ],
      });
    }

    // Get user's saved snipe options
    const userPrefs = store.getUser(discordId) || {};
    const snipeOpts = userPrefs.snipeOptions || { mode: 'all', threshold: 10 };

    // Check not already sniping this item
    const existing = snipeEngine.getActiveSnipes(discordId).find(s => String(s.itemId) === String(itemId));
    if (existing) {
      return interaction.reply({
        content: `⚠️ You're already sniping **${item.name}**. Use **/stopsnipe** first to restart it.`,
        ephemeral: true,
      });
    }

    await interaction.reply({
      content: `✅ Sniping **${item.name}** in ${snipeChannel}! You'll be pinged when someone posts a trade ad requesting it.`,
      ephemeral: true,
    });

    await snipeEngine.startSnipe({
      itemId: item.id,
      itemName: item.name,
      acronym: item.acronym || '—',
      pingMode: snipeOpts.mode,
      pingThreshold: snipeOpts.threshold,
      channel: snipeChannel,
      discordId,
    });

    return;
  }

  // ---------- /stopsnipe ----------
  if (interaction.commandName === 'stopsnipe') {
    const itemId = interaction.options.getString('item');

    const handleStop = async (snipe) => {
      snipeEngine.stopSnipe(discordId, snipe.itemId);

      const snipeChannel = interaction.guild.channels.cache.get(snipe.channelId);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`del_${snipe.itemId}`)
          .setLabel('Yes, delete the channel')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`keep_${snipe.itemId}`)
          .setLabel('No, keep it')
          .setStyle(ButtonStyle.Secondary),
      );

      const reply = await interaction.reply({
        content: `✅ Stopped sniping **${snipe.itemName}**. Delete the channel? It auto-deletes in 30 minutes if you don't choose.`,
        components: [row],
        ephemeral: true,
      });

      // Auto-delete after 30 minutes
      const autoDelete = setTimeout(async () => {
        if (snipeChannel) await snipeChannel.delete().catch(() => {});
      }, 30 * 60 * 1000);

      try {
        const collector = reply.createMessageComponentCollector({ time: 30 * 60 * 1000 });
        collector.on('collect', async (btn) => {
          clearTimeout(autoDelete);
          if (btn.customId === `del_${snipe.itemId}`) {
            if (snipeChannel) await snipeChannel.delete().catch(() => {});
            await btn.update({ content: '✅ Channel deleted.', components: [] });
          } else {
            await btn.update({ content: '✅ Channel kept.', components: [] });
          }
          collector.stop();
        });
        collector.on('end', async (_, reason) => {
          if (reason === 'time' && snipeChannel) {
            await snipeChannel.delete().catch(() => {});
          }
        });
      } catch (err) {
        console.error('stopsnipe collector error:', err.message);
      }
    };

    if (!itemId) {
      const active = snipeEngine.stopAllSnipesForUser(discordId);
      if (active.length === 0) {
        return interaction.reply({ content: 'You have no active snipes running.', ephemeral: true });
      }
      return handleStop(active[0]); // Handle first one; multiple stops are rare
    }

    const active = snipeEngine.getActiveSnipes(discordId);
    const snipe = active.find(s => String(s.itemId) === String(itemId));
    if (!snipe) {
      return interaction.reply({ content: '❌ No active snipe found for that item.', ephemeral: true });
    }
    return handleStop(snipe);
  }

  // ---------- /snipeoptions ----------
  if (interaction.commandName === 'snipeoptions') {
    const mode = interaction.options.getString('mode');
    const threshold = interaction.options.getInteger('threshold') || 10;

    if (mode === 'threshold' && !interaction.options.getInteger('threshold')) {
      return interaction.reply({
        content: '❌ Please also set the `threshold` option (e.g. `10` for 10%+ overpay).',
        ephemeral: true,
      });
    }

    store.setUser(discordId, { snipeOptions: { mode, threshold } });

    const desc = {
      all: 'You\'ll be pinged for every matching trade ad.',
      overpay: 'You\'ll only be pinged when the offer is worth more than your item.',
      threshold: `You\'ll only be pinged when the offer is ${threshold}%+ overpay.`,
    };

    return interaction.reply({
      content: `✅ Snipe mode set to **${mode}**. ${desc[mode]}`,
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
