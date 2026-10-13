import { normalizePublicLocale } from './public-locale.mjs';

export function createConfiguredMailer(config, fetchImpl = globalThis.fetch) {
  if (config.mailProvider !== 'resend') {
    return { async sendVerificationCode() { throw new Error('MAIL_PROVIDER_NOT_CONFIGURED'); } };
  }
  if (!config.resendApiKey || !config.mailFrom) throw new Error('RESEND_API_KEY and MAIL_FROM are required when MAIL_PROVIDER=resend');
  return {
    async sendVerificationCode({ email, code, expiresAt, locale }) {
      const english = normalizePublicLocale(locale) === 'en';
      const subject = english ? `${code} · Your MOOYU.FUN verification code` : `${code} · 墨鱼工坊登录验证码`;
      const text = english
        ? `Your MOOYU.FUN verification code is ${code}. It expires at ${expiresAt.toISOString()}. If you did not request this code, you can ignore this email.`
        : `你的墨鱼工坊登录验证码是 ${code}。验证码将在 ${expiresAt.toISOString()} 前失效。若不是你本人操作，请忽略此邮件。`;
      const heading = english ? 'MOOYU.FUN verification code' : '墨鱼工坊 · MOOYU.FUN 登录验证码';
      const note = english ? 'Valid for 10 minutes. If you did not request this code, you can ignore this email.' : '10 分钟内有效。若不是你本人操作，请忽略此邮件。';
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: config.mailFrom,
          to: [email],
          subject,
          text,
          html: `<div lang="${english ? 'en' : 'zh-CN'}" style="font-family:ui-monospace,monospace;max-width:520px;margin:auto;padding:28px;border:2px solid #6d36d8"><p>${heading}</p><div style="font-size:32px;font-weight:800;letter-spacing:8px">${code}</div><p style="color:#625f6d">${note}</p></div>`,
        }),
      });
      if (!response.ok) throw new Error(`MAIL_DELIVERY_FAILED:${response.status}`);
    },
  };
}
