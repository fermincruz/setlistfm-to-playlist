// Acceso seguro a localStorage/sessionStorage: puede no estar disponible
// (navegación privada, datos bloqueados), así que nunca lanza excepciones.

function wrap(getStore) {
  const store = () => {
    try {
      return getStore();
    } catch {
      return null;
    }
  };
  return {
    get(key, fallback = null) {
      try {
        const raw = store()?.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        store()?.setItem(key, JSON.stringify(value));
      } catch {
        /* sin almacenamiento: se ignora */
      }
    },
    remove(key) {
      try {
        store()?.removeItem(key);
      } catch {
        /* sin almacenamiento: se ignora */
      }
    },
  };
}

export const local = wrap(() => globalThis.localStorage);
export const session = wrap(() => globalThis.sessionStorage);

/** Almacenamiento en memoria con la misma interfaz (para tests). */
export function memoryStore() {
  const data = new Map();
  return {
    get: (key, fallback = null) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
    set: (key, value) => data.set(key, structuredClone(value)),
    remove: (key) => data.delete(key),
  };
}

// --- Elecciones recordadas -------------------------------------------------

const CHOICES_KEY = 'choices:v1';
const MAX_CHOICES = 500;

export function createChoiceMemory(store = local) {
  return {
    get(key) {
      return store.get(CHOICES_KEY, {})[key] ?? null;
    },
    remember(key, track) {
      const all = store.get(CHOICES_KEY, {});
      all[key] = { track, at: Date.now() };
      const entries = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CHOICES);
      store.set(CHOICES_KEY, Object.fromEntries(entries));
    },
    forget(key) {
      const all = store.get(CHOICES_KEY, {});
      delete all[key];
      store.set(CHOICES_KEY, all);
    },
    clear() {
      store.remove(CHOICES_KEY);
    },
    count() {
      return Object.keys(store.get(CHOICES_KEY, {})).length;
    },
  };
}
