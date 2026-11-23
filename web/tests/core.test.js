import { buildQueries, pickArtist, rankCandidates, resolveEntry, scoreCandidate } from '../js/core/matcher.js';
import {
  aggregateTour,
  buildEntries,
  extractSetlistId,
  findSetlistUrl,
  parseSetlist,
  pickTourSetlists,
  splitMedley,
} from '../js/core/setlist.js';
import { artistSimilarity, baseTitle, normalize, parseIsoDuration, titleSimilarity } from '../js/core/text.js';
import { assert, test } from './harness.js';

const track = (id, title, artists, extra = {}) => ({
  id,
  title,
  artists: [].concat(artists),
  artist: [].concat(artists).join(', '),
  album: '',
  version: '',
  popularity: 0.5,
  isrc: '',
  ...extra,
});

const entry = (title, performer, extra = {}) => ({ key: 'e0', title, performer, originalArtist: null, ...extra });

const searchFrom = (results) => {
  const fn = async (query) => {
    fn.queries.push(query);
    return typeof results === 'function' ? results(query) : results;
  };
  fn.queries = [];
  return fn;
};

// --- text -------------------------------------------------------------------

test('normalize quita tildes, puntuación y unifica &', () => {
  assert.equal(normalize('  Acróbata  '), 'acrobata');
  assert.equal(normalize('Don’t Stop Me Now!'), 'dont stop me now');
  assert.equal(normalize('Simon & Garfunkel'), 'simon and garfunkel');
});

test('baseTitle elimina sufijos de versión pero respeta paréntesis del título', () => {
  assert.equal(baseTitle("Don't Stop Me Now - Remastered 2011"), "Don't Stop Me Now");
  assert.equal(baseTitle('Hey Jude (Live at Wembley)'), 'Hey Jude');
  assert.equal(baseTitle("(I Can't Get No) Satisfaction"), "(I Can't Get No) Satisfaction");
  assert.equal(baseTitle('Love Me Do [Mono]'), 'Love Me Do');
});

test('titleSimilarity tolera remasters, tildes y mayúsculas', () => {
  assert.ok(titleSimilarity("Don't Stop Me Now", 'Don’t Stop Me Now - Remastered 2011') >= 0.99);
  assert.ok(titleSimilarity('Maldito duende', 'Maldito Duende') >= 0.99);
  assert.ok(titleSimilarity('Creep', 'Karma Police') < 0.5);
});

test('artistSimilarity ignora "The" y acepta artistas contenidos', () => {
  assert.equal(artistSimilarity('The Beatles', ['Beatles']), 1);
  assert.ok(artistSimilarity('Bruce Springsteen', ['Bruce Springsteen & The E Street Band']) >= 0.9);
  assert.ok(artistSimilarity('Muse', ['Museum Choir']) < 0.6);
});

test('parseIsoDuration convierte PT3M45S', () => {
  assert.equal(parseIsoDuration('PT3M45S'), 225);
  assert.equal(parseIsoDuration('PT1H2M'), 3720);
  assert.equal(parseIsoDuration(''), 0);
});

// --- matcher ----------------------------------------------------------------

test('no selecciona otra canción del mismo artista si la buscada no está (bug anterior)', async () => {
  const search = searchFrom([track('1', 'Karma Police', 'Radiohead'), track('2', 'No Surprises', 'Radiohead')]);
  const result = await resolveEntry(entry('Creep', 'Radiohead'), search);
  assert.equal(result.status, 'notfound');
  assert.equal(result.selectedId, null);
  assert.equal(result.candidates.length, 2, 'ofrece los resultados en bruto para elegir a mano');
});

test('coincidencia clara con remaster se selecciona automáticamente', async () => {
  const search = searchFrom([track('9', 'Don’t Stop Me Now - Remastered 2011', 'Queen')]);
  const result = await resolveEntry(entry("Don't Stop Me Now", 'Queen'), search);
  assert.equal(result.status, 'auto');
  assert.equal(result.selectedId, '9');
});

test('deja de buscar en cuanto hay una coincidencia clara', async () => {
  const search = searchFrom([track('1', 'Creep', 'Radiohead')]);
  await resolveEntry(entry('Creep', 'Radiohead'), search);
  assert.equal(search.queries.length, 1);
});

test('prueba búsquedas alternativas si la primera no da resultado', async () => {
  const search = searchFrom((q) => (q === 'Hey Jude' ? [track('5', 'Hey Jude', 'The Beatles')] : []));
  const result = await resolveEntry(entry('Hey Jude (Live)', 'The Beatles'), search);
  assert.deepEqual(search.queries, ['The Beatles Hey Jude (Live)', 'The Beatles Hey Jude', 'Hey Jude']);
  assert.equal(result.selectedId, '5');
});

test('encuentra títulos genéricos en el catálogo del artista aunque la búsqueda los entierre', async () => {
  // Caso real: "Editorial" de El Diablo de Shanghai. La búsqueda general de
  // TIDAL devuelve solo canciones populares de otros artistas.
  const others = Array.from({ length: 20 }, (_, i) => track(`o${i}`, 'Editorial', `Otro Artista ${i}`));
  const search = searchFrom(others);
  const catalog = [
    track('d1', 'Editorial', 'El Diablo de Shanghai'),
    track('d2', 'Pisa Fuerte', 'El Diablo de Shanghai'),
    track('d3', 'Todo y Más', 'El Diablo de Shanghai'),
  ];
  const editorial = await resolveEntry(entry('Editorial', 'El Diablo de Shanghai'), search, {}, catalog);
  assert.equal(editorial.status, 'auto');
  assert.equal(editorial.selectedId, 'd1');
  assert.equal(search.queries.length, 0, 'no hace falta buscar si está en el catálogo');

  const todo = await resolveEntry(entry('Todo y Más', 'El Diablo de Shanghai'), search, {}, catalog);
  assert.equal(todo.selectedId, 'd3');
});

test('si la canción no está en el catálogo (p. ej. una versión), recurre a la búsqueda', async () => {
  const search = searchFrom([track('s1', 'Reptilia', 'The Strokes')]);
  const catalog = [track('d1', 'Editorial', 'El Diablo de Shanghai')];
  const result = await resolveEntry(entry('Reptilia', 'El Diablo de Shanghai', { originalArtist: 'The Strokes' }), search, {}, catalog);
  assert.equal(result.selectedId, 's1');
  assert.ok(search.queries.length >= 1);
});

test('pickArtist exige el mismo nombre de artista', () => {
  const artists = [
    { id: '1', name: 'El Diablo' },
    { id: '2', name: 'El Diablo De Shanghai' },
    { id: '3', name: 'El Diablo de Shanghai Tributo' },
  ];
  assert.equal(pickArtist('El Diablo de Shanghai', artists).id, '2');
  assert.equal(pickArtist('The Beatles', [{ id: 'b', name: 'Beatles' }]).id, 'b');
  assert.equal(pickArtist('Queen', [{ id: 'q', name: 'Queen Tribute Band' }]), null);
});

test('título parecido pero no idéntico queda para revisar', async () => {
  const result = await resolveEntry(entry('Black', 'Pearl Jam'), searchFrom([track('3', 'Blacks', 'Pearl Jam')]));
  assert.equal(result.status, 'review');
  assert.equal(result.selectedId, '3');
});

test('penaliza karaoke y bandas tributo', () => {
  const wanted = entry('Bohemian Rhapsody', 'Queen');
  const ranked = rankCandidates(wanted, [
    track('k', 'Bohemian Rhapsody (Karaoke Version)', 'Queen'),
    track('t', 'Bohemian Rhapsody', 'Queen Tribute Band'),
    track('o', 'Bohemian Rhapsody', 'Queen', { popularity: 0.1 }),
  ]);
  assert.equal(ranked[0].track.id, 'o');
});

test('prefiere estudio o directo según la opción elegida', () => {
  const wanted = entry('Everlong', 'Foo Fighters');
  const studio = track('s', 'Everlong', 'Foo Fighters');
  const live = track('l', 'Everlong', 'Foo Fighters', { version: 'Live at Wembley Stadium' });
  assert.equal(rankCandidates(wanted, [live, studio])[0].track.id, 's');
  assert.equal(rankCandidates(wanted, [studio, live], { preferLive: true })[0].track.id, 'l');
});

test('en las versiones prefiere la grabación del grupo que tocó', () => {
  const wanted = entry('Under Pressure', 'Foo Fighters', { originalArtist: 'Queen' });
  const ranked = rankCandidates(wanted, [
    track('q', 'Under Pressure', ['Queen', 'David Bowie']),
    track('f', 'Under Pressure', 'Foo Fighters'),
  ]);
  assert.equal(ranked[0].track.id, 'f');
  assert.equal(ranked.length, 2, 'la original sigue siendo una alternativa válida');
  assert.ok(buildQueries(wanted).includes('Queen Under Pressure'));
});

test('elimina duplicados por ISRC', () => {
  const ranked = rankCandidates(entry('Creep', 'Radiohead'), [
    track('1', 'Creep', 'Radiohead', { isrc: 'GBAYE9200070' }),
    track('2', 'Creep', 'Radiohead', { isrc: 'GBAYE9200070' }),
  ]);
  assert.equal(ranked.length, 1);
});

test('scoreCandidate usa la popularidad solo para desempatar', () => {
  const wanted = entry('Creep', 'Radiohead');
  const popular = scoreCandidate(wanted, track('1', 'Creep', 'Radiohead', { popularity: 0.9 }));
  const rare = scoreCandidate(wanted, track('2', 'Creep', 'Radiohead', { popularity: 0.1 }));
  assert.ok(popular.score > rare.score);
  assert.ok(popular.score - rare.score < 0.1);
});

// --- setlist ----------------------------------------------------------------

const rawSetlist = {
  id: '63de4613',
  eventDate: '14-06-2025',
  url: 'https://www.setlist.fm/setlist/foo-fighters/2025/x-63de4613.html',
  artist: { mbid: '67f66c07-6e61-4026-ade5-7e782fad3a5d', name: 'Foo Fighters' },
  venue: { name: 'Estadio Metropolitano', city: { name: 'Madrid', country: { code: 'ES', name: 'España' } } },
  tour: { name: 'Everything or Nothing at All' },
  sets: {
    set: [
      {
        song: [
          { name: 'Intro', tape: true },
          { name: 'All My Life' },
          { name: 'Under Pressure', cover: { name: 'Queen' }, with: { name: 'Brian May' } },
          { name: 'Song A / Song B' },
          { name: 'Enter Sandman', info: 'snippet', cover: { name: 'Metallica' } },
          { name: '' },
        ],
      },
      { encore: 1, song: [{ name: 'Everlong' }] },
    ],
  },
};

test('extrae el id de un enlace de setlist.fm, también dentro de un texto compartido', () => {
  assert.equal(extractSetlistId('https://www.setlist.fm/setlist/foo-fighters/2025/x-63de4613.html'), '63de4613');
  assert.equal(extractSetlistId('Mira esto: https://setlist.fm/setlist/a/2024/b-3bd6a1e3.html ¡genial!'), '3bd6a1e3');
  assert.equal(extractSetlistId('https://example.com/setlist/a-63de4613.html'), null);
  assert.equal(findSetlistUrl('x https://www.setlist.fm/setlist/a/b-1234abcd.html y'), 'https://www.setlist.fm/setlist/a/b-1234abcd.html');
});

test('parseSetlist lee los datos del concierto', () => {
  const s = parseSetlist(rawSetlist);
  assert.equal(s.artist, 'Foo Fighters');
  assert.equal(s.date, '2025-06-14');
  assert.equal(s.city, 'Madrid');
  assert.equal(s.tour, 'Everything or Nothing at All');
  assert.equal(s.songCount, 5, 'no cuenta cintas ni canciones vacías');
});

test('buildEntries marca cintas, versiones, medleys, fragmentos y bises', () => {
  const entries = buildEntries(parseSetlist(rawSetlist));
  assert.deepEqual(entries.map((e) => e.title), ['Intro', 'All My Life', 'Under Pressure', 'Song A', 'Song B', 'Enter Sandman', 'Everlong']);
  assert.ok(entries[0].isTape);
  assert.equal(entries[2].originalArtist, 'Queen');
  assert.equal(entries[2].guest, 'Brian May');
  assert.equal(entries[3].medleyOf, 'Song A / Song B');
  assert.ok(entries[5].isSnippet);
  assert.ok(entries[6].isEncore);
  assert.equal(new Set(entries.map((e) => e.key)).size, entries.length, 'claves únicas');
});

test('splitMedley no rompe títulos sin separador', () => {
  assert.deepEqual(splitMedley('AC/DC Song'), ['AC/DC Song']);
});

const show = (date, songs, tour = 'Tour') =>
  parseSetlist({
    eventDate: date,
    artist: { name: 'Band' },
    tour: tour ? { name: tour } : undefined,
    sets: { set: [{ song: songs.map((name) => ({ name })) }] },
  });

test('pickTourSetlists usa los conciertos con canciones de la gira más reciente', () => {
  const setlists = [
    show('20-12-2026', []), // concierto futuro, aún sin canciones
    show('10-11-2026', ['A']),
    show('01-11-2026', ['A'], 'Old Tour'),
    show('05-11-2026', ['B']),
  ];
  const result = pickTourSetlists(setlists);
  assert.equal(result.tourName, 'Tour');
  assert.deepEqual(result.setlists.map((s) => s.date), ['2026-11-10', '2026-11-05']);
});

test('aggregateTour ordena por posición media y filtra por frecuencia', () => {
  const setlists = [
    show('03-11-2026', ['Intro Song', 'Hit', 'Rare', 'Closer']),
    show('02-11-2026', ['Intro Song', 'Hit', 'Closer']),
    show('01-11-2026', ['Hit', 'Intro Song', 'Closer']),
  ];
  const half = aggregateTour(setlists, { minShare: 0.5 });
  assert.deepEqual(half.map((e) => e.title), ['Intro Song', 'Hit', 'Closer']);
  assert.equal(half[0].frequency, 1);
  const all = aggregateTour(setlists, { minShare: 0.3 });
  assert.ok(all.some((e) => e.title === 'Rare'));
});
