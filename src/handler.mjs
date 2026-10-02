const resultMessage = 'Se este e-mail estiver cadastrado, você receberá as instruções de recuperação.';
export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(value) && !value.includes('..');
}
function configured(env) {
  return env.FIREBASE_PROJECT_ID === 'epav-game' && env.FIREBASE_API_KEY && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY && /^[A-Za-z0-9]{16}$/.test(String(env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '')) && validEmail(env.GMAIL_SENDER_EMAIL) && env.RATE_LIMIT_SALT && env.RESET_URL?.startsWith('https://epav-game.github.io/epav-admin/');
}
async function opaqueKey(env, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.RATE_LIMIT_SALT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return [...signature].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createHandler({ generateLink, sendEmail, verifyAdmin, verifyChallenge, log = event => console.error(JSON.stringify(event)) }) {
  return async function handler(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
    if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (status, message, success = false) => new Response(JSON.stringify({ sucesso: success, mensagem: message }), { status, headers });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return respond(configured(env) ? 200 : 503, configured(env) ? 'Serviço disponível.' : 'Serviço aguardando configuração.', !!configured(env));
    if (origin && !allowed.includes(origin)) return respond(403, 'Origem não autorizada.');
    if (!['/auth/forgot-password', '/admin/password-reset'].includes(url.pathname)) return respond(404, 'Rota não encontrada.');
    if (request.method === 'OPTIONS') {
      if (!origin) return respond(403, 'Origem não autorizada.');
      return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' } });
    }
    if (request.method !== 'POST') return respond(405, 'Use POST para solicitar a recuperação.');
    if (!configured(env) || !env.IP_LIMIT || !env.EMAIL_LIMIT || !env.GLOBAL_LIMIT) return respond(503, 'Recuperação de senha temporariamente indisponível.');
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return respond(415, 'Envie os dados em JSON.');
    if (Number(request.headers.get('Content-Length')) > 4096) return respond(413, 'Requisição muito grande.');
    let body;
    try {
      const reader = request.body?.getReader(); if (!reader) throw new Error();
      const chunks = []; let size = 0;
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4096) { await reader.cancel(); return respond(413, 'Requisição muito grande.'); } chunks.push(part.value); }
      const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
      body = JSON.parse(new TextDecoder().decode(buffer));
    } catch { return respond(400, 'Informe um e-mail válido.'); }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!validEmail(email)) return respond(400, 'Informe um e-mail válido.');
    const requestId = crypto.randomUUID();
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      if (!(await env.IP_LIMIT.limit({ key: await opaqueKey(env, 'ip:' + ip) })).success) return respond(429, 'Muitas solicitações. Aguarde um minuto e tente novamente.');
      if (url.pathname.startsWith('/admin/')) {
        const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
        if (!token) return respond(401, 'Entre com uma conta administradora.');
        await verifyAdmin(env, token);
      } else {
        if (!env.TURNSTILE_SECRET_KEY) return respond(503, 'Recuperação de senha temporariamente indisponível.');
        if (typeof body.turnstileToken !== 'string' || body.turnstileToken.length > 2048 || !await verifyChallenge(env, body.turnstileToken, ip)) return respond(403, 'Conclua a verificação e tente novamente.');
      }
      if (!(await env.EMAIL_LIMIT.limit({ key: await opaqueKey(env, 'email:' + email) })).success) return respond(202, resultMessage, true);
      if (!(await env.GLOBAL_LIMIT.limit({ key: 'epav-password-reset' })).success) return respond(429, 'Muitas solicitações. Aguarde um minuto e tente novamente.');
      const deliver = async () => {
        try { const link = await generateLink(env, email); await sendEmail(env, email, link); log({ event: 'password_reset_sent', requestId }); }
        catch (error) { if (error.message !== 'EMAIL_NOT_FOUND') log({ event: 'password_reset_failed', requestId, code: ['SMTP_AUTH', 'SMTP_TIMEOUT', 'SMTP_REJECTED', 'SMTP_CONFIG', 'FIREBASE_FAILED'].includes(error.message) ? error.message : 'DELIVERY_FAILED' }); }
      };
      ctx.waitUntil(deliver());
      // Same status/body before lookup or delivery: account existence is not disclosed.
      return respond(202, resultMessage, true);
    } catch (error) {
      if (error.message === 'UNAUTHORIZED') return respond(401, 'A sessão expirou. Entre novamente.');
      if (error.message === 'FORBIDDEN') return respond(403, 'Esta conta não tem permissão de administrador.');
      log({ event: 'password_reset_request_failed', requestId });
      return respond(503, 'Não foi possível processar a solicitação. Tente novamente.');
    }
  };
}
