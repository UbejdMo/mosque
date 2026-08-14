import type sq from './locales/sq.json';

/**
 * Makes translation keys type-checked: `t('login.titl')` is a compile error,
 * and a key missing from the Albanian catalog cannot be referenced at all.
 * This is what keeps "no hardcoded strings" enforceable rather than aspirational.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof sq;
    };
  }
}
