const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export function recoveryEmail(link) {
  const url = new URL(link);
  if (url.protocol !== 'https:') throw new Error('INVALID_LINK');
  const safeLink = escape(url.href);
  const subject = 'Redefina sua senha — Missão EPAV';
  const text = `Olá!\n\nRecebemos uma solicitação para redefinir sua senha na Missão EPAV.\nAcesse este link para criar uma nova senha:\n\n${url.href}\n\nSe você não solicitou a alteração, ignore este e-mail. Sua senha permanece a mesma.\nO link é de uso único e pode expirar. Nesse caso, solicite um novo.\n\nEquipe EPAV`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#12304a;font-family:Arial,sans-serif;color:#172433"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" style="width:100%;max-width:560px;background:#fffdf7;border:4px solid #172433"><tr><td style="padding:32px"><img src="https://epav-game.github.io/epav-admin/assets/images/epav-logo.png" width="70" alt="EPAV"><p style="color:#188c8c;font-weight:bold;letter-spacing:2px;font-size:12px">MISSÃO EPAV</p><h1 style="font-size:30px;line-height:1.1;margin:20px 0">Vamos recuperar<br><span style="color:#f56f5f">seu acesso.</span></h1><p style="line-height:1.6">Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão para criar uma nova senha.</p><p style="margin:28px 0"><a href="${safeLink}" style="display:inline-block;padding:16px 22px;border:3px solid #172433;background:#f56f5f;color:#fff;text-decoration:none;font-weight:bold">REDEFINIR SENHA</a></p><p style="font-size:13px;line-height:1.6">Se o botão não funcionar, copie este link para o navegador:</p><p style="overflow-wrap:anywhere;word-break:break-all;font-size:12px"><a style="color:#188c8c" href="${safeLink}">${safeLink}</a></p><p style="padding-top:20px;border-top:2px dashed #172433;font-size:13px;line-height:1.6">Se você não solicitou a alteração, ignore este e-mail. Sua senha permanece a mesma. O link é de uso único e pode expirar; nesse caso, solicite um novo.</p><p style="font-size:13px;font-weight:bold">Equipe EPAV</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
export function base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function mimeMessage({ from, fromName, to, link, id = crypto.randomUUID(), now = new Date() }) {
  if ([from, fromName, to, id].some(value => typeof value !== 'string' || /[\r\n\x00]/.test(value))) throw new Error('INVALID_HEADER');
  const email = recoveryEmail(link);
  const boundary = 'epav_' + id.replace(/[^a-zA-Z0-9]/g, '');
  const folded = value => base64(value).match(/.{1,76}/g).join('\r\n');
  return [
    `From: =?UTF-8?B?${base64(fromName)}?= <${from}>`, `To: <${to}>`,
    `Subject: =?UTF-8?B?${base64(email.subject)}?=`, `Date: ${now.toUTCString()}`,
    `Message-ID: <${boundary}@gmail.com>`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', folded(email.text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', folded(email.html), `--${boundary}--`, '',
  ].join('\r\n');
}
