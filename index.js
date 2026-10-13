require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  Events,
  AttachmentBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// ============================
// DOSYA YOLU (Railway Volume Uyumlu)
// ============================
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const defaultConfig = {
  logChannel: null,
  transcriptChannel: null,
  staffRoles: [],
  modRoles: [],
  ticketCategory: null,
  blacklist: [],
  activeTickets: {},
  stats: {
    totalTickets: 0,
    closedTickets: 0,
    claims: {},
    ratings: {}
  }
};

let config = JSON.parse(JSON.stringify(defaultConfig));

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      config = {
        ...defaultConfig,
        ...parsed,
        stats: { ...defaultConfig.stats, ...(parsed.stats || {}) }
      };
    } else {
      saveConfig();
    }
  } catch (e) {
    console.error('❌ Config yükleme hatası:', e);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ Config kaydetme hatası:', e);
  }
}

loadConfig();

const activeTickets = new Map(Object.entries(config.activeTickets || {}));

function saveActiveTickets() {
  config.activeTickets = Object.fromEntries(activeTickets);
  saveConfig();
}

// ============================
// CLIENT
// ============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ============================
// TICKET KATEGORİLERİ
// ============================
const TICKET_TYPES = {
  partner: { label: 'Partner',  emoji: '🤝', description: 'Partnerlik başvurusu',      color: 0x5865F2 },
  merge:   { label: 'Merge',    emoji: '🔗', description: 'Merge (birleşme) talebi',   color: 0x57F287 },
  siege:   { label: 'Siege',    emoji: '⚔️', description: 'Siege (kuşatma) başvurusu', color: 0xED4245 },
  sikayet: { label: 'Şikayet',  emoji: '⚠️', description: 'Kullanıcı şikayeti',        color: 0xFEE75C },
  destek:  { label: 'Destek',   emoji: '🛠️', description: 'Genel destek',              color: 0xEB459E },
  cekilis: { label: 'Çekiliş',  emoji: '🎉', description: 'Çekiliş düzenleme',         color: 0x9B59B6 }
};

const CLOSE_REASONS = {
  cozuldu:  { label: 'Çözüldü',         emoji: '✅' },
  iptal:    { label: 'İptal Edildi',    emoji: '🚫' },
  kural:    { label: 'Kural İhlali',    emoji: '⚠️' },
  diger:    { label: 'Diğer',           emoji: '📝' }
};

// ============================
// YARDIMCILAR
// ============================
function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return config.staffRoles.some(rid => member.roles.cache.has(rid));
}

function isMod(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return config.modRoles.some(rid => member.roles.cache.has(rid));
}

async function sendLog(guild, embed) {
  if (!config.logChannel) return;
  const ch = guild.channels.cache.get(config.logChannel);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

// ============================
// TRANSCRIPT — Buffer olarak üret (dosya yazmadan)
// ============================
async function createTranscriptBuffer(channel) {
  let messages;
  try {
    messages = await channel.messages.fetch({ limit: 500 });
  } catch (e) {
    console.error('Mesaj çekme hatası:', e);
    return null;
  }

  const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let html = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8">
<title>Transcript - ${esc(channel.name)}</title>
<style>
  body { font-family: Arial, sans-serif; background: #2b2d31; color: #dbdee1; padding: 20px; }
  .header { background: #5865F2; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
  .msg { background: #313338; padding: 10px; margin: 8px 0; border-radius: 6px; }
  .author { color: #5865F2; font-weight: bold; }
  .time { color: #949ba4; font-size: 12px; margin-left: 8px; }
  .content { margin-top: 5px; white-space: pre-wrap; }
  img { max-width: 300px; border-radius: 5px; margin-top: 5px; }
  a { color: #00aff4; }
</style></head><body>
<div class="header">
  <h1>📄 Ticket Transcript</h1>
  <p><b>Kanal:</b> #${esc(channel.name)}</p>
  <p><b>Sunucu:</b> ${esc(channel.guild.name)}</p>
  <p><b>Tarih:</b> ${new Date().toLocaleString('tr-TR')}</p>
  <p><b>Mesaj Sayısı:</b> ${sorted.length}</p>
</div>`;

  for (const msg of sorted) {
    const time = new Date(msg.createdTimestamp).toLocaleString('tr-TR');
    html += `<div class="msg">
      <span class="author">${esc(msg.author.tag)}</span>
      <span class="time">${esc(time)}</span>
      <div class="content">${esc(msg.content) || '<i>[ek/embed]</i>'}</div>`;
    for (const att of msg.attachments.values()) {
      if (att.contentType && att.contentType.startsWith('image/')) {
        html += `<img src="${esc(att.url)}" alt="ek">`;
      } else {
        html += `<div><a href="${esc(att.url)}">📎 ${esc(att.name)}</a></div>`;
      }
    }
    html += `</div>`;
  }
  html += `</body></html>`;

  const fileName = `transcript-${channel.name}-${Date.now()}.html`;
  return { buffer: Buffer.from(html, 'utf8'), fileName };
}

async function sendTranscript(guild, channel, closedByTag, closeReason) {
  const result = await createTranscriptBuffer(channel);
  if (!result) {
    console.error('❌ Transcript üretilemedi.');
    return false;
  }

  const attachment = new AttachmentBuilder(result.buffer, { name: result.fileName });

  const embed = new EmbedBuilder()
    .setTitle('📄 Ticket Transcript')
    .setColor(0x5865F2)
    .addFields(
      { name: '🎫 Kanal', value: `#${channel.name}`, inline: true },
      { name: '👤 Kapatan', value: closedByTag, inline: true },
      { name: '📝 Sebep', value: closeReason || 'Belirtilmedi', inline: true }
    )
    .setTimestamp();

  let sent = false;

  // 1. Transcript kanalına gönder
  if (config.transcriptChannel) {
    const tCh = guild.channels.cache.get(config.transcriptChannel);
    if (tCh) {
      try {
        await tCh.send({ embeds: [embed], files: [attachment] });
        sent = true;
        console.log(`✅ Transcript gönderildi: ${channel.name}`);
      } catch (e) {
        console.error('❌ Transcript kanalına gönderme hatası:', e);
      }
    } else {
      console.error('❌ Transcript kanalı bulunamadı (ID:', config.transcriptChannel, ')');
    }
  } else {
    console.error('❌ Transcript kanalı ayarlanmamış! `!ayarla-transcript #kanal` kullan.');
  }

  // 2. Log kanalına da gönder (yedek)
  if (config.logChannel && config.logChannel !== config.transcriptChannel) {
    const lCh = guild.channels.cache.get(config.logChannel);
    if (lCh) {
      try {
        await lCh.send({ embeds: [embed], files: [attachment] });
      } catch (e) { /* sessiz */ }
    }
  }

  return sent;
}

// ============================
// TICKET EMBED OLUŞTURMA
// ============================
function buildTicketEmbed(type, ownerId, claimedBy = null) {
  const data = TICKET_TYPES[type];
  const embed = new EmbedBuilder()
    .setTitle(`${data.emoji} ${data.label} Ticket`)
    .setColor(data.color)
    .setTimestamp()
    .setFooter({ text: 'Pangea Destek Sistemi' });

  let desc = `Merhaba <@${ownerId}>! 👋\n\n`;
  desc += `**Kategori:** ${data.emoji} ${data.label}\n`;
  desc += `**Açan:** <@${ownerId}>\n`;
  desc += `**Durum:** ${claimedBy ? `✋ <@${claimedBy}> tarafından üstlenildi` : '⏳ Bekliyor'}\n\n`;
  desc += `Lütfen talebini detaylı yaz. Yetkililer en kısa sürede ilgilenecek.`;

  embed.setDescription(desc);
  return embed;
}

function buildTicketButtons(claimedBy = null) {
  const claimBtn = new ButtonBuilder()
    .setCustomId('ticket_claim')
    .setLabel(claimedBy ? 'Üstlenmeyi Bırak' : 'Üstlen')
    .setEmoji(claimedBy ? '↩️' : '✋')
    .setStyle(claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success);

  const closeBtn = new ButtonBuilder()
    .setCustomId('ticket_close')
    .setLabel('Kapat')
    .setEmoji('🔒')
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder().addComponents(claimBtn, closeBtn);
}

// ============================
// HAZIR
// ============================
client.once(Events.ClientReady, () => {
  console.log(`✅ ${client.user.tag} olarak giriş yapıldı!`);
  console.log(`📊 ${client.guilds.cache.size} sunucu`);
  console.log(`📁 DATA_DIR: ${DATA_DIR}`);
  console.log(`📄 Transcript kanalı: ${config.transcriptChannel || 'AYARLANMAMIŞ'}`);
  client.user.setActivity('!yardım | Pangea', { type: 3 });
});

// ============================
// MESAJ KOMUTLARI
// ============================
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ---------- !yardım ----------
    if (command === 'yardım' || command === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('🌍 Pangea Bot - Komutlar')
        .setColor(0x5865F2)
        .addFields(
          { name: '📌 Genel', value: '`!yardım` `!ping` `!bilgi` `!avatar` `!sunucu-bilgi` `!kullanıcı-bilgi`' },
          { name: '🎫 Ticket (Yetkili)', value: '`!ekle @kullanıcı` `!çıkar @kullanıcı` `!yeniden-adlandır <isim>` `!ticket-bilgi` `!kapat`' },
          { name: '🎫 Ticket (Admin)', value: '`!ticket-panel` `!ticket-liste` `!blacklist-ekle` `!blacklist-çıkar`' },
          { name: '⚙️ Ayarlar (Admin)', value: '`!ayarla-log` `!ayarla-transcript` `!ayarla-yetkili` `!ayarla-mod` `!ayarla-kategori`' },
          { name: '🔨 Moderasyon (Yetkili)', value: '`!ban` `!kick` `!mute` `!unmute` `!warn` `!temizle` `!slowmode` `!kilit` `!kilit-aç`' },
          { name: '🎉 Çekiliş', value: '`!çekiliş-başlat <dk> <kazanan> <ödül>`' },
          { name: '📊 İstatistik', value: '`!istatistik`' }
        )
        .setFooter({ text: 'Pangea Bot', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (command === 'ping') {
      const msg = await message.reply('🏓 Hesaplanıyor...');
      const latency = msg.createdTimestamp - message.createdTimestamp;
      return msg.edit(`🏓 **Pong!**\n📡 Gecikme: \`${latency}ms\`\n💓 WebSocket: \`${client.ws.ping}ms\``);
    }

    if (command === 'bilgi') {
      const embed = new EmbedBuilder()
        .setTitle('🌍 Pangea Bot')
        .setColor(0x5865F2)
        .addFields(
          { name: '📊 Sunucu', value: `${client.guilds.cache.size}`, inline: true },
          { name: '👥 Kullanıcı', value: `${client.users.cache.size}`, inline: true },
          { name: '💬 Aktif Ticket', value: `${activeTickets.size}`, inline: true }
        )
        .setFooter({ text: 'Pangea • 2025' })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    // ---------- EĞLENCE ----------
    if (command === 'avatar') {
      const user = message.mentions.users.first() || message.author;
      return message.reply({ embeds: [new EmbedBuilder().setTitle(`${user.username} - Avatar`).setImage(user.displayAvatarURL({ size: 1024, dynamic: true })).setColor(0x5865F2)] });
    }

    if (command === 'sunucu-bilgi') {
      const g = message.guild;
      return message.reply({ embeds: [new EmbedBuilder().setTitle(`🏰 ${g.name}`).setThumbnail(g.iconURL({ dynamic: true })).setColor(0x5865F2)
        .addFields(
          { name: '👑 Sahip', value: `<@${g.ownerId}>`, inline: true },
          { name: '👥 Üye', value: `${g.memberCount}`, inline: true },
          { name: '📅 Kuruluş', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true }
        )] });
    }

    if (command === 'kullanıcı-bilgi') {
      const user = message.mentions.users.first() || message.author;
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return message.reply('❌ Kullanıcı bulunamadı.');
      return message.reply({ embeds: [new EmbedBuilder().setTitle(`👤 ${user.tag}`).setThumbnail(user.displayAvatarURL({ dynamic: true })).setColor(0x5865F2)
        .addFields(
          { name: '🆔 ID', value: user.id, inline: true },
          { name: '📅 Hesap', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
          { name: '📥 Katılım', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true }
        )] });
    }

    if (command === 'yazı-tura') return message.reply(`🪙 **${Math.random() < 0.5 ? 'Yazı' : 'Tura'}**`);

    // ---------- !istatistik ----------
    if (command === 'istatistik') {
      const s = config.stats;
      let topClaim = 'Yok', topClaimCount = 0;
      for (const [uid, count] of Object.entries(s.claims)) {
        if (count > topClaimCount) { topClaimCount = count; topClaim = `<@${uid}> (${count})`; }
      }
      let topRated = 'Yok', topAvg = 0;
      for (const [uid, data] of Object.entries(s.ratings)) {
        const avg = data.count ? data.total / data.count : 0;
        if (avg > topAvg) { topAvg = avg; topRated = `<@${uid}> (⭐ ${avg.toFixed(2)})`; }
      }
      return message.reply({ embeds: [new EmbedBuilder().setTitle('📊 Pangea İstatistikleri').setColor(0x5865F2)
        .addFields(
          { name: '🎫 Toplam Açılan', value: `${s.totalTickets}`, inline: true },
          { name: '🔒 Kapatılan', value: `${s.closedTickets}`, inline: true },
          { name: '💬 Aktif', value: `${activeTickets.size}`, inline: true },
          { name: '✋ En Çok Üstlenen', value: topClaim, inline: true },
          { name: '⭐ En Yüksek Puan', value: topRated, inline: true }
        )] });
    }

    // ============================
    // TICKET KANAL KOMUTLARI
    // ============================
    const ticket = activeTickets.get(message.channel.id);

    if (command === 'ekle') {
      if (!ticket) return message.reply('❌ Bu kanal ticket değil.');
      if (!isStaff(message.member) && ticket.owner !== message.author.id)
        return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      await message.channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true
      });
      return message.reply(`✅ <@${user.id}> ticket'a eklendi.`);
    }

    if (command === 'çıkar') {
      if (!ticket) return message.reply('❌ Bu kanal ticket değil.');
      if (!isStaff(message.member) && ticket.owner !== message.author.id)
        return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      if (user.id === ticket.owner) return message.reply('❌ Ticket sahibini çıkaramazsın.');
      await message.channel.permissionOverwrites.delete(user.id);
      return message.reply(`✅ <@${user.id}> ticket'tan çıkarıldı.`);
    }

    if (command === 'yeniden-adlandır' || command === 'rename') {
      if (!ticket) return message.reply('❌ Bu kanal ticket değil.');
      if (!isStaff(message.member)) return message.reply('❌ Yetkin yok.');
      const yeniIsim = args.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
      if (!yeniIsim) return message.reply('❌ Geçerli bir isim gir.');
      await message.channel.setName(yeniIsim);
      return message.reply(`✅ Kanal adı: **${yeniIsim}**`);
    }

    if (command === 'ticket-bilgi') {
      if (!ticket) return message.reply('❌ Bu kanal ticket değil.');
      const data = TICKET_TYPES[ticket.type];
      const embed = new EmbedBuilder()
        .setTitle('📋 Ticket Bilgisi')
        .setColor(data.color)
        .addFields(
          { name: '📂 Kategori', value: `${data.emoji} ${data.label}`, inline: true },
          { name: '👤 Sahip', value: `<@${ticket.owner}>`, inline: true },
          { name: '✋ Üstlenen', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Yok', inline: true },
          { name: '📅 Açılış', value: `<t:${Math.floor(ticket.createdAt / 1000)}:R>`, inline: true }
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (command === 'ticket-liste') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
        return message.reply('❌ Admin yetkisi gerekli.');
      if (activeTickets.size === 0) return message.reply('📭 Aktif ticket yok.');
      const liste = [...activeTickets.entries()].map(([cid, t]) =>
        `• <#${cid}> — <@${t.owner}> ${t.claimedBy ? `(✋ <@${t.claimedBy}>)` : '(⏳)'}`
      ).join('\n');
      return message.reply({ embeds: [new EmbedBuilder().setTitle('🎫 Aktif Ticketlar').setDescription(liste).setColor(0x5865F2)] });
    }

    // ---------- !kapat ----------
    if (command === 'kapat' || command === 'close') {
      if (!ticket) return message.reply('❌ Bu kanal ticket değil.');
      if (ticket.owner !== message.author.id && !isStaff(message.member))
        return message.reply('❌ Yetkin yok.');

      const reason = args.join(' ') || 'Belirtilmedi';

      // Yıldız değerlendirme (üstlenen varsa)
      if (ticket.claimedBy && ticket.owner === message.author.id) {
        const rateRow = new ActionRowBuilder().addComponents(
          [1, 2, 3, 4, 5].map(n =>
            new ButtonBuilder().setCustomId(`rate_${n}`).setLabel(`${n} ⭐`).setStyle(ButtonStyle.Secondary)
          )
        );
        await message.channel.send({ content: `<@${ticket.owner}> lütfen yetkiliyi değerlendir:`, components: [rateRow] });
      }

      await message.reply({
        embeds: [new EmbedBuilder().setTitle('🔒 Kapatılıyor').setDescription(`Transcript oluşturuluyor...\n**Sebep:** ${reason}`).setColor(0xED4245)]
      });

      const ok = await sendTranscript(message.guild, message.channel, message.author.tag, reason);
      if (!ok) {
        await message.channel.send('⚠️ Transcript gönderilemedi, ama ticket kapatılıyor. Kanal ayarlarını kontrol et.').catch(() => {});
      }

      config.stats.closedTickets++;
      activeTickets.delete(message.channel.id);
      saveActiveTickets();
      saveConfig();

      sendLog(message.guild, new EmbedBuilder().setTitle('🔒 Ticket Kapatıldı').setColor(0xED4245)
        .addFields(
          { name: 'Kanal', value: message.channel.name, inline: true },
          { name: 'Kapatan', value: message.author.tag, inline: true },
          { name: 'Sebep', value: reason }
        ).setTimestamp());

      setTimeout(() => message.channel.delete().catch(() => {}), 5000);
    }

    // ============================
    // AYAR KOMUTLARI
    // ============================
    if (command === 'ayarla-log') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply('❌ Yetki yok.');
      const ch = message.mentions.channels.first();
      if (!ch) return message.reply('❌ Kanal etiketle.');
      config.logChannel = ch.id; saveConfig();
      return message.reply(`✅ Log kanalı: ${ch}`);
    }

    if (command === 'ayarla-transcript') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply('❌ Yetki yok.');
      const ch = message.mentions.channels.first();
      if (!ch) return message.reply('❌ Kanal etiketle.');
      // Bot kanalda yazabiliyor mu test et
      const test = await ch.send('🧪 Transcript kanalı test ediliyor...').catch(() => null);
      if (!test) return message.reply('❌ Bu kanala yazamıyorum! Botun izinlerini kontrol et.');
      await test.delete().catch(() => {});
      config.transcriptChannel = ch.id; saveConfig();
      return message.reply(`✅ Transcript kanalı: ${ch}`);
    }

    if (command === 'ayarla-yetkili') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply('❌ Yetki yok.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Rol etiketle.');
      if (!config.staffRoles.includes(role.id)) config.staffRoles.push(role.id);
      saveConfig();
      return message.reply(`✅ Yetkili rolü: ${role}`);
    }

    if (command === 'ayarla-mod') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply('❌ Yetki yok.');
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Rol etiketle.');
      if (!config.modRoles.includes(role.id)) config.modRoles.push(role.id);
      saveConfig();
      return message.reply(`✅ Mod rolü: ${role}`);
    }

    if (command === 'ayarla-kategori') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply('❌ Yetki yok.');
      const cat = message.mentions.channels.first();
      if (!cat || cat.type !== ChannelType.GuildCategory) return message.reply('❌ Bir kategori etiketle.');
      config.ticketCategory = cat.id; saveConfig();
      return message.reply(`✅ Ticket kategorisi: **${cat.name}**`);
    }

    if (command === 'blacklist-ekle') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply('❌ Yetki yok.');
      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      if (!config.blacklist.includes(user.id)) config.blacklist.push(user.id);
      saveConfig();
      return message.reply(`🚫 ${user.tag} kara listeye eklendi.`);
    }

    if (command === 'blacklist-çıkar') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply('❌ Yetki yok.');
      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      config.blacklist = config.blacklist.filter(id => id !== user.id);
      saveConfig();
      return message.reply(`✅ ${user.tag} kara listeden çıkarıldı.`);
    }

    // ============================
    // MODERASYON
    // ============================
    if (command === 'ban') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      const reason = args.slice(1).join(' ') || 'Sebep yok';
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member || !member.bannable) return message.reply('❌ Banlayamıyorum.');
      await member.ban({ reason });
      sendLog(message.guild, new EmbedBuilder().setTitle('🔨 Ban').setColor(0xED4245).addFields(
        { name: 'Kullanıcı', value: user.tag, inline: true },
        { name: 'Yetkili', value: message.author.tag, inline: true },
        { name: 'Sebep', value: reason }
      ).setTimestamp());
      return message.reply(`🔨 **${user.tag}** banlandı.`);
    }

    if (command === 'kick') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      const reason = args.slice(1).join(' ') || 'Sebep yok';
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member || !member.kickable) return message.reply('❌ Atamıyorum.');
      await member.kick(reason);
      return message.reply(`👢 **${user.tag}** atıldı.`);
    }

    if (command === 'mute') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      const sure = parseInt(args[1]) || 10;
      const reason = args.slice(2).join(' ') || 'Sebep yok';
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return message.reply('❌ Bulunamadı.');
      await member.timeout(sure * 60 * 1000, reason);
      return message.reply(`🔇 **${user.tag}** ${sure} dk susturuldu.`);
    }

    if (command === 'unmute') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return message.reply('❌ Bulunamadı.');
      await member.timeout(null);
      return message.reply(`🔊 **${user.tag}** susturması kaldırıldı.`);
    }

    if (command === 'warn') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const user = message.mentions.users.first();
      const reason = args.slice(1).join(' ') || 'Sebep yok';
      if (!user) return message.reply('❌ Kullanıcı etiketle.');
      await user.send(`⚠️ **${message.guild.name}** sunucusunda uyarıldın.\nSebep: ${reason}`).catch(() => {});
      return message.reply(`⚠️ **${user.tag}** uyarıldı.`);
    }

    if (command === 'temizle') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const sayi = parseInt(args[0]);
      if (!sayi || sayi < 1 || sayi > 100) return message.reply('❌ 1-100 arası sayı gir.');
      await message.channel.bulkDelete(sayi, true);
      const msg = await message.channel.send(`🧹 **${sayi}** mesaj silindi.`);
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    }

    if (command === 'slowmode') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const sure = parseInt(args[0]) || 0;
      await message.channel.setRateLimitPerUser(sure);
      return message.reply(`🐢 Slowmode: **${sure}s**`);
    }

    if (command === 'kilit') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      return message.reply('🔒 Kanal kilitlendi.');
    }

    if (command === 'kilit-aç') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
      return message.reply('🔓 Kanal kilidi açıldı.');
    }

    // ============================
    // ÇEKİLİŞ
    // ============================
    if (command === 'çekiliş-başlat') {
      if (!isMod(message.member)) return message.reply('❌ Yetkin yok.');
      const sure = parseInt(args[0]);
      const kazananSayi = parseInt(args[1]);
      const odul = args.slice(2).join(' ');
      if (!sure || !kazananSayi || !odul)
        return message.reply('❌ Kullanım: `!çekiliş-başlat <süre dk> <kazanan> <ödül>`');

      const bitis = Date.now() + sure * 60 * 1000;
      const embed = new EmbedBuilder()
        .setTitle('🎉 ÇEKİLİŞ BAŞLADI!')
        .setDescription(`**Ödül:** ${odul}\n**Kazanan:** ${kazananSayi}\n**Bitiş:** <t:${Math.floor(bitis / 1000)}:R>\n\nKatılmak için 🎉 butonuna bas!`)
        .setColor(0x9B59B6)
        .setFooter({ text: `Başlatan: ${message.author.tag}` });

      const btn = new ButtonBuilder().setCustomId('cekilis_katil').setLabel('Katıl').setEmoji('🎉').setStyle(ButtonStyle.Primary);
      const row = new ActionRowBuilder().addComponents(btn);
      const msg = await message.channel.send({ embeds: [embed], components: [row] });

      const katilimcilar = new Set();
      const collector = msg.createMessageComponentCollector({ time: sure * 60 * 1000 });

      collector.on('collect', async (i) => {
        if (i.customId !== 'cekilis_katil') return;
        if (katilimcilar.has(i.user.id)) {
          katilimcilar.delete(i.user.id);
          return i.reply({ content: '❌ Çekilişten çekildin.', ephemeral: true });
        }
        katilimcilar.add(i.user.id);
        return i.reply({ content: '✅ Katıldın!', ephemeral: true });
      });

      collector.on('end', async () => {
        const arr = [...katilimcilar];
        if (arr.length === 0) return message.channel.send('❌ Kimse katılmadı.');
        const kazananlar = [];
        const kopya = [...arr];
        for (let i = 0; i < Math.min(kazananSayi, kopya.length); i++) {
          const idx = Math.floor(Math.random() * kopya.length);
          kazananlar.push(kopya.splice(idx, 1)[0]);
        }
        const endEmbed = new EmbedBuilder()
          .setTitle('🎉 ÇEKİLİŞ BİTTİ!')
          .setDescription(`**Ödül:** ${odul}\n\n**Kazananlar:**\n${kazananlar.map(id => `<@${id}>`).join('\n')}`)
          .setColor(0x57F287);
        const disabledRow = new ActionRowBuilder().addComponents(ButtonBuilder.from(btn).setDisabled(true));
        msg.edit({ embeds: [embed], components: [disabledRow] }).catch(() => {});
        message.channel.send({ content: kazananlar.map(id => `<@${id}>`).join(' '), embeds: [endEmbed] });
      });
    }

    // ============================
    // TICKET PANEL
    // ============================
    if (command === 'ticket-panel') {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
        return message.reply('❌ Yetki yok.');

      const embed = new EmbedBuilder()
        .setTitle('🎫 Pangea Destek Sistemi')
        .setDescription(
          'Aşağıdaki menüden bir **ticket kategorisi** seçerek yeni bir destek talebi oluşturabilirsin.\n\n' +
          '**Kategoriler:**\n' +
          Object.values(TICKET_TYPES).map(t => `${t.emoji} **${t.label}** - ${t.description}`).join('\n') +
          '\n\n⚠️ Bir kullanıcı aynı anda **sadece 1 ticket** açabilir.'
        )
        .setColor(0x5865F2)
        .setFooter({ text: 'Pangea Destek Sistemi', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_select')
        .setPlaceholder('📂 Bir kategori seç...')
        .addOptions(
          Object.entries(TICKET_TYPES).map(([key, val]) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(val.label).setDescription(val.description).setValue(key).setEmoji(val.emoji)
          )
        );
      return message.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(selectMenu)] });
    }
  } catch (err) {
    console.error('Komut hatası:', err);
  }
});

// ============================
// ETKİLEŞİMLER
// ============================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // -------- Ticket Select --------
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
      await interaction.deferReply({ ephemeral: true });

      const type = interaction.values[0];
      const data = TICKET_TYPES[type];
      if (!data) return interaction.editReply({ content: '❌ Geçersiz kategori.' });

      if (config.blacklist.includes(interaction.user.id))
        return interaction.editReply({ content: '🚫 Kara listedesin.' });

      const existing = interaction.guild.channels.cache.find(
        c => activeTickets.has(c.id) && activeTickets.get(c.id).owner === interaction.user.id
      );
      if (existing)
        return interaction.editReply({ content: `❌ Zaten açık bir ticket'ın var: <#${existing.id}>` });

      const overwrites = [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]
        },
        {
          id: client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
        }
      ];
      for (const rid of config.staffRoles) {
        overwrites.push({
          id: rid,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages]
        });
      }

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
        type: ChannelType.GuildText,
        parent: config.ticketCategory || interaction.channel.parentId || null,
        permissionOverwrites: overwrites
      });

      activeTickets.set(channel.id, {
        owner: interaction.user.id,
        type,
        createdAt: Date.now(),
        claimedBy: null
      });
      saveActiveTickets();
      config.stats.totalTickets++;
      saveConfig();

      const ticketEmbed = buildTicketEmbed(type, interaction.user.id);
      const row = buildTicketButtons();

      const mentionStr = `<@${interaction.user.id}>` + (config.staffRoles.length ? ' ' + config.staffRoles.map(r => `<@&${r}>`).join(' ') : '');
      await channel.send({ content: mentionStr, embeds: [ticketEmbed], components: [row] });

      sendLog(interaction.guild, new EmbedBuilder().setTitle('🎫 Yeni Ticket').setColor(0x57F287)
        .addFields(
          { name: 'Açan', value: interaction.user.tag, inline: true },
          { name: 'Kategori', value: `${data.emoji} ${data.label}`, inline: true },
          { name: 'Kanal', value: `<#${channel.id}>`, inline: true }
        ).setTimestamp());

      return interaction.editReply({ content: `✅ Ticket'ın oluşturuldu: <#${channel.id}>` });
    }

    if (!interaction.isButton()) return;

    // -------- Ticket Claim / Unclaim --------
    if (interaction.customId === 'ticket_claim') {
      const ticket = activeTickets.get(interaction.channel.id);
      if (!ticket) return interaction.reply({ content: '❌ Bu kanal ticket değil.', ephemeral: true });
      if (!isStaff(interaction.member))
        return interaction.reply({ content: '❌ Sadece yetkililer üstlenebilir.', ephemeral: true });

      // Unclaim
      if (ticket.claimedBy === interaction.user.id) {
        ticket.claimedBy = null;
        activeTickets.set(interaction.channel.id, ticket);
        saveActiveTickets();
        // Kanal adını geri al
        await interaction.channel.setName(`ticket-${ticket.owner ? (await client.users.fetch(ticket.owner).catch(() => null))?.username || 'user' : 'user'}`.toLowerCase().slice(0, 90)).catch(() => {});
        const newEmbed = buildTicketEmbed(ticket.type, ticket.owner, null);
        // İlk bot mesajını bul & güncelle (en eski)
        const msgs = await interaction.channel.messages.fetch({ limit: 20 });
        const botMsg = msgs.find(m => m.author.id === client.user.id && m.embeds.length > 0);
        if (botMsg) await botMsg.edit({ embeds: [newEmbed], components: [buildTicketButtons(null)] }).catch(() => {});
        return interaction.reply({ content: '↩️ Üstlenme bırakıldı.', ephemeral: true });
      }

      if (ticket.claimedBy)
        return interaction.reply({ content: `❌ Zaten <@${ticket.claimedBy}> üstlenmiş.`, ephemeral: true });

      ticket.claimedBy = interaction.user.id;
      activeTickets.set(interaction.channel.id, ticket);
      saveActiveTickets();

      config.stats.claims[interaction.user.id] = (config.stats.claims[interaction.user.id] || 0) + 1;
      saveConfig();

      // Kanal adını değiştir
      await interaction.channel.setName(`claimed-${interaction.user.username}`.toLowerCase().slice(0, 90)).catch(() => {});

      // Embed güncelle
      const newEmbed = buildTicketEmbed(ticket.type, ticket.owner, interaction.user.id);
      const msgs = await interaction.channel.messages.fetch({ limit: 20 });
      const botMsg = msgs.find(m => m.author.id === client.user.id && m.embeds.length > 0);
      if (botMsg) await botMsg.edit({ embeds: [newEmbed], components: [buildTicketButtons(interaction.user.id)] }).catch(() => {});

      return interaction.reply({ content: `✋ Ticket <@${interaction.user.id}> tarafından **üstlenildi**.` });
    }

    // -------- Ticket Kapat (buton) --------
    if (interaction.customId === 'ticket_close') {
      const ticket = activeTickets.get(interaction.channel.id);
      if (!ticket) return interaction.reply({ content: '❌ Bu kanal ticket değil.', ephemeral: true });
      if (ticket.owner !== interaction.user.id && !isStaff(interaction.member))
        return interaction.reply({ content: '❌ Yetkin yok.', ephemeral: true });

      // Sebep sorma butonları
      const reasonRow = new ActionRowBuilder().addComponents(
        Object.entries(CLOSE_REASONS).map(([key, val]) =>
          new ButtonBuilder().setCustomId(`close_reason_${key}`).setLabel(val.label).setEmoji(val.emoji).setStyle(ButtonStyle.Secondary)
        )
      );

      return interaction.reply({
        content: '📝 **Kapatma sebebini seç:**',
        components: [reasonRow],
        ephemeral: true
      });
    }

    // -------- Kapatma sebebi seçildi --------
    if (interaction.customId.startsWith('close_reason_')) {
      const key = interaction.customId.replace('close_reason_', '');
      const reasonData = CLOSE_REASONS[key];
      const reason = reasonData ? `${reasonData.emoji} ${reasonData.label}` : 'Belirtilmedi';

      const ticket = activeTickets.get(interaction.channel.id);
      if (!ticket) return interaction.update({ content: '❌ Ticket bulunamadı.', components: [] });

      await interaction.update({ content: `🔒 Kapatılıyor... (${reason})`, components: [] });

      // Yıldız değerlendirme
      if (ticket.claimedBy) {
        const rateRow = new ActionRowBuilder().addComponents(
          [1, 2, 3, 4, 5].map(n =>
            new ButtonBuilder().setCustomId(`rate_${n}`).setLabel(`${n} ⭐`).setStyle(ButtonStyle.Secondary)
          )
        );
        await interaction.channel.send({ content: `<@${ticket.owner}> lütfen yetkiliyi değerlendir:`, components: [rateRow] });
      }

      await interaction.channel.send({
        embeds: [new EmbedBuilder().setTitle('🔒 Ticket Kapatılıyor').setDescription('Transcript oluşturuluyor, 5 saniye içinde kapatılacak...').setColor(0xED4245)]
      });

      const ok = await sendTranscript(interaction.guild, interaction.channel, interaction.user.tag, reason);
      if (!ok) {
        await interaction.channel.send('⚠️ Transcript gönderilemedi, ama ticket kapatılıyor.').catch(() => {});
      }

      config.stats.closedTickets++;
      activeTickets.delete(interaction.channel.id);
      saveActiveTickets();
      saveConfig();

      sendLog(interaction.guild, new EmbedBuilder().setTitle('🔒 Ticket Kapatıldı').setColor(0xED4245)
        .addFields(
          { name: 'Kanal', value: interaction.channel.name, inline: true },
          { name: 'Kapatan', value: interaction.user.tag, inline: true },
          { name: 'Sebep', value: reason }
        ).setTimestamp());

      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    // -------- Yıldız Değerlendirme --------
    if (interaction.customId.startsWith('rate_')) {
      const puan = parseInt(interaction.customId.split('_')[1]);
      const ticket = activeTickets.get(interaction.channel.id);
      if (!ticket || !ticket.claimedBy)
        return interaction.reply({ content: '❌ Değerlendirilecek yetkili yok.', ephemeral: true });
      if (ticket.owner !== interaction.user.id)
        return interaction.reply({ content: '❌ Sadece ticket sahibi değerlendirebilir.', ephemeral: true });

      const staffId = ticket.claimedBy;
      if (!config.stats.ratings[staffId]) config.stats.ratings[staffId] = { total: 0, count: 0 };
      config.stats.ratings[staffId].total += puan;
      config.stats.ratings[staffId].count += 1;
      saveConfig();

      return interaction.reply({ content: `⭐ Değerlendirmen için teşekkürler! **${puan}/5**`, ephemeral: true });
    }
  } catch (err) {
    console.error('Interaction hatası:', err);
  }
});

// ============================
// YAKALANMAYAN HATALAR
// ============================
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

// ============================
// GİRİŞ
// ============================
client.login(process.env.TOKEN);