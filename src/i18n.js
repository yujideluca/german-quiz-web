// Language handling, ported from the Android app: which language is shown, UI text lookup, calendar names and the
// translated explanation text of the vocabulary data. Questions and answer options are German and never translated.
import { STRINGS } from './strings.js';

export const LANGUAGE_CHOICES = ['SYSTEM', 'en', 'de', 'pt', 'es'];
const SUPPORTED = ['en', 'de', 'pt', 'es'];
const LOCALES = { en: 'en-GB', de: 'de-DE', pt: 'pt-BR', es: 'es-ES' };

/** The language to show: an explicit choice wins; SYSTEM takes the first browser language the app offers, else English. */
export function resolveLanguage(preference, systemLanguages = []) {
  if (SUPPORTED.includes(preference)) return preference;
  for (const tag of systemLanguages) {
    const code = String(tag).toLowerCase().split('-')[0];
    if (SUPPORTED.includes(code)) return code;
  }
  return 'en';
}

export const localeOf = (language) => LOCALES[language] ?? LOCALES.en;

const format = (text, args) => text.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));

/** t('key', ...args) looks the text up in [language] and falls back to English, then to the key itself. */
export function createTranslator(language) {
  const table = STRINGS[language] ?? STRINGS.en;
  const t = (key, ...args) => format(table[key] ?? STRINGS.en[key] ?? key, args);
  const rules = new Intl.PluralRules(localeOf(language));
  t.plural = (key, count) => t(`${key}_${rules.select(count) === 'one' ? 'one' : 'other'}`, count);
  return t;
}

export function monthShort(language, monthIndex) {
  return new Intl.DateTimeFormat(localeOf(language), { month: 'short' }).format(new Date(2000, monthIndex, 1));
}

/** Narrow weekday names, Monday first. */
export function weekdayLetters(language) {
  const format = new Intl.DateTimeFormat(localeOf(language), { weekday: 'narrow' });
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(2024, 0, 1 + i))); // 1 Jan 2024 is a Monday
}

export const NO_CONTENT_TRANSLATIONS = { hints: {}, errorTypes: {}, rules: {} };

export function translateHint(translations, text) {
  return translations.hints?.[text] ?? text;
}

/**
 * Explanation of an answered card. Only the part after the first blank line (the error type and rule of a
 * "Fehler finden" card) is translated; the corrected German sentence in front of it stays.
 */
export function translateExplanation(translations, text) {
  const split = text.indexOf('\n\n');
  if (split < 0) return text;
  const head = text.slice(0, split + 2);
  let tail = text.slice(split + 2);
  const rule = Object.keys(translations.rules ?? {}).find((key) => tail.includes(key));
  if (rule) tail = tail.replace(rule, () => translations.rules[rule]);
  const type = Object.keys(translations.errorTypes ?? {}).find((key) => tail.startsWith(`${key}: `));
  if (type) tail = translations.errorTypes[type] + tail.slice(type.length);
  return head + tail;
}
