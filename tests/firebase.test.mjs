import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { verifyAdmin, generateLink } from '../src/firebase.mjs';

test('Firebase verification uses current admin claims and rejects revocation or another project', async () => {
  const original = globalThis.fetch;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const env = { FIREBASE_PROJECT_ID: 'epav-game', FIREBASE_API_KEY: 'test', FIREBASE_CLIENT_EMAIL: 'test@example.com', FIREBASE_PRIVATE_KEY: privateKey, RESET_URL: 'https://epav-game.github.io/epav-admin/resetar-senha.html' };
  const claims = { aud: 'epav-game', iss: 'https://securetoken.google.com/epav-game', sub: 'admin-uid', auth_time: 1000 };
  const idToken = value => 'header.' + Buffer.from(JSON.stringify(value)).toString('base64url') + '.signature';
  let admin = true, validSince = '900', disabled = false, invalidToken = false;
  globalThis.fetch = async (url, options) => {
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'oauth-test', expires_in: 3600 });
    if (url.includes('sendOobCode')) {
      const body = JSON.parse(options.body);
      assert.equal(body.returnOobLink, true); assert.equal(body.targetProjectId, 'epav-game');
      return Response.json({ oobLink: 'https://epav-game.firebaseapp.com/__/auth/action?oobCode=test-code' });
    }
    if (url.includes('projects/epav-game')) return Response.json({ users: [{ localId: 'admin-uid', customAttributes: JSON.stringify({ admin }), validSince, disabled }] });
    return invalidToken ? Response.json({ error: {} }, { status: 400 }) : Response.json({ users: [{ localId: 'admin-uid' }] });
  };
  try {
    assert.deepEqual(await verifyAdmin(env, idToken(claims)), { uid: 'admin-uid' });
    admin = false; await assert.rejects(verifyAdmin(env, idToken(claims)), /FORBIDDEN/);
    admin = true; validSince = '1001'; await assert.rejects(verifyAdmin(env, idToken(claims)), /UNAUTHORIZED/);
    validSince = '900'; disabled = true; await assert.rejects(verifyAdmin(env, idToken(claims)), /FORBIDDEN/);
    disabled = false; await assert.rejects(verifyAdmin(env, idToken({ ...claims, aud: 'another-project' })), /UNAUTHORIZED/);
    await assert.rejects(verifyAdmin(env, idToken({ ...claims, auth_time: null })), /UNAUTHORIZED/);
    invalidToken = true; await assert.rejects(verifyAdmin(env, idToken(claims)), /UNAUTHORIZED/);
    assert.equal(await generateLink(env, 'person@example.com'), env.RESET_URL + '?oobCode=test-code&mode=resetPassword');
  } finally { globalThis.fetch = original; }
});
