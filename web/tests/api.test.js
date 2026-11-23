import { createAuth, SCOPES, TOKEN_URL } from '../js/api/auth.js';
import { createSetlistClient } from '../js/api/setlistfm.js';
import { createTidalClient, mapTracks } from '../js/api/tidal.js';
import { createChoiceMemory, memoryStore } from '../js/storage.js';
import { assert, fakeFetch, noWait, test } from './harness.js';

// --- setlist.fm --------------------------------------------------------------

test('setlist.fm: busca artistas a través del proxy con idioma', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { artist: [{ mbid: 'm1', name: 'Vetusta Morla', disambiguation: 'Spanish band' }] } }));
  const client = createSetlistClient({ baseUrl: 'https://proxy.example/', lang: 'es', fetchImpl, wait: noWait });
  const artists = await client.searchArtists(' Vetusta ');
  assert.deepEqual(artists, [{ mbid: 'm1', name: 'Vetusta Morla', disambiguation: 'Spanish band' }]);
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, '/search/artists');
  assert.equal(url.searchParams.get('artistName'), 'vetusta');
  await client.searchArtists('VETUSTA');
  assert.equal(fetchImpl.calls.length, 1, 'misma búsqueda normalizada: sale de la caché');
  assert.equal(fetchImpl.calls[0].init.headers['Accept-Language'], 'es');
});

test('setlist.fm: un 404 de búsqueda significa "sin resultados"', async () => {
  const client = createSetlistClient({ baseUrl: 'https://proxy.example', fetchImpl: fakeFetch(() => ({ status: 404 })), wait: noWait });
  assert.deepEqual(await client.searchArtists('zzzz'), []);
});

test('setlist.fm: reintenta tras 429 y cachea la respuesta', async () => {
  const fetchImpl = fakeFetch((url, init, n) => (n === 1 ? { status: 429 } : { body: { id: 'abc123', artist: { name: 'X' } } }));
  const client = createSetlistClient({ baseUrl: 'https://proxy.example', fetchImpl, wait: noWait });
  const first = await client.setlist('abc123');
  const second = await client.setlist('abc123');
  assert.equal(first.artist, 'X');
  assert.equal(second.artist, 'X');
  assert.equal(fetchImpl.calls.length, 2, 'un 429 + un 200, y la segunda llamada sale de la caché');
});

test('setlist.fm: concierto inexistente y proxy sin configurar', async () => {
  const client = createSetlistClient({ baseUrl: 'https://proxy.example', fetchImpl: fakeFetch(() => ({ status: 404 })), wait: noWait });
  await assert.rejects(client.setlist('deadbeef'), 'setlist_not_found');
  const empty = createSetlistClient({ baseUrl: '', fetchImpl: fakeFetch(() => ({})), wait: noWait });
  await assert.rejects(empty.searchArtists('x'), 'proxy_not_configured');
});

test('setlist.fm: indica si hay más páginas de conciertos', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { setlist: [{ id: '1' }], total: 45, itemsPerPage: 20, page: 2 } }));
  const client = createSetlistClient({ baseUrl: 'https://proxy.example', fetchImpl, wait: noWait });
  const page = await client.artistSetlists('mbid', 2);
  assert.equal(page.hasMore, true);
  assert.ok(fetchImpl.calls[0].url.includes('artist/mbid/setlists?p=2'));
});

// --- TIDAL -------------------------------------------------------------------

const tracksDocument = {
  data: [
    {
      id: '111',
      type: 'tracks',
      attributes: { title: 'Everlong', version: 'Acoustic', duration: 'PT4M10S', popularity: 0.8, isrc: 'USRW29600011' },
      relationships: { artists: { data: [{ id: 'a1', type: 'artists' }] }, albums: { data: [{ id: 'al1', type: 'albums' }] } },
    },
    {
      id: '222',
      type: 'tracks',
      attributes: { title: 'Everlong', duration: 'PT4M50S', popularity: 0.9 },
      relationships: { artists: { data: [{ id: 'a1', type: 'artists' }] } },
    },
  ],
  included: [
    { id: 'a1', type: 'artists', attributes: { name: 'Foo Fighters' } },
    { id: 'al1', type: 'albums', attributes: { title: 'Skin and Bones' } },
  ],
};

test('TIDAL: mapTracks resuelve artistas, álbum, versión y duración', () => {
  const [first, second] = mapTracks(tracksDocument);
  assert.equal(first.artist, 'Foo Fighters');
  assert.equal(first.album, 'Skin and Bones');
  assert.equal(first.version, 'Acoustic');
  assert.equal(first.duration, 250);
  assert.equal(first.url, 'https://tidal.com/browse/track/111');
  assert.equal(second.album, '');
});

test('TIDAL: searchTracks busca y luego pide el detalle de las pistas en orden', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes('/searchResults')) {
      return { body: { data: { id: 'q', type: 'searchResults', relationships: { tracks: { data: [{ id: '222', type: 'tracks' }, { id: '111', type: 'tracks' }] } } } } };
    }
    return { body: tracksDocument };
  });
  const client = createTidalClient({ getToken: async () => 'tok', fetchImpl, wait: noWait });
  const tracks = await client.searchTracks('Foo Fighters Everlong', 'ES');
  assert.deepEqual(tracks.map((t) => t.id), ['222', '111'], 'conserva el orden de relevancia');

  const search = new URL(fetchImpl.calls[0].url);
  assert.equal(search.searchParams.get('filter[query]'), 'Foo Fighters Everlong');
  assert.equal(search.searchParams.get('countryCode'), 'ES');
  const detail = new URL(fetchImpl.calls[1].url);
  assert.equal(detail.pathname, '/v2/tracks');
  assert.deepEqual(detail.searchParams.getAll('filter[id]'), ['222', '111']);
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer tok');
});

test('TIDAL: searchArtists devuelve los artistas en orden de relevancia', async () => {
  const fetchImpl = fakeFetch(() => ({
    body: {
      data: { id: 'q', type: 'searchResults', relationships: { artists: { data: [{ id: '7', type: 'artists' }, { id: '3', type: 'artists' }] } } },
      included: [
        { id: '3', type: 'artists', attributes: { name: 'El Diablo' } },
        { id: '7', type: 'artists', attributes: { name: 'El Diablo de Shanghai' } },
      ],
    },
  }));
  const client = createTidalClient({ getToken: async () => 't', fetchImpl, wait: noWait });
  const artists = await client.searchArtists('El Diablo de Shanghai', 'ES');
  assert.deepEqual(artists, [{ id: '7', name: 'El Diablo de Shanghai' }, { id: '3', name: 'El Diablo' }]);
  assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('include'), 'artists');
});

test('TIDAL: artistTracks recorre las páginas del catálogo y pide los detalles', async () => {
  const fetchImpl = fakeFetch((url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/relationships/tracks')) {
      return u.searchParams.get('page[cursor]') === 'c2'
        ? { body: { data: [{ id: '222', type: 'tracks' }], links: { self: '/x' } } }
        : { body: { data: [{ id: '111', type: 'tracks' }], links: { self: '/x', next: '/x?page[cursor]=c2', meta: { nextCursor: 'c2' } } } };
    }
    return { body: tracksDocument };
  });
  const client = createTidalClient({ getToken: async () => 't', fetchImpl, wait: noWait });
  const tracks = await client.artistTracks('a1', 'ES');
  assert.deepEqual(tracks.map((t) => t.id), ['111', '222']);
  assert.equal(tracks[0].artist, 'Foo Fighters');
  assert.equal(fetchImpl.calls.length, 3, 'dos páginas + una llamada de detalles');
  assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('collapseBy'), 'FINGERPRINT');
  assert.deepEqual(new URL(fetchImpl.calls[2].url).searchParams.getAll('filter[id]'), ['111', '222']);
});

test('TIDAL: ante un 401 refresca el token una vez y reintenta', async () => {
  const tokens = [];
  const fetchImpl = fakeFetch((url, init, n) => (n === 1 ? { status: 401 } : { body: { data: { id: '9', attributes: { username: 'ana', country: 'ES' } } } }));
  const client = createTidalClient({
    getToken: async ({ forceRefresh }) => {
      tokens.push(forceRefresh);
      return forceRefresh ? 'new' : 'old';
    },
    fetchImpl,
    wait: noWait,
  });
  const me = await client.me();
  assert.deepEqual(me, { id: '9', username: 'ana', country: 'ES' });
  assert.deepEqual(tokens, [false, true]);
});

test('TIDAL: errores de permisos se informan con un código', async () => {
  const client = createTidalClient({ getToken: async () => 't', fetchImpl: fakeFetch(() => ({ status: 403 })), wait: noWait });
  await assert.rejects(client.me(), 'tidal_forbidden');
});

test('TIDAL: crea la playlist y añade las pistas en lotes de 50, en orden', async () => {
  const fetchImpl = fakeFetch((url) => (url.endsWith('/playlists') ? { status: 201, body: { data: { id: 'pl-1', type: 'playlists' } } } : { status: 201, body: '' }));
  const client = createTidalClient({ getToken: async () => 't', fetchImpl, wait: noWait });
  const ids = Array.from({ length: 120 }, (_, i) => String(i));
  const progress = [];
  const result = await client.createPlaylist({ name: 'Mi concierto', description: 'desc' }, ids, (done) => progress.push(done));

  assert.equal(result.url, 'https://tidal.com/browse/playlist/pl-1');
  assert.equal(fetchImpl.calls.length, 4);
  const created = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(created.data.attributes.name, 'Mi concierto');
  assert.equal(created.data.attributes.accessType, 'UNLISTED');
  const batches = fetchImpl.calls.slice(1).map((c) => JSON.parse(c.init.body).data.map((d) => d.id));
  assert.deepEqual(batches.map((b) => b.length), [50, 50, 20]);
  assert.deepEqual(batches.flat(), ids);
  assert.ok(fetchImpl.calls[1].url.endsWith('/playlists/pl-1/relationships/items'));
  assert.equal(fetchImpl.calls[1].init.headers['Content-Type'], 'application/vnd.api+json');
  assert.ok(fetchImpl.calls[1].init.headers['Idempotency-Key']);
  assert.deepEqual(progress, [50, 100, 120]);
});

test('TIDAL: no crea playlists vacías', async () => {
  const client = createTidalClient({ getToken: async () => 't', fetchImpl: fakeFetch(() => ({})), wait: noWait });
  await assert.rejects(client.createPlaylist({ name: 'x', description: '' }, []), 'no_tracks');
});

// --- OAuth PKCE --------------------------------------------------------------

function makeAuth(fetchImpl, now = () => 1_000_000) {
  const localStore = memoryStore();
  const sessionStore = memoryStore();
  const auth = createAuth({ clientId: 'client-1', redirectUri: 'https://me.github.io/app/', localStore, sessionStore, fetchImpl, now });
  return { auth, localStore, sessionStore };
}

test('OAuth: la URL de autorización usa PKCE S256 y scopes de terceros', async () => {
  const { auth, sessionStore } = makeAuth(fakeFetch(() => ({})));
  const url = new URL(await auth.authorizationUrl({ source: 'x' }));
  assert.equal(url.origin + url.pathname, 'https://login.tidal.com/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), SCOPES.join(' '));
  assert.ok(!url.searchParams.get('scope').includes('r_usr'), 'r_usr/w_usr son scopes internos de TIDAL');
  const pending = sessionStore.get('tidal:pkce');
  assert.equal(pending.state, url.searchParams.get('state'));
  assert.ok(pending.verifier.length >= 43);
});

test('OAuth: rechaza una respuesta con state distinto', async () => {
  const { auth } = makeAuth(fakeFetch(() => ({})));
  await auth.authorizationUrl();
  await assert.rejects(auth.handleRedirect('https://me.github.io/app/?code=abc&state=otro'), 'tidal_auth_state');
});

test('OAuth: intercambia el código y guarda los tokens', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { access_token: 'A1', refresh_token: 'R1', expires_in: 3600 } }));
  const { auth } = makeAuth(fetchImpl);
  const url = new URL(await auth.authorizationUrl({ source: 's' }));
  const result = await auth.handleRedirect(`https://me.github.io/app/?code=xyz&state=${url.searchParams.get('state')}`);
  assert.deepEqual(result, { resume: { source: 's' } });
  assert.equal(fetchImpl.calls[0].url, TOKEN_URL);
  const body = new URLSearchParams(fetchImpl.calls[0].init.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'xyz');
  assert.equal(body.get('client_id'), 'client-1');
  assert.ok(body.get('code_verifier'));
  assert.equal(await auth.getAccessToken(), 'A1');
  assert.equal(auth.isConnected(), true);
});

test('OAuth: refresca el token caducado y desconecta si el refresco falla', async () => {
  let time = 1_000_000;
  let refreshOk = true;
  const fetchImpl = fakeFetch(() => (refreshOk ? { body: { access_token: 'A2', expires_in: 3600 } } : { status: 400, body: { error: 'invalid_grant' } }));
  const { auth, localStore } = makeAuth(fetchImpl, () => time);
  localStore.set('tidal:tokens', { accessToken: 'A1', refreshToken: 'R1', expiresAt: time + 30_000 });

  assert.equal(await auth.getAccessToken(), 'A2', 'caduca en menos de un minuto: se refresca');
  assert.equal(localStore.get('tidal:tokens').refreshToken, 'R1', 'conserva el refresh token anterior');

  time += 2 * 3600 * 1000;
  refreshOk = false;
  await assert.rejects(auth.getAccessToken(), 'tidal_session_expired');
  assert.equal(auth.isConnected(), false);
});

test('OAuth: si el usuario cancela en TIDAL se informa', async () => {
  const { auth } = makeAuth(fakeFetch(() => ({})));
  await assert.rejects(auth.handleRedirect('https://me.github.io/app/?error=access_denied'), 'tidal_auth_denied');
  assert.equal(await auth.handleRedirect('https://me.github.io/app/'), null);
});

// --- Elecciones recordadas ----------------------------------------------------

test('recuerda y olvida elecciones de canciones', () => {
  const memory = createChoiceMemory(memoryStore());
  memory.remember('queen|bohemian rhapsody', { id: '1', title: 'Bohemian Rhapsody' });
  assert.equal(memory.get('queen|bohemian rhapsody').track.id, '1');
  assert.equal(memory.count(), 1);
  memory.clear();
  assert.equal(memory.get('queen|bohemian rhapsody'), null);
});
