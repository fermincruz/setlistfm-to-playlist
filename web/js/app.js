// Interfaz de la web: estado, renderizado y acciones del usuario.
import { createAuth } from './api/auth.js';
import { createSetlistClient } from './api/setlistfm.js';
import { createTidalClient } from './api/tidal.js';
import { choiceKey, pickArtist, resolveEntry } from './core/matcher.js';
import {
  aggregateTour,
  buildEntries,
  defaultPlaylistName,
  extractSetlistId,
  findSetlistUrl,
  formatDate,
  hasSongs,
  pickTourSetlists,
} from './core/setlist.js';
import { formatDuration, normalize } from './core/text.js';
import { APP_VERSION, describeError, diag } from './diagnostics.js';
import { createTranslator, detectLanguage } from './i18n.js';
import { createChoiceMemory, local, session } from './storage.js';

const config = globalThis.APP_CONFIG ?? {};
const appUrl = config.redirectUri || `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
const SEARCH_CONCURRENCY = 3;
const TOUR_MAX_SHOWS = 10;
const DEFAULT_PREFS = { preferLive: false, includeSnippets: false, includeTapes: false, rememberChoices: true };
const OK_STATUSES = new Set(['auto', 'remembered', 'manual']);

let t = createTranslator(detectLanguage(local.get('lang'), navigator.languages ?? []));
let setlistApi = createSetlistClient({ baseUrl: config.setlistProxyUrl, lang: t.lang });
const auth = createAuth({ clientId: config.tidalClientId, redirectUri: appUrl, localStore: local, sessionStore: session });
const tidal = createTidalClient({ getToken: (options) => auth.getAccessToken(options), log: (m) => diag.log(m) });
const memory = createChoiceMemory(local);
const searchCache = new Map();

const state = {
  view: 'source', // source | review | done
  tab: 'artist', // artist | url
  artistQuery: '',
  artists: null,
  artistsLoading: false,
  artist: null,
  concerts: [],
  concertsPage: 0,
  concertsHasMore: false,
  concertsLoading: false,
  urlInput: '',
  urlError: false,
  loading: false,
  source: null, // { kind: 'concert', setlist } | { kind: 'tour', artist, tourName, setlists, minShare }
  entries: [],
  res: {},
  prefs: { ...DEFAULT_PREFS, ...local.get('prefs', {}) },
  onlyAttention: false,
  resolving: false,
  progress: { done: 0, total: 0 },
  playlist: { name: '', description: '', accessType: 'UNLISTED' },
  creating: null,
  result: null,
  copied: false,
  user: local.get('tidal:user'),
  connected: auth.isConnected(),
  error: null,
};

const root = document.getElementById('app');

// ---------------------------------------------------------------------------
// Utilidades

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const pct = (share) => Math.round(share * 100);

function savePrefs() {
  local.set('prefs', state.prefs);
}

function showError(error) {
  console.error(error);
  state.error = error;
  if (['tidal_session_expired', 'tidal_not_connected', 'tidal_unauthorized'].includes(error?.code)) {
    auth.disconnect();
    state.connected = false;
    state.user = null;
    local.remove('tidal:user');
  }
  render();
}

function countryCode() {
  return state.user?.country || 'US';
}

// ---------------------------------------------------------------------------
// Renderizado

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  // requestAnimationFrame no se ejecuta con la pestaña en segundo plano: el
  // setTimeout garantiza que la pantalla se actualiza igualmente.
  requestAnimationFrame(flushRender);
  setTimeout(flushRender, 100);
}

function flushRender() {
  if (!renderQueued) return;
  renderQueued = false;
  // Se conserva el foco y la posición del cursor del campo que se está editando.
  const active = document.activeElement;
  const focusId = active && root.contains(active) ? active.id : '';
  const selection = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  root.innerHTML = viewApp();
  if (!focusId) return;
  const element = document.getElementById(focusId);
  if (!element) return;
  element.focus({ preventScroll: true });
  if (selection) {
    try {
      element.setSelectionRange(...selection);
    } catch {
      /* algunos tipos de input no admiten selección */
    }
  }
}

function viewApp() {
  return `
    ${viewHeader()}
    <main class="container">
      ${viewConfigWarnings()}
      ${state.error ? viewError() : ''}
      ${state.view === 'source' ? viewSource() : ''}
      ${state.view === 'review' ? viewReview() : ''}
      ${state.view === 'done' ? viewDone() : ''}
      ${diag.enabled ? viewDiagnostics() : ''}
    </main>
    <footer class="container footer">
      ${esc(t('footerData'))} <a href="https://www.setlist.fm/" target="_blank" rel="noopener">setlist.fm</a>.
      ${esc(t('footerDisclaimer'))} <span class="version">v${esc(APP_VERSION)}</span>
    </footer>`;
}

function viewDiagnostics() {
  return `
    <section class="card" aria-labelledby="diag-title">
      <h2 id="diag-title" class="step-subtitle">${esc(t('diagTitle'))}</h2>
      <p class="help">${esc(t('diagHelp'))}</p>
      <textarea id="diag-text" class="diag" readonly rows="14">${esc(diag.text())}</textarea>
      <div class="button-row">
        <button class="btn" data-action="copy-diag">${esc(state.diagCopied ? t('doneCopied') : t('diagCopy'))}</button>
        <button class="btn btn-ghost" data-action="disable-diag">${esc(t('diagDisable'))}</button>
      </div>
    </section>`;
}

function viewHeader() {
  let account = '';
  if (auth.isConfigured) {
    account = state.connected
      ? `<span class="account-name">${esc(state.user?.username ? t('tidalConnectedAs', { name: state.user.username }) : t('tidalConnected'))}</span>
         <button class="btn btn-small btn-ghost" data-action="disconnect">${esc(t('tidalDisconnect'))}</button>`
      : `<button class="btn btn-small" data-action="connect">${esc(t('tidalConnect'))}</button>`;
  }
  return `
    <header class="topbar">
      <div class="container topbar-inner">
        <a class="brand" href="${esc(appUrl)}" data-action="home">
          <img src="icons/icon.svg" alt="" width="32" height="32">
          <span>${esc(t('appTitle'))}</span>
        </a>
        <div class="topbar-actions">
          ${account}
          <button class="btn btn-small btn-ghost" data-action="toggle-lang" lang="${esc(t('languageCode'))}">${esc(t('language'))}</button>
        </div>
      </div>
    </header>`;
}

function viewConfigWarnings() {
  const warnings = [];
  if (!config.setlistProxyUrl) warnings.push(t('proxyNotConfigured'));
  if (!auth.isConfigured) warnings.push(t('tidalNotConfigured'));
  return warnings.map((w) => `<div class="notice notice-warn" role="alert">${esc(w)}</div>`).join('');
}

function viewError() {
  return `
    <div class="notice notice-error" role="alert">
      <span>${esc(t.error(state.error))}</span>
      <button class="btn btn-small btn-ghost" data-action="dismiss-error" aria-label="${esc(t('close'))}">✕</button>
    </div>`;
}

// --- Paso 1: elegir concierto ----------------------------------------------

function viewSource() {
  return `
    <p class="tagline">${esc(t('tagline'))}</p>
    <section class="card" aria-labelledby="step1">
      <h1 id="step1" class="step-title">${esc(t('step1'))}</h1>
      <div class="tabs" role="tablist">
        ${['artist', 'url']
          .map(
            (tab) => `<button role="tab" class="tab" aria-selected="${state.tab === tab}" data-action="tab" data-tab="${tab}">
              ${esc(t(tab === 'artist' ? 'tabArtist' : 'tabUrl'))}</button>`,
          )
          .join('')}
      </div>
      ${state.tab === 'artist' ? viewArtistTab() : viewUrlTab()}
    </section>`;
}

function viewUrlTab() {
  return `
    <form data-form="url" class="stack">
      <label for="url-input">${esc(t('urlLabel'))}</label>
      <input id="url-input" type="url" inputmode="url" autocomplete="off" placeholder="${esc(t('urlPlaceholder'))}"
        value="${esc(state.urlInput)}" ${state.urlError ? 'aria-invalid="true" aria-describedby="url-error"' : ''}>
      ${state.urlError ? `<p id="url-error" class="field-error">${esc(t('urlInvalid'))}</p>` : ''}
      <p class="help">${esc(t('urlHelp'))}</p>
      <button class="btn btn-primary" type="submit" ${state.loading ? 'disabled' : ''}>
        ${esc(state.loading ? t('searching') : t('load'))}</button>
    </form>`;
}

function viewArtistTab() {
  if (state.artist) return viewConcerts();
  let results = '';
  if (state.artistsLoading) results = `<p class="muted" aria-live="polite">${esc(t('searching'))}</p>`;
  else if (state.artists && !state.artists.length) results = `<p class="muted">${esc(t('noArtists'))}</p>`;
  else if (state.artists) {
    results = `<ul class="choice-list">${state.artists
      .map(
        (a, i) => `<li><button class="choice" data-action="pick-artist" data-index="${i}">
          <strong>${esc(a.name)}</strong>${a.disambiguation ? ` <span class="muted">· ${esc(a.disambiguation)}</span>` : ''}
        </button></li>`,
      )
      .join('')}</ul>`;
  }
  return `
    <form data-form="artist" class="stack" role="search">
      <label for="artist-q">${esc(t('artistLabel'))}</label>
      <div class="input-row">
        <input id="artist-q" type="search" autocomplete="off" placeholder="${esc(t('artistPlaceholder'))}" value="${esc(state.artistQuery)}">
        <button class="btn btn-primary" type="submit">${esc(t('search'))}</button>
      </div>
    </form>
    ${results}`;
}

function viewConcerts() {
  const latestIndex = state.concerts.findIndex(hasSongs);
  const tour = pickTourSetlists(state.concerts, TOUR_MAX_SHOWS);
  const tourCard =
    tour.setlists.length >= 2
      ? `<div class="tour-card">
          <h3>🎟️ ${esc(t('tourCardTitle'))}</h3>
          <p>${esc(tour.tourName ? t('tourCardText', { tour: `«${tour.tourName}»` }) : t('tourCardTextNoTour'))}</p>
          <button class="btn" data-action="pick-tour" ${state.loading ? 'disabled' : ''}>${esc(t('tourCardButton'))}</button>
        </div>`
      : '';
  const items = state.concerts
    .map((s, i) => {
      const place = [s.venue, s.city, s.country].filter(Boolean).join(', ');
      const disabled = !hasSongs(s);
      return `<li><button class="choice concert" data-action="pick-concert" data-index="${i}" ${disabled ? 'disabled' : ''}>
          <span class="concert-date">${esc(formatDate(s.date, t.locale))}</span>
          <span class="concert-place">${esc(place)}</span>
          <span class="concert-meta">
            ${s.tour ? `<span>${esc(s.tour)}</span>` : ''}
            <span>${esc(disabled ? t('noSongsYet') : t('songsCount', { n: s.songCount }))}</span>
            ${i === latestIndex ? `<span class="chip chip-auto">${esc(t('latest'))}</span>` : ''}
          </span>
        </button></li>`;
    })
    .join('');
  return `
    <div class="section-head">
      <h2>${esc(t('concertsOf', { artist: state.artist.name }))}</h2>
      <button class="btn btn-small btn-ghost" data-action="change-artist">${esc(t('changeArtist'))}</button>
    </div>
    ${tourCard}
    ${state.concerts.length ? `<ul class="choice-list">${items}</ul>` : ''}
    ${!state.concertsLoading && !state.concerts.some(hasSongs) && !state.concertsHasMore ? `<p class="muted">${esc(t('noConcerts'))}</p>` : ''}
    ${state.concertsLoading ? `<p class="muted" aria-live="polite">${esc(t('searching'))}</p>` : ''}
    ${state.concertsHasMore && !state.concertsLoading ? `<button class="btn btn-ghost" data-action="more-concerts">${esc(t('loadMore'))}</button>` : ''}`;
}

// --- Paso 2 y 3: revisar y crear ------------------------------------------

function sourceHeader() {
  const { source } = state;
  if (source.kind === 'tour') {
    return `
      <h1 class="step-title">${esc(source.tourName ? t('tourMode', { tour: source.tourName }) : t('tourModeNoTour'))}</h1>
      <p class="source-meta"><strong>${esc(source.artist)}</strong> · ${esc(t('tourBasedOn', { n: source.setlists.length }))}</p>
      <label class="range">
        <span>${esc(t('tourMinShare', { pct: pct(source.minShare) }))}</span>
        <input id="min-share" type="range" min="10" max="90" step="10" value="${pct(source.minShare)}">
      </label>`;
  }
  const s = source.setlist;
  const place = [s.venue, s.city, s.country].filter(Boolean).join(', ');
  return `
    <h1 class="step-title">${esc(s.artist)}</h1>
    <p class="source-meta">${esc(place)} · ${esc(formatDate(s.date, t.locale))}${s.tour ? ` · ${esc(s.tour)}` : ''}
      ${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">setlist.fm ↗</a>` : ''}</p>`;
}

function viewReview() {
  const included = state.entries.filter(isIncluded);
  const counts = { ok: 0, review: 0, missing: 0 };
  included.forEach((entry) => {
    const status = state.res[entry.key]?.status;
    if (OK_STATUSES.has(status)) counts.ok += 1;
    else if (status === 'review') counts.review += 1;
    else if (status === 'notfound' || status === 'error') counts.missing += 1;
  });
  const visible = state.onlyAttention
    ? state.entries.filter((e) => isIncluded(e) && ['review', 'notfound', 'error'].includes(state.res[e.key]?.status))
    : state.entries;

  const connectPanel = !state.connected
    ? `<div class="notice notice-info">
        <p>${esc(t('connectExplain'))}</p>
        <button class="btn btn-primary" data-action="connect" ${auth.isConfigured ? '' : 'disabled'}>${esc(t('tidalConnect'))}</button>
      </div>`
    : '';

  return `
    <button class="btn btn-small btn-ghost back" data-action="back">← ${esc(t('back'))}</button>
    <section class="card" aria-labelledby="step2">
      ${sourceHeader()}
      <h2 id="step2" class="step-subtitle">${esc(t('step2'))}</h2>
      ${connectPanel}
      ${viewPrefs()}
      <div class="progress-area" aria-live="polite">
        ${state.resolving ? `<p>${esc(t('progress', state.progress))}</p>
          <progress max="${state.progress.total}" value="${state.progress.done}"></progress>` : ''}
        ${state.connected && !state.resolving ? `<p class="summary">${esc(t('summary', counts))}</p>` : ''}
      </div>
      ${state.connected ? `<label class="check"><input type="checkbox" id="only-attention" ${state.onlyAttention ? 'checked' : ''}> ${esc(t('onlyAttention'))}</label>` : ''}
      <ol class="songs">${visible.map(viewEntry).join('')}</ol>
    </section>
    ${state.connected ? viewCreate(counts) : ''}`;
}

function viewPrefs() {
  const toggle = (key) => `<label class="check"><input type="checkbox" id="pref-${key}" data-pref="${key}" ${state.prefs[key] ? 'checked' : ''}> ${esc(t(key))}</label>`;
  const saved = memory.count();
  return `
    <details class="prefs">
      <summary>${esc(t('prefsTitle'))}</summary>
      <div class="stack">
        ${toggle('preferLive')}
        ${toggle('includeSnippets')}
        ${toggle('includeTapes')}
        ${toggle('rememberChoices')}
        ${saved ? `<button class="btn btn-small btn-ghost" data-action="forget-choices">${esc(t('forgetChoices', { n: saved }))}</button>` : ''}
      </div>
    </details>`;
}

const STATUS_LABEL = {
  pending: 'statusPending',
  searching: 'statusSearching',
  auto: 'statusAuto',
  review: 'statusReview',
  notfound: 'statusNotfound',
  remembered: 'statusRemembered',
  manual: 'statusManual',
  error: 'statusError',
};

function trackLine(track) {
  if (!track) return '';
  const version = track.version ? ` <span class="muted">(${esc(track.version)})</span>` : '';
  const meta = [track.artist, track.album, formatDuration(track.duration)].filter(Boolean).map(esc).join(' · ');
  return `<span class="track-title">${esc(track.title)}</span>${version} <span class="muted">— ${meta}</span>`;
}

function viewEntry(entry) {
  const res = state.res[entry.key] ?? { status: 'pending' };
  const included = isIncluded(entry);
  const status = included ? res.status : 'excluded';
  const badges = [
    entry.originalArtist ? t('badgeCover', { artist: entry.originalArtist }) : '',
    entry.medleyOf ? t('badgeMedley') : '',
    entry.isEncore ? t('badgeEncore') : '',
    entry.isSnippet ? t('badgeSnippet') : '',
    entry.isTape ? t('badgeTape') : '',
    entry.guest ? t('badgeGuest', { name: entry.guest }) : '',
    entry.frequency != null ? t('badgeFrequency', { pct: pct(entry.frequency) }) : '',
  ]
    .filter(Boolean)
    .map((b) => `<span class="badge">${esc(b)}</span>`)
    .join('');

  const selected = selectedTrack(res);
  let detail = '';
  if (included && selected) detail = trackLine(selected);
  else if (included && res.status === 'notfound') detail = `<span class="muted">${esc(t('noCandidates'))}</span>`;
  else if (included && res.status === 'error') detail = `<span class="muted">${esc(t.error(res.error))}</span>`;

  const label = status === 'excluded' ? t('statusExcluded') : t(STATUS_LABEL[res.status] ?? 'statusPending');
  const canChange = state.connected && included && !['pending', 'searching'].includes(res.status);
  const actions = [
    canChange ? `<button class="btn btn-small btn-ghost" data-action="expand" data-key="${entry.key}" aria-expanded="${Boolean(res.expanded)}">${esc(res.expanded ? t('close') : t('change'))}</button>` : '',
    selected && included ? `<a class="btn btn-small btn-ghost" href="${esc(selected.url)}" target="_blank" rel="noopener">${esc(t('openInTidal'))} ↗</a>` : '',
    res.status === 'error' && included ? `<button class="btn btn-small btn-ghost" data-action="retry" data-key="${entry.key}">${esc(t('retry'))}</button>` : '',
    `<button class="btn btn-small btn-ghost" data-action="${included ? 'exclude' : 'include'}" data-key="${entry.key}">${esc(included ? t('exclude') : t('include'))}</button>`,
  ].join('');

  return `
    <li class="song status-${status}">
      <div class="song-main">
        <div class="song-body">
          <div class="song-title">${esc(entry.title)} ${badges}</div>
          ${detail ? `<div class="song-match">${detail}</div>` : ''}
        </div>
        <span class="chip chip-${status}">${esc(label)}</span>
      </div>
      <div class="song-actions">${actions}</div>
      ${res.expanded && canChange ? viewChooser(entry, res) : ''}
    </li>`;
}

function viewChooser(entry, res) {
  const options = [...(res.candidates ?? []), ...(res.manualResults ?? [])];
  const seen = new Set();
  const unique = options.filter((track) => !seen.has(track.id) && seen.add(track.id));
  const list = unique.length
    ? `<p class="muted">${esc(t('chooseVersion'))}</p>
       <ul class="candidates">${unique
         .map(
           (track) => `<li><label class="candidate">
             <input type="radio" name="pick-${entry.key}" data-action="choose" data-key="${entry.key}" data-id="${esc(track.id)}" ${track.id === res.selectedId ? 'checked' : ''}>
             <span>${trackLine(track)}</span></label></li>`,
         )
         .join('')}</ul>`
    : `<p class="muted">${esc(t('noCandidates'))}</p>`;
  return `
    <div class="chooser">
      ${res.loadingCandidates ? `<p class="muted">${esc(t('searching'))}</p>` : list}
      <form class="input-row" data-form="manual" data-key="${entry.key}">
        <label class="visually-hidden" for="manual-${entry.key}">${esc(t('manualSearch'))}</label>
        <input id="manual-${entry.key}" type="search" placeholder="${esc(t('manualPlaceholder'))}" value="${esc(res.manualQuery ?? `${entry.originalArtist ?? entry.performer} ${entry.title}`)}">
        <button class="btn btn-small" type="submit">${esc(t('search'))}</button>
      </form>
    </div>`;
}

function viewCreate(counts) {
  const ids = selectedTrackIds();
  const creating = state.creating;
  return `
    <section class="card" aria-labelledby="step3">
      <h2 id="step3" class="step-subtitle">${esc(t('step3'))}</h2>
      <form data-form="create" class="stack">
        <label for="pl-name">${esc(t('playlistName'))}</label>
        <input id="pl-name" type="text" maxlength="250" required value="${esc(state.playlist.name)}">
        <label for="pl-desc">${esc(t('playlistDescription'))}</label>
        <textarea id="pl-desc" maxlength="500" rows="3">${esc(state.playlist.description)}</textarea>
        <label for="pl-access">${esc(t('visibility'))}</label>
        <select id="pl-access">
          <option value="UNLISTED" ${state.playlist.accessType === 'UNLISTED' ? 'selected' : ''}>${esc(t('visibilityUnlisted'))}</option>
          <option value="PUBLIC" ${state.playlist.accessType === 'PUBLIC' ? 'selected' : ''}>${esc(t('visibilityPublic'))}</option>
        </select>
        ${counts.review && !state.resolving ? `<p class="help">${esc(t('pendingReview', { n: counts.review }))}</p>` : ''}
        ${!ids.length && !state.resolving ? `<p class="help">${esc(t('nothingToCreate'))}</p>` : ''}
        <div aria-live="polite">
          ${creating ? `<p>${esc(t('creating', creating))}</p><progress max="${creating.total}" value="${creating.done}"></progress>` : ''}
        </div>
        <button class="btn btn-primary btn-large" type="submit" ${!ids.length || state.resolving || creating ? 'disabled' : ''}>
          ${esc(t('createButton', { n: ids.length }))}</button>
      </form>
    </section>`;
}

function viewDone() {
  const r = state.result;
  return `
    <section class="card done" aria-labelledby="done-title">
      <h1 id="done-title" class="step-title">🎉 ${esc(t('doneTitle'))}</h1>
      <p>${esc(t('doneText', { n: r.added, name: r.name }))}</p>
      <div class="button-row">
        <a class="btn btn-primary btn-large" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(t('doneOpen'))} ↗</a>
        <button class="btn" data-action="copy-link">${esc(state.copied ? t('doneCopied') : t('doneCopy'))}</button>
      </div>
      ${r.missing.length
        ? `<h2 class="step-subtitle">${esc(t('doneMissing'))}</h2>
           <ul class="missing">${r.missing
             .map(
               (m) => `<li>${esc(m.title)} <a href="https://listen.tidal.com/search?q=${encodeURIComponent(`${m.artist} ${m.title}`)}" target="_blank" rel="noopener">${esc(t('doneSearchTidal'))} ↗</a></li>`,
             )
             .join('')}</ul>`
        : ''}
      <button class="btn btn-ghost" data-action="home">${esc(t('doneAgain'))}</button>
    </section>`;
}

// ---------------------------------------------------------------------------
// Lógica de entradas y resoluciones

function defaultExcluded(entry) {
  return (entry.isTape && !state.prefs.includeTapes) || (entry.isSnippet && !state.prefs.includeSnippets);
}

function isIncluded(entry) {
  const res = state.res[entry.key];
  return !(res?.userExcluded ?? defaultExcluded(entry));
}

function selectedTrack(res) {
  if (!res?.selectedId) return null;
  return [...(res.candidates ?? []), ...(res.manualResults ?? [])].find((track) => track.id === res.selectedId) ?? null;
}

function selectedTrackIds() {
  return state.entries
    .filter(isIncluded)
    .map((entry) => selectedTrack(state.res[entry.key])?.id)
    .filter(Boolean);
}

async function cachedSearch(query) {
  const key = `${countryCode()}|${normalize(query)}`;
  if (!searchCache.has(key)) {
    searchCache.set(
      key,
      tidal.searchTracks(query, countryCode()).then(
        (tracks) => {
          diag.log(`Búsqueda "${query}": ${tracks.length} resultados: ${tracks.slice(0, 8).map((t) => `${t.artist} – ${t.title}`).join(' | ')}`);
          return tracks;
        },
        (error) => {
          diag.log(`Búsqueda "${query}" falló: ${describeError(error)}`);
          searchCache.delete(key);
          throw error;
        },
      ),
    );
  }
  return searchCache.get(key);
}

const catalogCache = new Map();

/** Errores que impiden seguir (sesión caducada, permisos...) frente a fallos puntuales. */
function isFatal(error) {
  return String(error?.code).startsWith('tidal_') && error.code !== 'tidal_error';
}

/**
 * Catálogo de pistas del artista en TIDAL, descargado una sola vez por
 * artista y país. Si falla por un motivo puntual se sigue solo con la búsqueda.
 */
function artistCatalog(name) {
  const key = `${countryCode()}|${normalize(name)}`;
  if (!catalogCache.has(key)) {
    const load = (async () => {
      const artists = await tidal.searchArtists(name, countryCode());
      diag.log(`Artistas para "${name}" (país ${countryCode()}): ${artists.slice(0, 8).map((a) => `${a.name} [${a.id}]`).join(' | ') || '(ninguno)'}`);
      const artist = pickArtist(name, artists);
      diag.log(`Artista elegido: ${artist ? `${artist.name} [${artist.id}]` : '(ninguno: no se usa catálogo)'}`);
      const tracks = artist ? await tidal.artistTracks(artist.id, countryCode()) : [];
      diag.log(`Catálogo: ${tracks.length} pistas: ${tracks.map((t) => t.title).join(' | ')}`);
      return tracks;
    })().catch((error) => {
      diag.log(`Error cargando catálogo: ${describeError(error)}`);
      if (isFatal(error)) {
        catalogCache.delete(key);
        throw error;
      }
      return [];
    });
    catalogCache.set(key, load);
  }
  return catalogCache.get(key);
}

function snapshot(track) {
  const { score, ...rest } = track;
  return rest;
}

async function resolveOne(entry) {
  // Se escribe siempre en el mapa vigente al empezar: si el usuario cambia de
  // concierto o de opciones mientras tanto, el resultado antiguo se descarta.
  const resMap = state.res;
  const previous = resMap[entry.key] ?? {};
  const remembered = state.prefs.rememberChoices ? memory.get(choiceKey(entry)) : null;
  if (remembered) {
    resMap[entry.key] = { ...previous, status: 'remembered', selectedId: remembered.track.id, candidates: [remembered.track] };
    return;
  }
  resMap[entry.key] = { ...previous, status: 'searching' };
  render();
  try {
    const catalog = await artistCatalog(entry.performer);
    const result = await resolveEntry(entry, cachedSearch, state.prefs, catalog);
    const chosen = result.candidates.find((c) => c.id === result.selectedId);
    diag.log(`→ "${entry.title}": ${result.status}${chosen ? ` = ${chosen.artist} – ${chosen.title} [${chosen.id}]` : ''}`);
    if (result.status !== 'auto') {
      diag.log(`   candidatos: ${result.candidates.map((c) => `${c.artist} – ${c.title}${c.version ? ` (${c.version})` : ''}`).join(' | ') || '(ninguno)'}`);
    }
    resMap[entry.key] = { ...resMap[entry.key], ...result, searched: true, error: null };
  } catch (error) {
    diag.log(`→ "${entry.title}": error ${describeError(error)}`);
    resMap[entry.key] = { ...resMap[entry.key], status: 'error', error };
    if (isFatal(error)) throw error;
  }
}

let resolveGeneration = 0;
let resolveActive = false;
let resolveAgain = false;

function pendingEntries() {
  return state.entries.filter((e) => isIncluded(e) && (state.res[e.key]?.status ?? 'pending') === 'pending');
}

/** Busca en TIDAL todas las entradas pendientes (de tres en tres). */
async function resolveAll() {
  if (!state.connected || state.view !== 'review') return;
  if (resolveActive) {
    resolveAgain = true;
    return;
  }
  resolveActive = true;
  const generation = resolveGeneration;
  try {
    do {
      resolveAgain = false;
      const queue = pendingEntries();
      if (!queue.length) break;
      state.resolving = true;
      state.progress = { done: 0, total: queue.length };
      render();

      let fatal = null;
      const worker = async () => {
        while (queue.length && !fatal && generation === resolveGeneration) {
          const entry = queue.shift();
          try {
            await resolveOne(entry);
          } catch (error) {
            fatal = error;
          }
          state.progress.done += 1;
          render();
        }
      };
      await Promise.all(Array.from({ length: SEARCH_CONCURRENCY }, worker));
      if (fatal) {
        showError(fatal);
        break;
      }
    } while (resolveAgain && generation === resolveGeneration);
  } finally {
    resolveActive = false;
    state.resolving = false;
    render();
    // Si se canceló esta tanda o llegó trabajo nuevo, se lanza otra.
    if (generation !== resolveGeneration || resolveAgain) resolveAll();
  }
}

function cancelResolving() {
  resolveGeneration += 1;
  state.resolving = false;
}

/** Vuelve a calcular las entradas que no eligió el usuario (p. ej. al cambiar preferencias). */
function resetAutomaticResolutions() {
  cancelResolving();
  state.res = Object.fromEntries(
    Object.entries(state.res).map(([key, res]) => [
      key,
      res.status === 'manual' ? res : { userExcluded: res.userExcluded, status: 'pending' },
    ]),
  );
}

function tourEntries(source) {
  const seen = new Map();
  return aggregateTour(source.setlists, { minShare: source.minShare }).map((entry) => {
    const base = `t:${normalize(entry.title)}|${normalize(entry.originalArtist ?? '')}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...entry, key: n ? `${base}#${n}` : base };
  });
}

function startReview(source) {
  cancelResolving();
  state.source = source;
  state.res = {};
  state.onlyAttention = false;
  state.result = null;
  state.error = null;
  if (source.kind === 'tour') {
    state.entries = tourEntries(source);
    const tourPart = source.tourName ? ` (${source.tourName})` : '';
    state.playlist = {
      ...state.playlist,
      name: (source.tourName
        ? t('tourPlaylistName', { artist: source.artist, tour: source.tourName })
        : t('tourPlaylistNameNoTour', { artist: source.artist })).slice(0, 250),
      description: t('tourDescription', { artist: source.artist, n: source.setlists.length, tourPart }).slice(0, 500),
    };
  } else {
    const s = source.setlist;
    state.entries = buildEntries(s);
    state.playlist = {
      ...state.playlist,
      name: defaultPlaylistName(s, t.locale),
      description: t('description', {
        artist: s.artist,
        place: [s.venue, s.city].filter(Boolean).join(', '),
        date: formatDate(s.date, t.locale),
        url: s.url,
      }).slice(0, 500),
    };
  }
  state.view = 'review';
  window.scrollTo({ top: 0 });
  render();
  resolveAll();
}

// ---------------------------------------------------------------------------
// Acciones

async function searchArtists(query) {
  const q = query.trim();
  if (q.length < 2) return;
  state.artistsLoading = true;
  render();
  try {
    const results = await setlistApi.searchArtists(q);
    if (state.artistQuery.trim() === q) state.artists = results;
  } catch (error) {
    showError(error);
  } finally {
    state.artistsLoading = false;
    render();
  }
}

async function loadConcerts(page) {
  state.concertsLoading = true;
  render();
  try {
    const result = await setlistApi.artistSetlists(state.artist.mbid, page);
    state.concerts = page === 1 ? result.setlists : [...state.concerts, ...result.setlists];
    state.concertsPage = page;
    state.concertsHasMore = result.hasMore;
    // Si la primera página solo trae conciertos futuros o vacíos, se carga otra.
    if (page < 5 && result.hasMore && !state.concerts.some(hasSongs)) {
      state.concertsLoading = false;
      return loadConcerts(page + 1);
    }
  } catch (error) {
    showError(error);
  } finally {
    state.concertsLoading = false;
    render();
  }
}

async function loadSetlistById(id) {
  state.loading = true;
  state.error = null;
  render();
  try {
    const setlist = await setlistApi.setlist(id);
    startReview({ kind: 'concert', setlist });
  } catch (error) {
    showError(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function pickTour() {
  state.loading = true;
  render();
  try {
    let tour = pickTourSetlists(state.concerts, TOUR_MAX_SHOWS);
    // Para tener suficientes conciertos de la gira se carga otra página si hace falta.
    if (tour.tourName && tour.setlists.length < TOUR_MAX_SHOWS && state.concertsHasMore && state.concertsPage < 3) {
      const result = await setlistApi.artistSetlists(state.artist.mbid, state.concertsPage + 1);
      state.concerts = [...state.concerts, ...result.setlists];
      state.concertsPage += 1;
      state.concertsHasMore = result.hasMore;
      tour = pickTourSetlists(state.concerts, TOUR_MAX_SHOWS);
    }
    startReview({ kind: 'tour', artist: state.artist.name, tourName: tour.tourName, setlists: tour.setlists, minShare: 0.5 });
  } catch (error) {
    showError(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function connect() {
  try {
    const resume = state.view === 'review' && state.source ? { source: state.source, playlist: state.playlist } : null;
    location.assign(await auth.authorizationUrl(resume));
  } catch (error) {
    showError(error);
  }
}

async function loadUser() {
  try {
    const user = await tidal.me();
    state.user = user;
    local.set('tidal:user', user);
    render();
  } catch (error) {
    if (error.code !== 'network') showError(error);
  }
}

async function expand(entry) {
  const res = state.res[entry.key];
  res.expanded = !res.expanded;
  render();
  // Una elección recordada solo guarda una pista: se buscan alternativas al abrir.
  if (res.expanded && !res.searched) {
    res.loadingCandidates = true;
    render();
    try {
      const result = await resolveEntry(entry, cachedSearch, state.prefs, await artistCatalog(entry.performer));
      const current = selectedTrack(res);
      const candidates = result.candidates.some((c) => c.id === current?.id) || !current ? result.candidates : [current, ...result.candidates];
      Object.assign(res, { candidates, searched: true });
    } catch (error) {
      showError(error);
    } finally {
      res.loadingCandidates = false;
      render();
    }
  }
}

async function manualSearch(entry, query) {
  const res = state.res[entry.key];
  res.manualQuery = query;
  if (!query.trim()) return;
  res.loadingCandidates = true;
  render();
  try {
    res.manualResults = await cachedSearch(query.trim());
  } catch (error) {
    showError(error);
  } finally {
    res.loadingCandidates = false;
    render();
  }
}

function choose(entry, id) {
  const res = state.res[entry.key];
  res.selectedId = id;
  res.status = 'manual';
  const track = selectedTrack(res);
  if (track && state.prefs.rememberChoices) memory.remember(choiceKey(entry), snapshot(track));
  render();
}

async function createPlaylist() {
  const ids = selectedTrackIds();
  if (!ids.length) return;
  state.creating = { done: 0, total: ids.length };
  state.error = null;
  render();
  try {
    const name = state.playlist.name.trim() || defaultName();
    const created = await tidal.createPlaylist(
      { name, description: state.playlist.description, accessType: state.playlist.accessType },
      ids,
      (done, total) => {
        state.creating = { done, total };
        render();
      },
    );
    const missing = state.entries
      .filter((e) => isIncluded(e) && !selectedTrack(state.res[e.key]))
      .map((e) => ({ title: e.title, artist: e.originalArtist ?? e.performer }));
    state.result = { ...created, name, added: ids.length, missing };
    state.view = 'done';
    state.copied = false;
    window.scrollTo({ top: 0 });
  } catch (error) {
    showError(error);
  } finally {
    state.creating = null;
    render();
  }
}

function defaultName() {
  return state.source?.kind === 'concert' ? defaultPlaylistName(state.source.setlist, t.locale) : 'Setlist';
}

function goHome() {
  cancelResolving();
  state.view = 'source';
  state.source = null;
  state.entries = [];
  state.res = {};
  state.result = null;
  state.error = null;
  render();
}

// ---------------------------------------------------------------------------
// Eventos

const entryByKey = (key) => state.entries.find((e) => e.key === key);

root.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || target.tagName === 'INPUT') return;
  const { action, key, index } = target.dataset;
  const entry = key ? entryByKey(key) : null;

  switch (action) {
    case 'home':
      event.preventDefault();
      goHome();
      break;
    case 'toggle-lang':
      t = createTranslator(t('languageCode'));
      local.set('lang', t.lang);
      document.documentElement.lang = t.lang;
      document.title = t('appTitle');
      setlistApi = createSetlistClient({ baseUrl: config.setlistProxyUrl, lang: t.lang });
      render();
      break;
    case 'connect':
      connect();
      break;
    case 'disconnect':
      auth.disconnect();
      local.remove('tidal:user');
      state.connected = false;
      state.user = null;
      render();
      break;
    case 'dismiss-error':
      state.error = null;
      render();
      break;
    case 'tab':
      state.tab = target.dataset.tab;
      render();
      break;
    case 'pick-artist':
      state.artist = state.artists[Number(index)];
      state.concerts = [];
      state.concertsHasMore = false;
      render();
      loadConcerts(1);
      break;
    case 'change-artist':
      state.artist = null;
      state.concerts = [];
      render();
      break;
    case 'more-concerts':
      loadConcerts(state.concertsPage + 1);
      break;
    case 'pick-concert':
      startReview({ kind: 'concert', setlist: state.concerts[Number(index)] });
      break;
    case 'pick-tour':
      pickTour();
      break;
    case 'back':
      cancelResolving();
      state.view = 'source';
      render();
      break;
    case 'forget-choices':
      memory.clear();
      render();
      break;
    case 'expand':
      if (entry) expand(entry);
      break;
    case 'retry':
      if (entry) {
        state.res[entry.key] = { ...state.res[entry.key], status: 'pending' };
        resolveAll();
      }
      break;
    case 'exclude':
    case 'include':
      if (entry) {
        const res = state.res[entry.key] ?? { status: 'pending' };
        state.res[entry.key] = { ...res, userExcluded: action === 'exclude', expanded: false };
        render();
        if (action === 'include') resolveAll();
      }
      break;
    case 'disable-diag':
      diag.disable();
      render();
      break;
    case 'copy-diag':
      navigator.clipboard?.writeText(diag.text()).then(() => {
        state.diagCopied = true;
        render();
      });
      break;
    case 'copy-link':
      navigator.clipboard?.writeText(state.result.url).then(() => {
        state.copied = true;
        render();
      });
      break;
    default:
      break;
  }
});

root.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset.action === 'choose') {
    const entry = entryByKey(target.dataset.key);
    if (entry) choose(entry, target.dataset.id);
    return;
  }
  if (target.dataset.pref) {
    const key = target.dataset.pref;
    state.prefs[key] = target.checked;
    savePrefs();
    if (key === 'preferLive' || key === 'rememberChoices') resetAutomaticResolutions();
    render();
    resolveAll();
    return;
  }
  if (target.id === 'only-attention') {
    state.onlyAttention = target.checked;
    render();
  } else if (target.id === 'pl-access') {
    state.playlist.accessType = target.value;
  } else if (target.id === 'min-share' && state.source?.kind === 'tour') {
    state.source.minShare = Number(target.value) / 100;
    state.entries = tourEntries(state.source);
    render();
    resolveAll();
  }
});

let artistTimer = null;
root.addEventListener('input', (event) => {
  const target = event.target;
  if (target.id === 'artist-q') {
    state.artistQuery = target.value;
    clearTimeout(artistTimer);
    // Se espera a que el usuario deje de escribir para no gastar cuota de setlist.fm.
    if (target.value.trim().length >= 3) artistTimer = setTimeout(() => searchArtists(target.value), 1000);
  } else if (target.id === 'url-input') {
    state.urlInput = target.value;
    state.urlError = false;
  } else if (target.id === 'pl-name') {
    state.playlist.name = target.value;
  } else if (target.id === 'pl-desc') {
    state.playlist.description = target.value;
  } else if (target.id === 'min-share' && state.source?.kind === 'tour') {
    // Actualiza la etiqueta mientras se arrastra; las canciones se recalculan en "change".
    target.previousElementSibling.textContent = t('tourMinShare', { pct: target.value });
  } else if (target.id.startsWith('manual-')) {
    const res = state.res[target.closest('form').dataset.key];
    if (res) res.manualQuery = target.value;
  }
});

root.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  switch (form.dataset.form) {
    case 'artist':
      clearTimeout(artistTimer);
      searchArtists(state.artistQuery);
      break;
    case 'url': {
      const id = extractSetlistId(state.urlInput);
      state.urlError = !id;
      if (id) loadSetlistById(id);
      else render();
      break;
    }
    case 'manual': {
      const entry = entryByKey(form.dataset.key);
      if (entry) manualSearch(entry, form.querySelector('input').value);
      break;
    }
    case 'create':
      createPlaylist();
      break;
    default:
      break;
  }
});

// ---------------------------------------------------------------------------
// Arranque

async function init() {
  document.documentElement.lang = t.lang;
  document.title = t('appTitle');
  const params = new URLSearchParams(location.search);

  try {
    const redirect = await auth.handleRedirect(location.href);
    if (redirect) {
      history.replaceState(null, '', location.pathname);
      state.connected = auth.isConnected();
      await loadUser();
      if (redirect.resume?.source) {
        state.playlist = redirect.resume.playlist ?? state.playlist;
        const { playlist } = state;
        startReview(redirect.resume.source);
        state.playlist = playlist;
      }
    }
  } catch (error) {
    history.replaceState(null, '', location.pathname);
    showError(error);
  }

  // Enlace compartido desde setlist.fm (Web Share Target) o ?setlist=...
  const shared = ['url', 'text', 'title', 'setlist'].map((name) => params.get(name) ?? '').join(' ');
  const sharedUrl = findSetlistUrl(shared);
  if (sharedUrl && state.view === 'source') {
    history.replaceState(null, '', location.pathname);
    state.tab = 'url';
    state.urlInput = sharedUrl;
    loadSetlistById(extractSetlistId(sharedUrl));
  }

  if (state.connected && !state.user?.country) loadUser();
  render();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
