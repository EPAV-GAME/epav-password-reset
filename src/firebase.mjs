const encode = value => {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
let cached;
async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message === 'EMAIL_NOT_FOUND' ? 'EMAIL_NOT_FOUND' : 'FIREBASE_FAILED');
    throw error;
  }
  return data;
}
export async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cached?.client === env.FIREBASE_CLIENT_EMAIL && cached.expires > now + 60) return cached.token;
  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), char => char.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iss: env.FIREBASE_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/identitytoolkit', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  let binary = ''; for (const byte of signature) binary += String.fromCharCode(byte);
  const signed = unsigned + '.' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const data = await fetchJson('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signed }) });
  cached = { client: env.FIREBASE_CLIENT_EMAIL, token: data.access_token, expires: now + Number(data.expires_in || 3600) };
  return cached.token;
}
export async function generateLink(env, email) {
  const token = await accessToken(env);
  const data = await fetchJson('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email, returnOobLink: true, targetProjectId: env.FIREBASE_PROJECT_ID }),
  });
  const generated = new URL(data.oobLink);
  const code = generated.searchParams.get('oobCode');
  if (!code) throw new Error('FIREBASE_FAILED');
  const link = new URL(env.RESET_URL); link.searchParams.set('oobCode', code); link.searchParams.set('mode', 'resetPassword');
  return link.href;
}
export async function verifyAdmin(env, idToken) {
  // Firebase validates the ID token. Then privileged lookup checks current claims,
  // so removing admin permission does not wait for the old token to expire.
  const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(env.FIREBASE_API_KEY), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }), signal: AbortSignal.timeout(10000),
  });
  const data = await response.json(); const user = data.users?.[0];
  if (!response.ok || !user || user.disabled) throw new Error('UNAUTHORIZED');
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)))); }
  catch { throw new Error('UNAUTHORIZED'); }
  if (claims.aud !== env.FIREBASE_PROJECT_ID || claims.iss !== 'https://securetoken.google.com/' + env.FIREBASE_PROJECT_ID || claims.sub !== user.localId || !Number.isFinite(claims.auth_time)) throw new Error('UNAUTHORIZED');
  const token = await accessToken(env);
  const current = await fetchJson('https://identitytoolkit.googleapis.com/v1/projects/' + env.FIREBASE_PROJECT_ID + '/accounts:lookup', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: [user.localId] }),
  });
  const account = current.users?.[0];
  if (!account || account.disabled || JSON.parse(account.customAttributes || '{}').admin !== true) throw new Error('FORBIDDEN');
  if (Number(claims.auth_time) < Number(account.validSince || 0)) throw new Error('UNAUTHORIZED');
  return { uid: account.localId };
}
