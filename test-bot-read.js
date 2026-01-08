/**
 * Test Discord bot read access
 * 
 * Run with: DISCORD_BOT_TOKEN="your_token" node test-bot-read.js
 * 
 * Get your bot token from:
 * Discord Developer Portal → Applications → Your App → Bot → Reset Token
 */

const DISCORD_CHANNEL_ID = '1458574846123573451';
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.log('❌ DISCORD_BOT_TOKEN not set.');
  console.log('');
  console.log('To get your bot token:');
  console.log('1. Go to https://discord.com/developers/applications');
  console.log('2. Select your app (ID: 1458690432773918783)');
  console.log('3. Click "Bot" in the left sidebar');
  console.log('4. Click "Reset Token" and copy it');
  console.log('');
  console.log('Then run: DISCORD_BOT_TOKEN="your_token_here" node test-bot-read.js');
  process.exit(1);
}

async function testBotRead() {
  console.log('🔍 Testing Discord bot read access...');
  console.log('Channel ID:', DISCORD_CHANNEL_ID);
  console.log('Bot Token:', token.slice(0, 20) + '...');
  console.log('');
  
  const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages?limit=10`;
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bot ${token}` }
  });
  
  console.log('Response Status:', res.status);
  
  if (!res.ok) {
    const err = await res.text();
    console.log('Error:', err);
    
    if (res.status === 401) {
      console.log('\n⚠️ Invalid token. Make sure you copied the bot token correctly.');
    } else if (res.status === 403) {
      console.log('\n⚠️ Bot does not have access to this channel.');
      console.log('Make sure the bot is added to the server with "Read Message History" permission.');
      console.log('Use this invite link:');
      console.log('https://discord.com/api/oauth2/authorize?client_id=1458690432773918783&permissions=65536&scope=bot');
    }
    return;
  }
  
  const messages = await res.json();
  console.log(`✅ Found ${messages.length} messages\n`);
  
  // Extract CAs
  const caRegex = /\*\*CA:\*\*\s*`([A-Za-z0-9]+)`/;
  const cas = [];
  
  console.log('Messages:');
  for (const msg of messages) {
    const match = msg.content?.match(caRegex);
    if (match) cas.push(match[1]);
    const preview = msg.content?.slice(0, 60).replace(/\n/g, ' ') || '(empty)';
    console.log(`  - [${msg.author.username}] ${preview}...`);
  }
  
  console.log(`\n📊 Extracted ${cas.length} CAs for dedup:`);
  cas.forEach(ca => console.log(`  - ${ca.slice(0, 12)}...`));
}

testBotRead().catch(console.error);
