import { createProvider } from '@wanglinsaputra/tempmail-wrapper';
const c = createProvider('zoromail');
const addr = await c.generateEmail();
console.log('addr:', addr);
const res = await fetch('https://api.coder.r4.chat/api/auth/sign-up/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://coder.r4.chat' },
  body: JSON.stringify({ email: addr, password: 'WangLinS2026!', name: 'ZDbg2', callbackURL: 'https://coder.r4.chat/verify-email' }),
});
console.log('signup:', res.status);
for (let i = 0; i < 9; i++) {
  await new Promise(r => setTimeout(r, 10000));
  try {
    const msgs = await c.getInbox(addr);
    console.log(`poll ${(i+1)*10}s: ${msgs.length}`, msgs.map(m => m.sender).join(','));
    if (msgs.some(m => (m.sender||'').toLowerCase().includes('r4.chat'))) { console.log('R4 EMAIL FOUND'); break; }
  } catch (e) { console.log(`poll ${(i+1)*10}s err:`, e.message.slice(0,100)); }
}
console.log('done');
