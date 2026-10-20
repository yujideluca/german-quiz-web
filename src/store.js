// Browser storage (localStorage). Every access is guarded: Safari private mode can throw, and then
// the app keeps working from memory for the session.
const KEYS = { progress: 'quiz.progress', history: 'quiz.history', goal: 'quiz.goal', theme: 'quiz.theme', language: 'quiz.language' };

export function createLocalStore(storage = globalThis.localStorage) {
  const memory = {};
  const read = (key) => {
    try { return storage.getItem(key) ?? memory[key] ?? null; } catch { return memory[key] ?? null; }
  };
  const write = (key, value) => {
    memory[key] = value;
    try { storage.setItem(key, value); } catch { /* memory copy keeps this session going */ }
  };
  const readJson = (key, fallback) => {
    try { return JSON.parse(read(key)) ?? fallback; } catch { return fallback; }
  };
  return {
    loadProgress: () => readJson(KEYS.progress, {}),
    saveProgress: (map) => write(KEYS.progress, JSON.stringify(map)),
    loadHistory: () => readJson(KEYS.history, {}),
    saveHistory: (h) => write(KEYS.history, JSON.stringify(h)),
    loadGoal: () => {
      const g = Number(read(KEYS.goal));
      return Number.isFinite(g) && g >= 10 && g <= 100 ? g : 20;
    },
    saveGoal: (g) => write(KEYS.goal, String(g)),
    loadTheme: () => read(KEYS.theme) ?? 'SYSTEM',
    saveTheme: (t) => write(KEYS.theme, t),
    loadLanguage: () => {
      const choice = read(KEYS.language);
      return ['SYSTEM', 'en', 'de', 'pt', 'es'].includes(choice) ? choice : 'SYSTEM';
    },
    saveLanguage: (l) => write(KEYS.language, l),
    clearProgress: () => {
      delete memory[KEYS.progress];
      try { storage.removeItem(KEYS.progress); } catch { /* nothing to clear */ }
    },
  };
}
