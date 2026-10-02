import { connect } from 'cloudflare:sockets';
import { createHandler } from './handler.mjs';
import { generateLink, verifyAdmin } from './firebase.mjs';
import { sendGmail } from './smtp.mjs';
async function verifyChallenge(env, token, ip) {
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, ...(ip !== 'local' ? { remoteip: ip } : {}) }), signal: AbortSignal.timeout(10000) });
  const data = await result.json();
  return result.ok && data.success === true && data.action === 'password-reset' && env.TURNSTILE_HOSTNAMES.split(',').includes(data.hostname);
}
export default { fetch: createHandler({ generateLink, verifyAdmin, verifyChallenge, sendEmail: (env, email, link) => sendGmail(env, email, link, connect) }) };
