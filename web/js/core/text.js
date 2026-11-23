// Normalización y similitud de textos (títulos de canciones y nombres de artistas).

const VERSION_WORDS =
  /\b(live|en vivo|en directo|directo|acoustic|acustic[oa]|unplugged|demo|remix|mix|edit|instrumental|karaoke|version|remaster(ed)?|mono|stereo|session|sessions|rehearsal|radio|extended|single|bonus|deluxe|feat|ft|featuring|with|re recorded|anniversary|\d{4})\b/;

export function stripDiacritics(value) {
  return String(value).normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** Minúsculas, sin tildes ni puntuación, con "&" y "+" unificados como "and". */
export function normalize(value = '') {
  return stripDiacritics(value ?? '')
    .toLowerCase()
    .replace(/[’‘´`]/g, "'")
    .replace(/[&+]/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeArtist(value = '') {
  return normalize(value).replace(/^the /, '');
}

/** True si el texto describe una versión (directo, remaster, remix, feat...). */
export function isVersionText(value) {
  return VERSION_WORDS.test(normalize(value));
}

/**
 * Título sin los añadidos de versión: "Song (Remastered 2011)" -> "Song",
 * "Song - Live at Wembley" -> "Song". Respeta paréntesis que forman parte del
 * título, como "(I Can't Get No) Satisfaction".
 */
export function baseTitle(title = '') {
  let result = String(title)
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (match, inner) => (isVersionText(inner) ? ' ' : match))
    .replace(/\s+[-–—]\s+(.*)$/, (match, rest) => (isVersionText(rest) ? '' : match));
  result = result.replace(/\s+/g, ' ').trim();
  return result || String(title).trim();
}

/** Texto entre paréntesis o corchetes del título (suele indicar la versión). */
export function parentheticals(title = '') {
  const parts = [];
  String(title).replace(/[([]([^)\]]*)[)\]]/g, (_, inner) => parts.push(inner));
  const dash = String(title).match(/\s+[-–—]\s+(.*)$/);
  if (dash) parts.push(dash[1]);
  return parts.join(' ');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Similitud 0..1 basada en distancia de edición. */
export function ratio(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function tokenSortRatio(a, b) {
  const sort = (value) => value.split(' ').filter(Boolean).sort().join(' ');
  return ratio(sort(a), sort(b));
}

export function titleSimilarity(wanted, candidate) {
  const full = ratio(normalize(wanted), normalize(candidate));
  const baseA = normalize(baseTitle(wanted));
  const baseB = normalize(baseTitle(candidate));
  return Math.max(full, ratio(baseA, baseB), tokenSortRatio(baseA, baseB));
}

/** Mejor similitud entre el artista buscado y cualquiera de los artistas de la pista. */
export function artistSimilarity(wanted, candidateArtists = []) {
  const target = normalizeArtist(wanted);
  if (!target) return 0;
  let best = 0;
  for (const name of candidateArtists) {
    const candidate = normalizeArtist(name);
    if (!candidate) continue;
    let score = ratio(target, candidate);
    const shorter = target.length <= candidate.length ? target : candidate;
    const longer = shorter === target ? candidate : target;
    if (shorter.length >= 3 && ` ${longer} `.includes(` ${shorter} `)) {
      // "Bruce Springsteen" dentro de "Bruce Springsteen and The E Street Band".
      score = Math.max(score, 0.9);
    }
    best = Math.max(best, score);
  }
  return best;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

/** Convierte una duración ISO 8601 ("PT3M45S") en segundos. */
export function parseIsoDuration(value) {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value ?? '');
  if (!match) return 0;
  const [, d, h, m, s] = match.map((part) => Number(part ?? 0));
  return Math.round(d * 86400 + h * 3600 + m * 60 + s);
}
