"""Interfaz de línea de comandos: setlist.fm -> playlist de Tidal."""

import argparse
import sys
from typing import List, Optional, Tuple

import tidalapi

from . import config, prompts, setlistfm_client, tidal_client
from .setlistfm_client import SetlistInfo


def _format_track(track: "tidalapi.media.Track") -> str:
    artist_name = track.artist.name if track.artist else "?"
    album_name = track.album.name if track.album else "?"
    duration = int(track.duration or 0)
    minutes, seconds = divmod(duration, 60)
    return f"{artist_name} - {track.name} [{album_name}] ({minutes}:{seconds:02d})"


def _choose_track(
    song_name: str, candidates: List["tidalapi.media.Track"]
) -> Optional["tidalapi.media.Track"]:
    print(f"\nSe han encontrado varias opciones para '{song_name}':")
    for i, track in enumerate(candidates, start=1):
        print(f"  {i}. {_format_track(track)}")
    print("  0. Ninguna de las anteriores (omitir esta canción)")

    while True:
        choice = input("Elige una opción: ").strip()
        if not choice.isdigit():
            print("Introduce un número válido.")
            continue
        choice_num = int(choice)
        if choice_num == 0:
            return None
        if 1 <= choice_num <= len(candidates):
            return candidates[choice_num - 1]
        print("Opción fuera de rango.")


def resolve_songs(
    session: "tidalapi.Session", setlist: SetlistInfo
) -> Tuple[List["tidalapi.media.Track"], List[str]]:
    resolved: List["tidalapi.media.Track"] = []
    not_found: List[str] = []

    for song in setlist.songs:
        if song.is_tape:
            # Sonido de megafonía (intro/outro), no es una interpretación real.
            continue

        search_artist = song.cover_artist or setlist.artist
        candidates = tidal_client.search_track(session, search_artist, song.name)

        if not candidates:
            not_found.append(song.name)
            print(f"No se ha encontrado en Tidal: '{song.name}' ({search_artist})")
            continue

        track = candidates[0] if len(candidates) == 1 else _choose_track(song.name, candidates)

        if track is not None:
            resolved.append(track)
        else:
            not_found.append(song.name)

    return resolved, not_found


def get_setlist(url: str) -> SetlistInfo:
    """Obtiene el setlist, ofreciendo eliminar la API key si no es válida."""
    while True:
        api_key = config.get_setlistfm_api_key()
        try:
            return setlistfm_client.fetch_setlist(url, api_key)
        except setlistfm_client.InvalidApiKeyError as exc:
            print(f"Error: {exc}")
            if prompts.ask_yes_no("¿Quieres eliminar la API key guardada e introducir una nueva?"):
                config.clear_setlistfm_api_key()
                continue
            raise SystemExit("No se puede continuar sin una API key válida de setlist.fm.")


def get_latest_setlist_for_artist(artist_name: str) -> SetlistInfo:
    """Busca el último concierto de un artista, ofreciendo eliminar la API key si no es válida."""
    while True:
        api_key = config.get_setlistfm_api_key()
        try:
            return setlistfm_client.find_latest_setlist_for_artist(artist_name, api_key)
        except setlistfm_client.InvalidApiKeyError as exc:
            print(f"Error: {exc}")
            if prompts.ask_yes_no("¿Quieres eliminar la API key guardada e introducir una nueva?"):
                config.clear_setlistfm_api_key()
                continue
            raise SystemExit("No se puede continuar sin una API key válida de setlist.fm.")


def _print_setlist_summary(setlist: SetlistInfo) -> None:
    print(f"  Artista: {setlist.artist}")
    print(f"  Recinto: {setlist.venue}, {setlist.city}, {setlist.country}")
    print(f"  Fecha: {setlist.event_date}")
    print(f"  Canciones: {len(setlist.songs)}")
    print(f"  URL: {setlist.url}")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Genera una playlist en Tidal a partir de un concierto de setlist.fm"
    )
    parser.add_argument(
        "--setlistfm-api-key",
        help="API key de setlist.fm. Si no se indica, se pedirá de forma interactiva la primera vez.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    url_parser = subparsers.add_parser("url", help="Genera la playlist a partir de la URL de un setlist")
    url_parser.add_argument("url", help="URL del setlist en setlist.fm")

    artist_parser = subparsers.add_parser(
        "artist", help="Genera la playlist a partir del último concierto con setlist de un artista"
    )
    artist_parser.add_argument("artist", help="Nombre del artista o grupo")

    args = parser.parse_args(argv)

    if args.setlistfm_api_key:
        config.set_setlistfm_api_key(args.setlistfm_api_key)

    if args.command == "url":
        print("Obteniendo información del setlist...")
        try:
            setlist = get_setlist(args.url)
        except setlistfm_client.SetlistNotFoundError as exc:
            print(f"Error: {exc}")
            return 1
        except setlistfm_client.RateLimitError as exc:
            print(f"Error: {exc}")
            return 1
    else:
        print(f"Buscando el último concierto de '{args.artist}' con setlist disponible...")
        try:
            setlist = get_latest_setlist_for_artist(args.artist)
        except setlistfm_client.ArtistNotFoundError as exc:
            print(f"Error: {exc}")
            return 1
        except setlistfm_client.RateLimitError as exc:
            print(f"Error: {exc}")
            return 1

        print("\nÚltimo concierto encontrado:")
        _print_setlist_summary(setlist)

        if not setlist.songs:
            print("\nEste concierto no tiene canciones registradas en el setlist.")
            return 1

        if not prompts.ask_yes_no("\n¿Confirmas la creación de la playlist en Tidal con este concierto?"):
            print("Operación cancelada.")
            return 0

    if not setlist.songs:
        print("El setlist no contiene canciones.")
        return 1

    print(f"Concierto: {setlist.artist} - {setlist.venue} ({setlist.event_date})")
    print(f"Canciones en el setlist: {len(setlist.songs)}")

    print("\nIniciando sesión en Tidal...")
    session = tidal_client.login()

    print("\nBuscando canciones en Tidal...")
    resolved_tracks, not_found = resolve_songs(session, setlist)

    if not resolved_tracks:
        print("\nNo se ha podido encontrar ninguna canción en Tidal. No se creará la playlist.")
        return 1

    print(f"\nCreando la playlist '{setlist.playlist_title}' en Tidal...")
    playlist = tidal_client.create_playlist(
        session,
        setlist.playlist_title,
        description=f"Generada automáticamente desde {setlist.url}",
    )
    playlist.add([str(track.id) for track in resolved_tracks])

    print(f"\nPlaylist creada correctamente: {playlist.listen_url}")
    print(f"Canciones añadidas: {len(resolved_tracks)}/{len(setlist.songs)}")

    if not_found:
        print("\nNo se han encontrado las siguientes canciones:")
        for name in not_found:
            print(f"  - {name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
