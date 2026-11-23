// Lectura de setlists de setlist.fm y preparación de la lista de canciones.
import { normalize } from './text.js';

const SETLIST_URL = /https?:\/\/(?:www\.)?setlist\.fm\/setlist\/[^\s"'<>]*?-([0-9a-f]{6,12})\.html/i;

/** Extrae el id de un enlace de setlist.fm, aunque venga dentro de un texto compartido. */
export function extractSetlistId(text) {
  const match = SETLIST_URL.exec(String(text ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}

export function findSetlistUrl(text) {
  const match = SETLIST_URL.exec(String(text ?? ''));
  return match ? match[0] : null;
}

/** "23-11-2026" -> "2026-11-23". */
export function isoDate(eventDate) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(eventDate ?? '');
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

export function parseSetlist(raw) {
  const venue = raw?.venue ?? {};
  const city = venue.city ?? {};
  const sets = (raw?.sets?.set ?? []).map((set, setIndex) => ({
    name: set.name ?? '',
    encore: Number(set.encore) > 0,
    index: setIndex,
    songs: (set.song ?? [])
      .filter((song) => String(song?.name ?? '').trim())
      .map((song) => ({
        name: String(song.name).trim(),
        info: song.info ?? '',
        tape: Boolean(song.tape),
        cover: song.cover?.name ?? null,
        guest: song.with?.name ?? null,
      })),
  }));
  return {
    id: raw?.id ?? '',
    artist: raw?.artist?.name ?? '',
    artistMbid: raw?.artist?.mbid ?? '',
    venue: venue.name ?? '',
    city: city.name ?? '',
    country: city.country?.name ?? '',
    countryCode: city.country?.code ?? '',
    date: isoDate(raw?.eventDate),
    tour: raw?.tour?.name ?? '',
    url: raw?.url ?? '',
    sets,
    songCount: sets.reduce((n, set) => n + set.songs.filter((s) => !s.tape).length, 0),
  };
}

export function hasSongs(setlist) {
  return setlist.songCount > 0;
}

function isSnippet(info) {
  return /\b(snippet|fragment|fragmento|partial|parcial|teaser)\b/i.test(info ?? '');
}

/** Divide un medley escrito como "Canción A / Canción B". */
export function splitMedley(name) {
  const parts = String(name)
    .split(/\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [String(name).trim()];
}

/**
 * Convierte el setlist en la lista de entradas a buscar. Las cintas
 * (intros/outros) y los fragmentos quedan marcados para excluirse por defecto.
 */
export function buildEntries(setlist) {
  const entries = [];
  for (const set of setlist.sets) {
    for (const song of set.songs) {
      const parts = splitMedley(song.name);
      parts.forEach((title) => {
        entries.push({
          key: `e${entries.length}`,
          title,
          performer: setlist.artist,
          originalArtist: song.cover,
          isTape: song.tape,
          isSnippet: isSnippet(song.info),
          isEncore: set.encore,
          medleyOf: parts.length > 1 ? song.name : null,
          guest: song.guest,
          info: song.info,
          frequency: null,
        });
      });
    }
  }
  return entries;
}

/** Fecha en formato local ("23 nov 2026"). */
export function formatDate(iso, locale) {
  if (!iso) return '';
  const date = new Date(`${iso}T12:00:00Z`);
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function defaultPlaylistName(setlist, locale) {
  const place = [setlist.venue, setlist.city].filter(Boolean).join(', ');
  return `${setlist.artist} – ${place} (${formatDate(setlist.date, locale)})`.slice(0, 250);
}

// ---------------------------------------------------------------------------
// Modo "Prepárate para la gira": canciones más tocadas en los últimos conciertos.

/**
 * Elige los conciertos recientes con canciones; si el más reciente pertenece a
 * una gira, se limita a los conciertos de esa gira.
 */
export function pickTourSetlists(setlists, max = 10) {
  const withSongs = setlists.filter(hasSongs).sort((a, b) => b.date.localeCompare(a.date));
  if (!withSongs.length) return { tourName: '', setlists: [] };
  const tourName = withSongs[0].tour;
  const pool = tourName ? withSongs.filter((s) => s.tour === tourName) : withSongs;
  return { tourName, setlists: pool.slice(0, max) };
}

/**
 * Agrega varios setlists: devuelve las canciones tocadas en al menos `minShare`
 * de los conciertos, ordenadas por su posición media en el concierto.
 */
export function aggregateTour(setlists, { minShare = 0.5 } = {}) {
  const stats = new Map();
  for (const setlist of setlists) {
    const songs = setlist.sets.flatMap((set) =>
      set.songs.filter((s) => !s.tape && !isSnippet(s.info)).map((s) => ({ ...s, encore: set.encore })),
    );
    const seenInShow = new Set();
    songs.forEach((song, index) => {
      const key = `${normalize(song.name)}|${normalize(song.cover ?? '')}`;
      const position = songs.length > 1 ? index / (songs.length - 1) : 0;
      const stat = stats.get(key) ?? { song, shows: 0, positions: [], encores: 0 };
      if (!seenInShow.has(key)) {
        stat.shows += 1;
        stat.positions.push(position);
        if (song.encore) stat.encores += 1;
        seenInShow.add(key);
      }
      stats.set(key, stat);
    });
  }

  const total = setlists.length || 1;
  const artist = setlists[0]?.artist ?? '';
  return [...stats.values()]
    .map((stat) => ({
      ...stat,
      share: stat.shows / total,
      avgPosition: stat.positions.reduce((a, b) => a + b, 0) / stat.positions.length,
    }))
    .filter((stat) => stat.share >= minShare)
    .sort((a, b) => a.avgPosition - b.avgPosition)
    .flatMap((stat) =>
      splitMedley(stat.song.name).map((title) => ({
        title,
        performer: artist,
        originalArtist: stat.song.cover,
        isTape: false,
        isSnippet: false,
        isEncore: stat.encores > stat.shows / 2,
        medleyOf: splitMedley(stat.song.name).length > 1 ? stat.song.name : null,
        guest: null,
        info: '',
        frequency: stat.share,
      })),
    )
    .map((entry, index) => ({ ...entry, key: `t${index}` }));
}
