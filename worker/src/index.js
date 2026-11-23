// Proxy de solo lectura para la API de setlist.fm.
//
// setlist.fm no admite llamadas desde navegadores (CORS) y su API key no debe
// publicarse en una web. Este Worker guarda la clave como secreto, solo deja
// pasar las consultas que usa la web y cachea las respuestas para ahorrar cuota
// (límite gratuito: 2 peticiones/segundo y 1440 al día).

const UPSTREAM = 'https://api.setlist.fm/rest/1.0/';

const ROUTES = [
  { pattern: /^setlist\/[0-9a-f]{4,12}$/, ttl: 6 * 3600 },
  { pattern: /^search\/artists$/, ttl: 24 * 3600 },
  { pattern: /^artist\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/setlists$/, ttl: 3600 },
];
const ALLOWED_PARAMS = new Set(['artistName', 'sort', 'p']);
const MAX_RETRIES = 2;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Accept-Language, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Origen permitido para CORS, o null si la petición no viene de la web configurada. */
export function allowedOrigin(origin, allowedList) {
  const allowed = String(allowedList ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (!allowed.length) return '*'; // Sin configurar: abierto (útil en desarrollo).
  return origin && allowed.includes(origin) ? origin : null;
}

export async function handleRequest(request, env, ctx = {}, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const cache = deps.cache !== undefined ? deps.cache : globalThis.caches?.default ?? null;

  const origin = allowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS);
  if (!origin) return json({ error: 'origin_not_allowed' }, 403);
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, cors);
  if (!env.SETLISTFM_API_KEY) return json({ error: 'proxy_not_configured' }, 500, cors);

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/+/, '').replace(/^rest\/1\.0\//, '');
  const route = ROUTES.find((r) => r.pattern.test(path));
  if (!route) return json({ error: 'not_found' }, 404, cors);

  const params = new URLSearchParams();
  [...url.searchParams.entries()]
    .filter(([key]) => ALLOWED_PARAMS.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => params.set(key, value.slice(0, 200)));
  const lang = (request.headers.get('Accept-Language') ?? '').toLowerCase().startsWith('es') ? 'es' : 'en';

  const upstreamUrl = `${UPSTREAM}${path}${params.size ? `?${params}` : ''}`;
  const cacheKey = new Request(`https://setlistfm-cache.internal/${lang}/${path}?${params}`);

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return withHeaders(hit, { ...cors, 'X-Cache': 'HIT' });
  }

  let upstream;
  for (let attempt = 0; ; attempt += 1) {
    upstream = await fetchImpl(upstreamUrl, {
      headers: { Accept: 'application/json', 'Accept-Language': lang, 'x-api-key': env.SETLISTFM_API_KEY },
    });
    if (upstream.status !== 429 || attempt >= MAX_RETRIES) break;
    await sleep(1000 * (attempt + 1));
  }

  if (upstream.status === 200 || upstream.status === 404) {
    const body = await upstream.text();
    const response = new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${upstream.status === 200 ? route.ttl : 600}`,
      },
    });
    if (cache) {
      const store = cache.put(cacheKey, response.clone());
      if (ctx.waitUntil) ctx.waitUntil(store);
      else await store;
    }
    return withHeaders(response, { ...cors, 'X-Cache': 'MISS' });
  }

  if (upstream.status === 429) return json({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '5' });
  // 401/403 significan que la API key del Worker no es válida: es un fallo del servidor, no del usuario.
  return json({ error: 'upstream_error', status: upstream.status }, 502, cors);
}

function withHeaders(response, headers) {
  const result = new Response(response.body, response);
  Object.entries(headers).forEach(([key, value]) => result.headers.set(key, value));
  return result;
}

export default {
  fetch: (request, env, ctx) => handleRequest(request, env, ctx),
};
