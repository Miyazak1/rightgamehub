export function createConfiguredMailer(config, fetchImpl = globalThis.fetch) {
  if (config.mailProvider !== 'resend') {
    return { async sendVerificationCode() { throw new Error('MAIL_PROVIDER_NOT_CONFIGURED'); } };
  }
  if (!config.resendApiKey || !config.mailFrom) throw new Error('RESEND_API_KEY and MAIL_FROM are required when MAIL_PROVIDER=resend');
  return {
    async sendVerificationCode({ email, code, expiresAt }) {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: config.mailFrom,
          to: [email],
          subject: `${code} · GameHub 登录验证码`,
          text: `你的 GameHub 登录验证码是 ${code}。验证码将在 ${expiresAt.toISOString()} 前失效。若不是你本人操作，请忽略此邮件。`,
          html: `<div style="font-family:ui-monospace,monospace;max-width:520px;margin:auto;padding:28px;border:2px solid #6d36d8"><p>GameHub 登录验证码</p><div style="font-size:32px;font-weight:800;letter-spacing:8px">${code}</div><p style="color:#625f6d">10 分钟内有效。若不是你本人操作，请忽略此邮件。</p></div>`,
        }),
      });
      if (!response.ok) throw new Error(`MAIL_DELIVERY_FAILED:${response.status}`);
    },
  };
}
