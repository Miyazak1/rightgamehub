import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, normalizeLocale, resolveLocale, translate } from './i18n.mjs';

const I18nContext = createContext(null);

const browserLocale = () => {
  let stored = null;
  try { stored = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY); } catch {}
  let explicit = null;
  try { explicit = new URLSearchParams(globalThis.location?.search || '').get('lang'); } catch {}
  return resolveLocale({ explicit, stored, languages: globalThis.navigator?.languages ?? [globalThis.navigator?.language] });
};

export function I18nProvider({ children, initialLocale }) {
  const [locale, updateLocale] = useState(() => normalizeLocale(initialLocale) || browserLocale());
  const setLocale = useCallback(value => updateLocale(normalizeLocale(value) || DEFAULT_LOCALE), []);
  const toggleLocale = useCallback(() => updateLocale(current => current === 'en' ? 'zh-CN' : 'en'), []);
  useEffect(() => {
    try { globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale); } catch {}
    if (globalThis.document?.documentElement) globalThis.document.documentElement.lang = locale;
  }, [locale]);
  const t = useCallback((key, params) => translate(locale, key, params), [locale]);
  const number = useCallback((value, options) => new Intl.NumberFormat(locale, options).format(Number(value || 0)), [locale]);
  const date = useCallback((value, options) => new Intl.DateTimeFormat(locale, options).format(new Date(value)), [locale]);
  const value = useMemo(() => ({ locale, setLocale, toggleLocale, t, number, date }), [locale, setLocale, toggleLocale, t, number, date]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export function LanguageSwitch({ className = '' }) {
  const { t, toggleLocale } = useI18n();
  return <button type="button" className={`language-switch ${className}`.trim()} onClick={toggleLocale} aria-label={t('language.switch')} title={t('language.current')}><span aria-hidden="true">文</span><strong>{t('language.short')}</strong></button>;
}
