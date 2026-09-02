"""Cliente para obtener y parsear setlists desde la API pública de setlist.fm."""

import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

SETLISTFM_API_BASE = "https://api.setlist.fm/rest/1.0"

# El límite gratuito de setlist.fm es de 2 peticiones/segundo; se deja margen para no chocar con él.
_MIN_REQUEST_INTERVAL = 0.6
_last_request_at = 0.0

# El ID del setlist es el código alfanumérico final de la URL, p.ej.:
# https://www.setlist.fm/setlist/artist/2023/some-venue-city-country-2bd6a1e3.html
_SETLIST_ID_RE = re.compile(r"-([a-fA-F0-9]+)\.html")


class SetlistNotFoundError(ValueError):
    """El setlist indicado no existe en setlist.fm."""


class InvalidApiKeyError(ValueError):
    """La API key de setlist.fm no es válida o no tiene permisos."""


class ArtistNotFoundError(ValueError):
    """No se han encontrado setlists para el artista indicado."""


class RateLimitError(ValueError):
    """Se ha alcanzado el límite de peticiones de la API de setlist.fm."""


@dataclass
class SetlistSong:
    name: str
    cover_artist: Optional[str] = None  # Nombre del artista original, si es una versión.
    is_tape: bool = False  # Sonido reproducido por megafonía (intro, outro...), no una interpretación real.


@dataclass
class SetlistInfo:
    artist: str
    venue: str
    city: str
    country: str
    event_date: str
    url: str
    songs: List[SetlistSong] = field(default_factory=list)

    @property
    def playlist_title(self) -> str:
        return f"{self.artist} - {self.venue} ({self.event_date})"


def extract_setlist_id(url: str) -> str:
    match = _SETLIST_ID_RE.search(url.strip())
    if not match:
        raise ValueError(f"No se ha podido extraer el ID del setlist de la URL: {url}")
    return match.group(1)


def _throttle() -> None:
    """Espera lo necesario para no superar el límite de 2 peticiones/segundo de setlist.fm."""
    global _last_request_at
    elapsed = time.monotonic() - _last_request_at
    if elapsed < _MIN_REQUEST_INTERVAL:
        time.sleep(_MIN_REQUEST_INTERVAL - elapsed)
    _last_request_at = time.monotonic()


def _get(
    url: str, headers: Dict[str, str], params: Optional[Dict[str, Any]] = None, max_retries: int = 3
) -> requests.Response:
    """GET con throttling y reintento ante 429, respetando la cabecera Retry-After."""
    response: Optional[requests.Response] = None
    for attempt in range(max_retries + 1):
        _throttle()
        response = requests.get(url, headers=headers, params=params, timeout=15)
        if response.status_code != 429:
            return response
        if attempt == max_retries:
            break
        retry_after = float(response.headers.get("Retry-After", 1))
        time.sleep(retry_after)
    assert response is not None
    return response


def _parse_setlist_json(data: Dict[str, Any], fallback_url: str) -> SetlistInfo:
    artist_name = (data.get("artist") or {}).get("name", "Desconocido")
    venue_data = data.get("venue") or {}
    venue_name = venue_data.get("name", "")
    city_data = venue_data.get("city") or {}
    city_name = city_data.get("name", "")
    country_name = (city_data.get("country") or {}).get("name", "")
    event_date = data.get("eventDate", "")

    songs: List[SetlistSong] = []
    sets = (data.get("sets") or {}).get("set") or []
    for set_block in sets:
        for song in set_block.get("song") or []:
            name = song.get("name")
            if not name:
                continue
            is_tape = bool(song.get("tape", False))
            cover_artist = (song.get("cover") or {}).get("name")
            songs.append(SetlistSong(name=name, cover_artist=cover_artist, is_tape=is_tape))

    return SetlistInfo(
        artist=artist_name,
        venue=venue_name,
        city=city_name,
        country=country_name,
        event_date=event_date,
        url=data.get("url") or fallback_url,
        songs=songs,
    )


def fetch_setlist(url: str, api_key: str) -> SetlistInfo:
    setlist_id = extract_setlist_id(url)
    headers = {
        "x-api-key": api_key,
        "Accept": "application/json",
    }

    response = _get(f"{SETLISTFM_API_BASE}/setlist/{setlist_id}", headers=headers)

    if response.status_code == 404:
        raise SetlistNotFoundError("No se ha encontrado el setlist indicado. Revisa la URL.")
    if response.status_code in (401, 403):
        raise InvalidApiKeyError("La API key de setlist.fm no es válida o no tiene permisos.")
    if response.status_code == 429:
        raise RateLimitError(
            "Se ha alcanzado el límite de peticiones de la API de setlist.fm. "
            "Espera unos segundos y vuelve a intentarlo."
        )
    response.raise_for_status()

    return _parse_setlist_json(response.json(), fallback_url=url)


def _event_date_sort_key(setlist_json: Dict[str, Any]) -> datetime:
    try:
        return datetime.strptime(setlist_json.get("eventDate", ""), "%d-%m-%Y")
    except (TypeError, ValueError):
        return datetime.min


def _has_songs(setlist_json: Dict[str, Any]) -> bool:
    sets = (setlist_json.get("sets") or {}).get("set") or []
    return any(set_block.get("song") for set_block in sets)


def find_latest_setlist_for_artist(
    artist_name: str, api_key: str, max_pages: int = 5
) -> SetlistInfo:
    """Busca en setlist.fm el concierto más reciente de un artista que tenga canciones registradas.

    Los conciertos sin setlist publicado (o con el setlist vacío) se descartan, recorriendo
    páginas adicionales de resultados si es necesario (hasta `max_pages`).
    """
    headers = {
        "x-api-key": api_key,
        "Accept": "application/json",
    }

    all_setlists: List[Dict[str, Any]] = []
    page = 1
    total_pages = 1

    while page <= max_pages and page <= total_pages:
        params = {"artistName": artist_name, "p": page}
        response = _get(f"{SETLISTFM_API_BASE}/search/setlists", headers=headers, params=params)

        if response.status_code == 404:
            break
        if response.status_code in (401, 403):
            raise InvalidApiKeyError("La API key de setlist.fm no es válida o no tiene permisos.")
        if response.status_code == 429:
            if all_setlists:
                # Ya tenemos candidatos de páginas previas: seguimos con lo que hay en vez de fallar.
                break
            raise RateLimitError(
                "Se ha alcanzado el límite de peticiones de la API de setlist.fm. "
                "Espera unos segundos y vuelve a intentarlo."
            )
        response.raise_for_status()

        data = response.json()
        setlists = data.get("setlist") or []
        if not setlists:
            break

        all_setlists.extend(setlists)
        items_per_page = data.get("itemsPerPage") or len(setlists)
        total = data.get("total", len(setlists))
        total_pages = max(1, -(-total // items_per_page))
        page += 1

    if not all_setlists:
        raise ArtistNotFoundError(f"No se han encontrado conciertos para '{artist_name}'.")

    # La API no garantiza el orden cronológico, así que se ordena explícitamente por fecha.
    for setlist_json in sorted(all_setlists, key=_event_date_sort_key, reverse=True):
        if _has_songs(setlist_json):
            return _parse_setlist_json(setlist_json, fallback_url=setlist_json.get("url", ""))

    raise ArtistNotFoundError(
        f"No se ha encontrado ningún concierto con canciones registradas para '{artist_name}' "
        f"(revisadas {len(all_setlists)} entradas)."
    )
