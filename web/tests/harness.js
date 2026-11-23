// Mini framework de tests que funciona igual en Node y en el navegador.
const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

function fail(message) {
  throw new Error(message);
}

const show = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const assert = {
  ok(value, message = 'se esperaba un valor verdadero') {
    if (!value) fail(message);
  },
  equal(actual, expected, message = '') {
    if (actual !== expected) fail(`${message} esperado ${show(expected)}, recibido ${show(actual)}`.trim());
  },
  deepEqual(actual, expected, message = '') {
    if (show(actual) !== show(expected)) fail(`${message} esperado ${show(expected)}, recibido ${show(actual)}`.trim());
  },
  async rejects(promiseOrFn, code, message = '') {
    try {
      await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
    } catch (error) {
      if (code && error.code !== code) fail(`${message} se esperaba el error ${code}, recibido ${error.code ?? error.message}`.trim());
      return;
    }
    fail(`${message} se esperaba un error ${code ?? ''}`.trim());
  },
};

export async function run() {
  const results = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error?.stack ?? String(error) });
    }
  }
  return results;
}

// --- Dobles de prueba -------------------------------------------------------

/** fetch simulado: `routes` es una función (url, init) -> {status, body, headers}. */
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const result = await routes(String(url), init, calls.length);
    const body = result.body === undefined ? '' : typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    return new Response(result.status === 204 ? null : body, {
      status: result.status ?? 200,
      headers: result.headers ?? { 'Content-Type': 'application/json' },
    });
  };
  fn.calls = calls;
  return fn;
}

export const noWait = async () => {};
