// Cliente de la API oficial de TIDAL (https://openapi.tidal.com/v2, JSON:API).
import { parseIsoDuration } from '../core/text.js';
import { ApiError, retryAfterMs, sleep } from './errors.js';

export const TIDAL_API = 'https://openapi.tidal.com/v2/';
const JSON_API = 'application/vnd.api+json';
const MAX_RETRIES = 3;
const MAX_SEARCH_RESULTS = 20;
const MAX_IDS_PER_REQUEST = 20;
const MAX_CATALOG_PAGES = 10;
const MAX_ITEMS_PER_REQUEST = 50;

/**
 * `getToken({ forceRefresh })` devuelve un access token válido.
 */
export function createTidalClient({ getToken, fetchImpl = globalThis.fetch.bind(globalThis), wait = sleep, baseUrl = TIDAL_API }) {
  async function request(method, path, { params = {}, body, headers = {} } = {}) {
    const url = new URL(path, baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
      else if (value != null && value !== '') url.searchParams.set(key, String(value));
    });

    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      const token = await getToken({ forceRefresh: refreshed });
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method,
          headers: {
            Accept: JSON_API,
            Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': JSON_API } : {}),
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (error) {
        throw new ApiError('network', { detail: String(error) });
      }

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        await wait(retryAfterMs(response, attempt));
        continue;
      }
      if (response.status === 401) throw new ApiError('tidal_unauthorized', { status: 401 });
      if (response.status === 403) throw new ApiError('tidal_forbidden', { status: 403 });
      if (response.status === 429) throw new ApiError('tidal_rate_limit', { status: 429 });
      if (!response.ok) throw new ApiError('tidal_error', { status: response.status });
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }
  }

  async function tracksByIds(ids, countryCode) {
    const byId = new Map();
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      const json = await request('GET', 'tracks', {
        params: {
          'filter[id]': ids.slice(i, i + MAX_IDS_PER_REQUEST),
          countryCode,
          include: 'artists,albums',
        },
      });
      mapTracks(json).forEach((track) => byId.set(track.id, track));
    }
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  return {
    async me() {
      const json = await request('GET', 'users/me');
      const attributes = json?.data?.attributes ?? {};
      return { id: json?.data?.id ?? '', username: attributes.username ?? '', country: attributes.country ?? '' };
    },

    /** Busca pistas y devuelve sus datos completos (artistas, álbum, versión...). */
    async searchTracks(query, countryCode) {
      const json = await request('GET', 'searchResults', {
        params: { 'filter[query]': query, countryCode, include: 'tracks' },
      });
      const linked = json?.data?.relationships?.tracks?.data ?? [];
      const ids = (linked.length ? linked : (json?.included ?? []).filter((r) => r.type === 'tracks'))
        .map((r) => r.id)
        .filter(Boolean)
        .slice(0, MAX_SEARCH_RESULTS);
      return ids.length ? tracksByIds(ids, countryCode) : [];
    },

    tracksByIds,

    /** Busca artistas por nombre (en orden de relevancia de TIDAL). */
    async searchArtists(query, countryCode) {
      const json = await request('GET', 'searchResults', {
        params: { 'filter[query]': query, countryCode, include: 'artists' },
      });
      const names = new Map(
        (json?.included ?? []).filter((r) => r.type === 'artists').map((r) => [String(r.id), r.attributes?.name ?? '']),
      );
      const linked = json?.data?.relationships?.artists?.data ?? [];
      const ids = linked.length ? linked.map((r) => String(r.id)) : [...names.keys()];
      return ids.map((id) => ({ id, name: names.get(id) ?? '' })).filter((a) => a.name);
    },

    /**
     * Todas las pistas de un artista (hasta `maxPages` páginas), con sus
     * datos completos. Sirve para encontrar canciones con títulos genéricos
     * que la búsqueda general entierra bajo resultados de otros artistas.
     */
    async artistTracks(artistId, countryCode, { maxPages = MAX_CATALOG_PAGES } = {}) {
      const ids = [];
      let cursor = null;
      for (let page = 0; page < maxPages; page += 1) {
        const json = await request('GET', `artists/${encodeURIComponent(artistId)}/relationships/tracks`, {
          params: { countryCode, collapseBy: 'FINGERPRINT', 'page[cursor]': cursor },
        });
        (json?.data ?? []).forEach((r) => {
          if (r?.id && !ids.includes(String(r.id))) ids.push(String(r.id));
        });
        cursor = json?.links?.meta?.nextCursor ?? null;
        if (!cursor || !json?.data?.length) break;
      }
      return ids.length ? tracksByIds(ids, countryCode) : [];
    },

    /** Crea la playlist y añade las pistas en orden (lotes de 50). */
    async createPlaylist({ name, description, accessType = 'UNLISTED' }, trackIds, onProgress = () => {}) {
      if (!trackIds.length) throw new ApiError('no_tracks');
      const operation = randomId();
      const created = await request('POST', 'playlists', {
        headers: { 'Idempotency-Key': operation },
        body: {
          data: {
            type: 'playlists',
            attributes: {
              name: name.slice(0, 250),
              description: description.slice(0, 500),
              accessType,
            },
          },
        },
      });
      const id = created?.data?.id;
      if (!id) throw new ApiError('tidal_error', { detail: 'missing playlist id' });

      for (let i = 0; i < trackIds.length; i += MAX_ITEMS_PER_REQUEST) {
        const batch = trackIds.slice(i, i + MAX_ITEMS_PER_REQUEST);
        await request('POST', `playlists/${encodeURIComponent(id)}/relationships/items`, {
          headers: { 'Idempotency-Key': `${operation}-${i}` },
          body: { data: batch.map((trackId) => ({ id: trackId, type: 'tracks' })) },
        });
        onProgress(Math.min(i + batch.length, trackIds.length), trackIds.length);
      }
      return { id, url: `https://tidal.com/browse/playlist/${id}` };
    },
  };
}

/** Convierte un documento JSON:API de pistas en objetos simples. */
export function mapTracks(json) {
  const included = new Map((json?.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
  const data = Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : [];
  return data
    .filter((r) => r.type === 'tracks')
    .map((r) => {
      const attributes = r.attributes ?? {};
      const artists = (r.relationships?.artists?.data ?? [])
        .map((link) => included.get(`artists:${link.id}`)?.attributes?.name)
        .filter(Boolean);
      const albumLink = r.relationships?.albums?.data?.[0];
      const album = albumLink ? included.get(`albums:${albumLink.id}`)?.attributes : null;
      return {
        id: String(r.id),
        title: attributes.title ?? '',
        version: attributes.version ?? '',
        artists,
        artist: artists.join(', '),
        album: album?.title ?? '',
        duration: parseIsoDuration(attributes.duration),
        popularity: Number(attributes.popularity) || 0,
        isrc: attributes.isrc ?? '',
        explicit: Boolean(attributes.explicit),
        url: `https://tidal.com/browse/track/${r.id}`,
      };
    });
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
