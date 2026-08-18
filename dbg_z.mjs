import { createProvider } from '@wanglinsaputra/tempmail-wrapper';

async function testProvider(name, addrOverride) {
  const client = createProvider(name);
  const addr = addrOverride || await client.generateEmail();
  console.log(`\n[${name}] addr: ${addr}`);
  const res = await fetch('https://api.coder.r4.chat/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://coder.r4.chat' },
    body: JSON.stringify({ email: addr, password: 'WangLinS2026!', name: 'ZDebug', callbackURL: 'https://coder.r4.chat/verify-email' }),
  });
  console.log(`[${name}] signup:`, res.status);
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const msgs = await client.getInbox(addr);
      console.log(`[${name}] poll ${(i+1)*10}s: ${msgs.length} msg(s)`, msgs.map(m => m.sender).join(','));
      if (msgs.some(m => (m.sender||'').toLowerCase().includes('r4.chat'))) { console.log(`[${name}] R4 EMAIL FOUND`); return; }
    } catch (e) {
      console.log(`[${name}] poll ${(i+1)*10}s err:`, e.message.slice(0,80));
    }
  }
}

await testProvider('zoromail');
