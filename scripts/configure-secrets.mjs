import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
const source = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!source) throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH to the private service account file.');
const credential = JSON.parse(fs.readFileSync(source, 'utf8'));
if (credential.project_id !== 'epav-game') throw new Error('Unexpected Firebase project.');
if (!process.env.FIREBASE_API_KEY) throw new Error('Set FIREBASE_API_KEY to the Firebase web app API key.');
if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Set CLOUDFLARE_ACCOUNT_ID to the confirmed destination account.');
const values = {
  FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
  FIREBASE_CLIENT_EMAIL: credential.client_email,
  FIREBASE_PRIVATE_KEY: credential.private_key,
};
// RATE_LIMIT_SALT is supplied explicitly so repeat runs do not reset rate counters.
if (process.env.RATE_LIMIT_SALT) values.RATE_LIMIT_SALT = process.env.RATE_LIMIT_SALT;
if (process.env.GMAIL_APP_PASSWORD) values.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD.replace(/\s/g, '');
if (process.env.TURNSTILE_SECRET_KEY) values.TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
const cli = path.resolve('node_modules/wrangler/bin/wrangler.js');
const child = spawn(process.execPath, [cli, 'secret', 'bulk'], { stdio: ['pipe', 'pipe', 'pipe'] });
// Credentials are sent through stdin; they never appear in arguments or files.
child.stdin.end(JSON.stringify(values));
child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
child.on('error', () => { console.error('Unable to start Wrangler.'); process.exitCode = 1; });
child.on('exit', code => { if (code !== 0) { console.error('Secret setup failed. Check Cloudflare authentication and the selected account.'); process.exitCode = 1; } else console.log('Firebase and supplied email secrets configured in Cloudflare.'); });
