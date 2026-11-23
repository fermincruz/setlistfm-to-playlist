import { allowedOrigin, handleRequest } from '../../worker/src/index.js';
import { assert, fakeFetch, noWait, test } from './harness.js';

const ORIGIN = 'https://ana.github.io';
const env = { SETLISTFM_API_KEY: 'secret-key', ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:8000/` };

function memoryCache() {
  const store = new Map();
  return {
    store,
    async match(request) {
      return store.get(request.url)?.clone();
    },
    async put(request, response) {
      store.set(request.url, response);
    },
  };
}

// Objeto equivalente a Request: los navegadores no permiten fijar "Origin" en un Request.
const fakeRequest = (method, path, headers = {}) => ({
  method,
  url: `https://proxy.example/${path}`,
  headers: new Headers({ Origin: ORIGIN, ...headers }),
});
const get = (path, headers = {}) => fakeRequest('GET', path, headers);

test('worker: allowedOrigin respeta la lista configurada', () => {
  assert.equal(allowedOrigin(ORIGIN, env.ALLOWED_ORIGINS), ORIGIN);
  assert.equal(allowedOrigin('http://localhost:8000', env.ALLOWED_ORIGINS), 'http://localhost:8000');
  assert.equal(allowedOrigin('https://evil.example', env.ALLOWED_ORIGINS), null);
  assert.equal(allowedOrigin(null, ''), '*');
});

test('worker: rechaza orígenes no permitidos y rutas desconocidas', async () => {
  const fetch = fakeFetch(() => ({ body: {} }));
  const denied = await handleRequest(get('setlist/63de4613', { Origin: 'https://evil.example' }), env, {}, { fetch, cache: null });
  assert.equal(denied.status, 403);
  const unknown = await handleRequest(get('user/someone/attended'), env, {}, { fetch, cache: null });
  assert.equal(unknown.status, 404);
  assert.equal(fetch.calls.length, 0);
});

test('worker: responde al preflight CORS', async () => {
  const response = await handleRequest(fakeRequest('OPTIONS', 'search/artists'), env, {}, { cache: null });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('worker: añade la API key, filtra parámetros y cachea', async () => {
  const fetch = fakeFetch(() => ({ body: { artist: [] } }));
  const cache = memoryCache();
  const request = () => get('search/artists?artistName=Muse&sort=relevance&evil=1', { 'Accept-Language': 'es-ES' });

  const first = await handleRequest(request(), env, {}, { fetch, cache, sleep: noWait });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('X-Cache'), 'MISS');
  assert.equal(first.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(fetch.calls[0].url, 'https://api.setlist.fm/rest/1.0/search/artists?artistName=muse&sort=relevance');
  assert.equal(fetch.calls[0].init.headers['x-api-key'], 'secret-key');
  assert.equal(fetch.calls[0].init.headers['Accept-Language'], 'es');

  // Misma búsqueda con otras mayúsculas y espacios: sale de la caché.
  const second = await handleRequest(get('search/artists?artistName=%20MUSE%20&sort=relevance', { 'Accept-Language': 'es' }), env, {}, { fetch, cache, sleep: noWait });
  assert.equal(second.headers.get('X-Cache'), 'HIT');
  assert.deepEqual(await second.json(), { artist: [] });
  assert.equal(fetch.calls.length, 1);
});

test('worker: reintenta ante 429 y oculta errores de la API key', async () => {
  const fetch = fakeFetch((url, init, n) => (n === 1 ? { status: 429 } : { body: { id: 'x' } }));
  const ok = await handleRequest(get('setlist/63de4613'), env, {}, { fetch, cache: null, sleep: noWait });
  assert.equal(ok.status, 200);
  assert.equal(fetch.calls.length, 2);

  const forbidden = await handleRequest(get('setlist/63de4613'), env, {}, { fetch: fakeFetch(() => ({ status: 403 })), cache: null, sleep: noWait });
  assert.equal(forbidden.status, 502);
  const body = await forbidden.json();
  assert.ok(!JSON.stringify(body).includes('secret-key'));
});

test('worker: acepta la ruta de conciertos de un artista por MBID', async () => {
  const fetch = fakeFetch(() => ({ body: { setlist: [] } }));
  const response = await handleRequest(get('artist/67f66c07-6e61-4026-ade5-7e782fad3a5d/setlists?p=2'), env, {}, { fetch, cache: null });
  assert.equal(response.status, 200);
  assert.ok(fetch.calls[0].url.endsWith('/artist/67f66c07-6e61-4026-ade5-7e782fad3a5d/setlists?p=2'));
});

test('worker: sin API key configurada devuelve error claro', async () => {
  const response = await handleRequest(get('setlist/63de4613'), { ALLOWED_ORIGINS: '' }, {}, { cache: null });
  assert.equal(response.status, 500);
});
