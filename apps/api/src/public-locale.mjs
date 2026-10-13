export const DEFAULT_PUBLIC_LOCALE = 'zh-CN';

export function normalizePublicLocale(value) {
  const locale = String(value || '').trim().toLowerCase();
  if (locale === 'zh' || locale.startsWith('zh-')) return 'zh-CN';
  if (locale === 'en' || locale.startsWith('en-')) return 'en';
  return null;
}

export function resolvePublicLocale({ explicit, acceptLanguage } = {}) {
  const selected = normalizePublicLocale(explicit);
  if (selected) return selected;
  for (const entry of String(acceptLanguage || '').split(',')) {
    const language = entry.trim().split(';')[0];
    const normalized = normalizePublicLocale(language);
    if (normalized) return normalized;
  }
  return DEFAULT_PUBLIC_LOCALE;
}

export const publicLocaleQuerySchema = { type: 'string', enum: ['zh-CN', 'en'] };
