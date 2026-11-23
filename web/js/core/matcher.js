// Elección de la pista de TIDAL que corresponde a cada canción del setlist.
import {
  artistSimilarity,
  baseTitle,
  normalize,
  parentheticals,
  titleSimilarity,
} from './text.js';

export const THRESHOLDS = Object.freeze({
  /** Por debajo de esto el título no se considera la misma canción. */
  titleMin: 0.75,
  /** Por debajo de esto el artista no se considera el mismo. */
  artistMin: 0.6,
  /** A partir de aquí se selecciona automáticamente sin pedir revisión. */
  autoTitle: 0.9,
  autoArtist: 0.8,
});

const UNWANTED =
  /\b(karaoke|tribute|instrumental|in the style of|originally performed|made famous|backing track|8 bit|lullaby|cover version|rendition)\b/;
const LIVE = /\b(live|en vivo|en directo|directo|unplugged|in concert)\b/;
const ALTERED = /\b(demo|remix|mix|edit|acoustic|acustic[oa]|rehearsal|session|sped up|slowed|reprise)\b/;
const MAX_CANDIDATES = 8;

/** Artistas aceptables para una entrada: quien toca y, si es versión, el autor original. */
export function wantedArtists(entry) {
  const artists = [entry.performer];
  if (entry.originalArtist && normalize(entry.originalArtist) !== normalize(entry.performer)) {
    artists.push(entry.originalArtist);
  }
  return artists.filter(Boolean);
}

/** Búsquedas a probar, de la más precisa a la más amplia. */
export function buildQueries(entry) {
  const titles = unique([entry.title, baseTitle(entry.title)]);
  const queries = [];
  for (const artist of wantedArtists(entry)) {
    for (const title of titles) queries.push(`${artist} ${title}`);
  }
  queries.push(baseTitle(entry.title));
  return unique(queries.map((query) => query.trim().slice(0, 256)).filter(Boolean));
}

export function scoreCandidate(entry, track, prefs = {}) {
  const titleSim = titleSimilarity(entry.title, track.title);
  const artists = track.artists?.length ? track.artists : [track.artist];
  const sims = wantedArtists(entry).map((name) => artistSimilarity(name, artists));
  const performerSim = sims[0] ?? 0;
  const artistSim = Math.max(0, ...sims);

  const popularity = Number(track.popularity) || 0;
  let score = 0.6 * titleSim + 0.3 * artistSim + 0.1 * Math.min(1, popularity > 1 ? popularity / 100 : popularity);

  const versionInfo = normalize(`${track.version ?? ''} ${parentheticals(track.title)}`);
  const album = normalize(track.album ?? '');
  const wanted = normalize(entry.title);

  const artistText = normalize(artists.join(' '));
  const wantedArtistText = normalize(wantedArtists(entry).join(' '));
  const unwantedArtist = UNWANTED.test(artistText) && !UNWANTED.test(wantedArtistText);
  if (UNWANTED.test(versionInfo) || UNWANTED.test(album) || unwantedArtist) score -= 0.4;

  const isLive = LIVE.test(versionInfo) || /\blive\b/.test(album);
  if (!LIVE.test(wanted)) score += isLive === Boolean(prefs.preferLive) ? 0.08 : -0.08;

  if (ALTERED.test(versionInfo) && !ALTERED.test(wanted)) score -= 0.05;

  // En las versiones, preferimos la grabación del grupo que tocó en el concierto.
  if (entry.originalArtist && performerSim >= THRESHOLDS.artistMin) score += 0.04;

  return { track, score, titleSim, artistSim, isLive };
}

/** Candidatos aceptables, sin duplicados (mismo id o ISRC) y ordenados por puntuación. */
export function rankCandidates(entry, tracks, prefs = {}) {
  const scored = tracks
    .map((track) => scoreCandidate(entry, track, prefs))
    .filter((c) => c.titleSim >= THRESHOLDS.titleMin && c.artistSim >= THRESHOLDS.artistMin)
    .sort((a, b) => b.score - a.score);

  const seen = new Set();
  const result = [];
  for (const candidate of scored) {
    const keys = [`id:${candidate.track.id}`];
    if (candidate.track.isrc) keys.push(`isrc:${candidate.track.isrc}`);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    result.push(candidate);
  }
  return result.slice(0, MAX_CANDIDATES);
}

export function isConfident(candidate) {
  return Boolean(
    candidate &&
      candidate.titleSim >= THRESHOLDS.autoTitle &&
      candidate.artistSim >= THRESHOLDS.autoArtist,
  );
}

/**
 * Resuelve una entrada probando búsquedas en cascada.
 * `search(query)` devuelve una lista de pistas normalizadas de TIDAL.
 *
 * Estados: "auto" (coincidencia clara), "review" (probable, conviene revisar)
 * y "notfound" (ningún resultado se parece lo suficiente).
 */
export async function resolveEntry(entry, search, prefs = {}) {
  const all = new Map();
  let ranked = [];
  for (const query of buildQueries(entry)) {
    const tracks = await search(query);
    tracks.forEach((track) => {
      if (!all.has(track.id)) all.set(track.id, track);
    });
    ranked = rankCandidates(entry, [...all.values()], prefs);
    if (isConfident(ranked[0])) break;
  }

  const candidates = ranked.map((c) => ({ ...c.track, score: c.score }));
  if (!ranked.length) {
    // Se ofrecen igualmente los resultados en bruto para elegir a mano.
    const others = [...all.values()].slice(0, MAX_CANDIDATES);
    return { status: 'notfound', selectedId: null, candidates: others };
  }
  return {
    status: isConfident(ranked[0]) ? 'auto' : 'review',
    selectedId: ranked[0].track.id,
    candidates,
  };
}

/** Clave estable para recordar la elección del usuario para una canción. */
export function choiceKey(entry) {
  return `${normalize(entry.performer)}|${normalize(baseTitle(entry.title))}`;
}

function unique(values) {
  return [...new Set(values)];
}
