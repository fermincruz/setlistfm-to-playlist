// Cliente de setlist.fm. Las llamadas pasan por el proxy (Cloudflare Worker),
// que añade la API key: setlist.fm no admite peticiones desde el navegador.
import { parseSetlist } from '../core/setlist.js';
import { ApiError, retryAfterMs, sleep } from './errors.js';

const MIN_INTERVAL_MS = 550; // setlist.fm permite 2 peticiones por segundo.

export function normalizeQuery(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
const MAX_RETRIES = 2;

export function createSetlistClient({ baseUrl, lang = 'es', fetchImpl = globalThis.fetch.bind(globalThis), wait = sleep }) {
  const cache = new Map();
  let queue = Promise.resolve();
  let lastRequest = 0;

  function throttle() {
    const turn = queue.then(async () => {
      const delay = MIN_INTERVAL_MS - (Date.now() - lastRequest);
      if (delay > 0) await wait(delay);
      lastRequest = Date.now();
    });
    queue = turn.catch(() => {});
    return turn;
  }

  async function get(path, params = {}) {
    if (!baseUrl) throw new ApiError('proxy_not_configured');
    const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    Object.entries(params).forEach(([key, value]) => {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    });
    const cacheKey = url.toString();
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    for (let attempt = 0; ; attempt += 1) {
      await throttle();
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          headers: { Accept: 'application/json', 'Accept-Language': lang },
        });
      } catch (error) {
        throw new ApiError('network', { detail: String(error) });
      }
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await wait(retryAfterMs(response, attempt));
        continue;
      }
      if (response.status === 404) {
        cache.set(cacheKey, null);
        return null;
      }
      if (response.status === 429) throw new ApiError('setlistfm_rate_limit', { status: 429 });
      if (!response.ok) throw new ApiError('setlistfm_error', { status: response.status });
      const json = await response.json();
      cache.set(cacheKey, json);
      return json;
    }
  }

  return {
    async searchArtists(name) {
      // Normalizar el texto hace que "Muse", "muse " y "MUSE" compartan caché
      // (aquí y en el Worker) y gasten una sola llamada de la cuota de setlist.fm.
      const artistName = normalizeQuery(name);
      const json = await get('search/artists', { artistName, sort: 'relevance', p: 1 });
      return (json?.artist ?? []).map((a) => ({
        mbid: a.mbid,
        name: a.name,
        disambiguation: a.disambiguation ?? '',
      }));
    },

    async artistSetlists(mbid, page = 1) {
      const json = await get(`artist/${encodeURIComponent(mbid)}/setlists`, { p: page });
      const itemsPerPage = Number(json?.itemsPerPage) || 20;
      const total = Number(json?.total) || 0;
      return {
        setlists: (json?.setlist ?? []).map(parseSetlist),
        page,
        hasMore: page * itemsPerPage < total,
      };
    },

    async setlist(id) {
      const json = await get(`setlist/${encodeURIComponent(id)}`);
      if (!json) throw new ApiError('setlist_not_found', { status: 404 });
      return parseSetlist(json);
    },
  };
}
