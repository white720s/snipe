require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('Start sniping trade ads requesting a specific item')
    .addStringOption(opt =>
      opt.setName('roblox_username')
        .setDescription('Your Roblox username (shown in channel name)')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('Item name or acronym to snipe for (e.g. "Valk" or "Valkyrie Helm")')
        .setRequired(true)
        .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('stopsnipe')
    .setDescription('Stop sniping for an item')
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('Which snipe to stop (leave blank to stop all)')
        .setRequired(false)
        .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('snipeoptions')
    .setDescription('Set when you get pinged for snipe matches')
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('When to ping you')
        .setRequired(true)
        .addChoices(
          { name: 'All matches', value: 'all' },
          { name: 'Overpay only', value: 'overpay' },
          { name: 'Threshold (set a minimum % overpay)', value: 'threshold' },
        ))
    .addIntegerOption(opt =>
      opt.setName('threshold')
        .setDescription('Minimum overpay % (for Threshold mode only, e.g. 10 = 10%+)')
        .setRequired(false)),
].map(cmd => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log('Done! Commands registered:', commands.map(c => c.name).join(', '));
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
})();
