import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, validEmail } from '../src/handler.mjs';
import { mimeMessage, recoveryEmail } from '../src/email.mjs';
import { sendGmail } from '../src/smtp.mjs';
function fixture(options = {}) {
  const events = [], emails = [], pending = [];
  const limiter = { limit: async () => ({ success: true }) };
  const env = { FIREBASE_PROJECT_ID: 'epav-game', FIREBASE_API_KEY: 'test', FIREBASE_CLIENT_EMAIL: 'test@example.com', FIREBASE_PRIVATE_KEY: 'test', GMAIL_SENDER_EMAIL: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcdefghijklmnop', RATE_LIMIT_SALT: 'test-salt', RESET_URL: 'https://epav-game.github.io/epav-admin/resetar-senha.html', ALLOWED_ORIGINS: 'https://epav-game.github.io', TURNSTILE_SECRET_KEY: 'test', IP_LIMIT: limiter, EMAIL_LIMIT: limiter, GLOBAL_LIMIT: limiter, ...options.env };
  const handler = createHandler({ generateLink: async () => 'https://epav-game.github.io/epav-admin/resetar-senha.html?oobCode=SECRET', sendEmail: async (...args) => emails.push(args), verifyAdmin: async () => ({ uid: 'admin' }), verifyChallenge: async () => true, log: event => events.push(event), ...options.dependencies });
  const request = (body = { email: 'user@example.com', turnstileToken: 'challenge' }, pathname = '/auth/forgot-password', headers = {}) => handler(new Request('https://worker.example' + pathname, { method: 'POST', headers: { Origin: 'https://epav-game.github.io', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), env, { waitUntil: promise => pending.push(promise) });
  return { request, env, emails, events, done: () => Promise.all(pending) };
}
test('missing and existing accounts get identical replies without exposing reset codes', async () => {
  const a = fixture();
  const b = fixture({ dependencies: { generateLink: async () => { throw new Error('EMAIL_NOT_FOUND'); } } });
  const responseA = await a.request(), responseB = await b.request();
  assert.equal(responseA.status, 202); assert.equal(responseB.status, 202);
  assert.equal(await responseA.text(), await responseB.text()); await a.done(); await b.done();
  assert.equal(a.emails.length, 1); assert.equal(b.emails.length, 0);
  assert.ok(!JSON.stringify(a.events).includes('SECRET')); assert.ok(!JSON.stringify(a.events).includes('user@example.com'));
});
test('invalid emails, untrusted origins and oversized bodies never send', async () => {
  const f = fixture();
  for (const email of ['bad', 'victim@example.com\r\nBcc: other@example.com', 'a@b.com,c@d.com', 'a@b.com>']) assert.equal(validEmail(email), false);
  assert.equal((await f.request({ email: 'bad' })).status, 400);
  assert.equal((await f.request(undefined, '/auth/forgot-password', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await f.request({ email: 'user@example.com', extra: 'x'.repeat(5000) })).status, 413);
  assert.equal(f.emails.length, 0);
});
test('public endpoint fails closed without challenge and admin endpoint requires verified admin', async () => {
  const unconfigured = fixture({ env: { TURNSTILE_SECRET_KEY: '' } });
  assert.equal((await unconfigured.request()).status, 503);
  const challenged = fixture({ dependencies: { verifyChallenge: async () => false } });
  assert.equal((await challenged.request()).status, 403);
  const admin = fixture({ dependencies: { verifyAdmin: async () => { throw new Error('FORBIDDEN'); } } });
  assert.equal((await admin.request({ email: 'user@example.com' }, '/admin/password-reset')).status, 401);
  assert.equal((await admin.request({ email: 'user@example.com' }, '/admin/password-reset', { Authorization: 'Bearer invalid' })).status, 403);
  assert.equal(admin.emails.length, 0);
});
test('rate limits block delivery and conceal email cooldown', async () => {
  const limited = { limit: async () => ({ success: false }) };
  const ip = fixture({ env: { IP_LIMIT: limited } }); assert.equal((await ip.request()).status, 429);
  const email = fixture({ env: { EMAIL_LIMIT: limited } }); assert.equal((await email.request()).status, 202); assert.equal(email.emails.length, 0);
});
test('MIME handles Portuguese text and refuses header injection', () => {
  const mime = mimeMessage({ from: 'sender@gmail.com', fromName: 'Missão EPAV', to: 'user@example.com', link: 'https://example.com/reset?code=one&test="x"' });
  assert.match(mime, /multipart\/alternative/); assert.match(mime, /Content-Transfer-Encoding: base64/);
  assert.throws(() => mimeMessage({ from: 'sender@gmail.com', fromName: 'name\r\nBcc:other@example.com', to: 'user@example.com', link: 'https://example.com' }));
  const email = recoveryEmail('https://example.com/reset?a=1&b="test"'); assert.match(email.html, /&amp;/); assert.match(email.text, /uso único/); assert.ok(!email.html.includes('24 horas'));
});
function smtpFixture(codes) {
  const commands = [];
  const encoder = new TextEncoder(); let controller;
  const readable = new ReadableStream({ start(value) { controller = value; controller.enqueue(encoder.encode('220 gmail ready\r\n')); } });
  const writable = new WritableStream({ write(bytes) { commands.push(new TextDecoder().decode(bytes)); const reply = codes.shift(); if (reply) { const encoded = encoder.encode(reply); controller.enqueue(encoded.slice(0, 5)); controller.enqueue(encoded.slice(5)); } } });
  return { commands, open: (address, options) => { assert.equal(address.port, 465); assert.equal(options.secureTransport, 'on'); return { opened: Promise.resolve(), closed: Promise.resolve(), readable, writable, close: async () => controller.close() }; } };
}
test('SMTP handles fragmented multiline replies and sends one TLS message', async () => {
  const smtp = smtpFixture(['250-gmail hello\r\n250 AUTH PLAIN\r\n', '235 accepted\r\n', '250 sender accepted\r\n', '250 recipient accepted\r\n', '354 continue\r\n', '250 queued\r\n', '221 bye\r\n']);
  await sendGmail({ GMAIL_APP_PASSWORD: 'abcdefghijklmnop', GMAIL_SENDER_EMAIL: 'sender@gmail.com' }, 'user@example.com', 'https://example.com/reset', smtp.open);
  assert.equal(smtp.commands.filter(command => command.startsWith('DATA')).length, 1);
  assert.equal(smtp.commands.filter(command => command.includes('multipart/alternative')).length, 1);
  assert.match(smtp.commands.at(-2), /\r\n\.\r\n$/);
});
test('SMTP authentication failure is sanitized and prevents DATA', async () => {
  const smtp = smtpFixture(['250 AUTH PLAIN\r\n', '535 account secret error\r\n']);
  await assert.rejects(sendGmail({ GMAIL_APP_PASSWORD: 'abcdefghijklmnop', GMAIL_SENDER_EMAIL: 'sender@gmail.com' }, 'user@example.com', 'https://example.com', smtp.open), { message: 'SMTP_AUTH' });
  assert.equal(smtp.commands.some(command => command.startsWith('DATA')), false);
});
