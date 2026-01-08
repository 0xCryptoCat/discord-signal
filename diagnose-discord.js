/**
 * Diagnose Discord bot message reading
 * Shows full message structure to debug why content is empty
 */

const DISCORD_CHANNEL_ID = '1458574846123573451';
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.log('Set DISCORD_BOT_TOKEN first');
  process.exit(1);
}

async function diagnose() {
  console.log('🔍 Diagnosing Discord message reading...\n');
  
  const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages?limit=5`;
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bot ${token}` }
  });
  
  if (!res.ok) {
    console.log('Error:', res.status, await res.text());
    return;
  }
  
  const messages = await res.json();
  console.log(`Found ${messages.length} messages\n`);
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    console.log(`=== Message ${i + 1} ===`);
    console.log('ID:', msg.id);
    console.log('Author:', msg.author?.username);
    console.log('Content:', msg.content ? `"${msg.content.slice(0, 100)}..."` : '(EMPTY)');
    console.log('Content length:', msg.content?.length || 0);
    console.log('Has embeds:', msg.embeds?.length > 0);
    console.log('Type:', msg.type);
    console.log('Webhook ID:', msg.webhook_id || 'N/A');
    
    // If content is empty but there are embeds
    if (!msg.content && msg.embeds?.length > 0) {
      console.log('\nEmbed description:', msg.embeds[0]?.description?.slice(0, 100));
    }
    
    console.log('');
  }
  
  console.log('='.repeat(50));
  console.log('\n📋 DIAGNOSIS:');
  
  const hasContent = messages.some(m => m.content && m.content.length > 0);
  
  if (!hasContent) {
    console.log('❌ All messages have empty content!');
    console.log('');
    console.log('SOLUTION: Enable "MESSAGE CONTENT INTENT" in Discord Developer Portal:');
    console.log('1. Go to https://discord.com/developers/applications/1458690432773918783');
    console.log('2. Click "Bot" in the left sidebar');
    console.log('3. Scroll down to "Privileged Gateway Intents"');
    console.log('4. Enable "MESSAGE CONTENT INTENT"');
    console.log('5. Click "Save Changes"');
    console.log('6. Run this test again');
  } else {
    console.log('✅ Messages have content!');
  }
}

diagnose().catch(console.error);
