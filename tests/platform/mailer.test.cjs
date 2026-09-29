const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const mailerUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/mailer.mjs'));

test('Resend mailer submits the verification code with bearer authorization', async () => {
  const { createConfiguredMailer } = await import(mailerUrl);
  let request;
  const mailer = createConfiguredMailer({
    mailProvider: 'resend',
    resendApiKey: 're_test_secret',
    mailFrom: 'GameHub <login@example.com>',
  }, async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200 };
  });
  await mailer.sendVerificationCode({
    email: 'player@example.com',
    code: '123456',
    expiresAt: new Date('2026-09-29T09:10:00.000Z'),
  });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers.Authorization, 'Bearer re_test_secret');
  assert.deepEqual(body.to, ['player@example.com']);
  assert.equal(body.from, 'GameHub <login@example.com>');
  assert.match(body.subject, /123456/);
});

test('mailer refuses missing production configuration and delivery failures', async () => {
  const { createConfiguredMailer } = await import(mailerUrl);
  assert.throws(
    () => createConfiguredMailer({ mailProvider: 'resend', resendApiKey: '', mailFrom: '' }),
    /RESEND_API_KEY and MAIL_FROM/,
  );
  const mailer = createConfiguredMailer({
    mailProvider: 'resend', resendApiKey: 're_test_secret', mailFrom: 'login@example.com',
  }, async () => ({ ok: false, status: 429 }));
  await assert.rejects(
    mailer.sendVerificationCode({ email: 'player@example.com', code: '123456', expiresAt: new Date() }),
    /MAIL_DELIVERY_FAILED:429/,
  );
});
