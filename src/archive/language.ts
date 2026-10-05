/**
 * Which language to ask Chrome's built-in models for. Both the Prompt API and the Summarizer warn —
 * and say they may answer worse — when a request names no output language, and each accepts only
 * a short list (Chrome 154's Prompt API: de, en, es, fr, ja; older versions fewer). Callers try
 * these in order and use the first one `availability()` accepts.
 */
export const MODEL_LANGUAGES = ['en', 'de', 'es', 'fr', 'ja'] as const;

/** The browser's own language when a model may have it, then English. */
export function languagesToTry(ui: string = globalThis.navigator?.language ?? 'en'): string[] {
  const own = ui.toLowerCase().split('-')[0] ?? 'en';
  return own !== 'en' && (MODEL_LANGUAGES as readonly string[]).includes(own) ? [own, 'en'] : ['en'];
}

/** Inputs are titles and page text, often partly English whatever the browser's language. */
export function inputLanguages(lang: string): string[] {
  return lang === 'en' ? ['en'] : [lang, 'en'];
}
