import { base64, mimeMessage } from './email.mjs';

// Gmail SMTP over implicit TLS. Socket opening is injected for runtime tests.
export async function sendGmail(env, to, link, openSocket) {
  const password = String(env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9]{16}$/.test(password)) throw new Error('SMTP_CONFIG');
  const socket = openSocket({ hostname: 'smtp.gmail.com', port: 465 }, { secureTransport: 'on' });
  socket.closed?.catch(() => {});
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder(); const decoder = new TextDecoder();
  let pending = '', timeout;
  // OAuth + link generation use up to 10 seconds. Keep delivery within the
  // Worker's 30-second waitUntil window after the HTTP response.
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('SMTP_TIMEOUT')), 18000); });
  async function reply(allowed) {
    let lines = 0;
    while (true) {
      while (!pending.includes('\r\n')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('SMTP_CLOSED');
        pending += decoder.decode(chunk.value, { stream: true });
        if (pending.length > 65536) throw new Error('SMTP_PROTOCOL');
      }
      const separator = pending.indexOf('\r\n');
      const line = pending.slice(0, separator); pending = pending.slice(separator + 2);
      const match = line.match(/^(\d{3})([ -])/);
      if (!match || ++lines > 100) throw new Error('SMTP_PROTOCOL');
      const code = Number(match[1]);
      if (!allowed.includes(code)) throw new Error(code === 535 ? 'SMTP_AUTH' : 'SMTP_REJECTED');
      if (match[2] === ' ') return;
    }
  }
  async function command(value, allowed) { await writer.write(encoder.encode(value + '\r\n')); await reply(allowed); }
  async function deliver() {
    await socket.opened;
    await reply([220]);
    await command('EHLO epav-game.firebaseapp.com', [250]);
    await command('AUTH PLAIN ' + base64('\0' + env.GMAIL_SENDER_EMAIL + '\0' + password), [235]);
    await command('MAIL FROM:<' + env.GMAIL_SENDER_EMAIL + '>', [250]);
    await command('RCPT TO:<' + to + '>', [250, 251]);
    await command('DATA', [354]);
    const mime = mimeMessage({ from: env.GMAIL_SENDER_EMAIL, fromName: env.GMAIL_SENDER_NAME || 'Missão EPAV', to, link });
    await writer.write(encoder.encode(mime.replace(/(^|\r\n)\./g, '$1..') + '\r\n.\r\n'));
    await reply([250]);
    // After DATA is accepted, a failed QUIT must not cause a duplicate retry.
    await writer.write(encoder.encode('QUIT\r\n')).catch(() => {});
  }
  try { await Promise.race([deliver(), deadline]); }
  finally { clearTimeout(timeout); await socket.close().catch(() => {}); }
}
