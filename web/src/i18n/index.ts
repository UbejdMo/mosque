import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@mosque/shared';
import sq from './locales/sq.json';
import en from './locales/en.json';

/**
 * Albanian is the default and the primary language; English is secondary
 * (SPEC §11). Every user-facing string lives in these catalogs — none are
 * written inline, not even during prototyping, because retrofitting that is
 * exactly the expensive thing the spec warns about.
 */

const STORAGE_KEY = 'mosque.locale';

function initialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  return LOCALES.includes(stored as Locale) ? (stored as Locale) : DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources: {
    sq: { translation: sq },
    en: { translation: en },
  },
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: {
    // React escapes for us.
    escapeValue: false,
  },
});

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

export default i18n;
