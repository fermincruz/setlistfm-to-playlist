"""Cliente para autenticación, búsqueda y creación de playlists en Tidal."""

from typing import List

import tidalapi

from . import config, prompts


def login() -> tidalapi.Session:
    """Inicia sesión en Tidal reutilizando la sesión guardada localmente si es válida.

    Si la sesión guardada no es válida (ha caducado o no tiene permisos), se
    ofrece al usuario eliminarla y volver a iniciar sesión. El nuevo login se
    realiza mediante el flujo OAuth de dispositivo (visitando una URL en el
    navegador); en ningún momento la aplicación gestiona ni almacena la
    contraseña del usuario.
    """
    config.ensure_app_dir()
    session = tidalapi.Session()

    if config.TIDAL_SESSION_FILE.exists():
        session.load_session_from_file(config.TIDAL_SESSION_FILE)
        if not session.check_login():
            print("La sesión guardada de Tidal no es válida, ha caducado o no tiene permisos.")
            if prompts.ask_yes_no("¿Quieres eliminarla y volver a iniciar sesión?"):
                config.clear_tidal_session()
                session = tidalapi.Session()
            else:
                raise SystemExit("No se puede continuar sin una sesión válida de Tidal.")

    if not session.check_login():
        session.login_oauth_simple(fn_print=print)

    if not session.check_login():
        raise SystemExit("No se ha podido iniciar sesión en Tidal.")

    session.save_session_to_file(config.TIDAL_SESSION_FILE)
    config.secure_file_permissions(config.TIDAL_SESSION_FILE)
    return session


def search_track(
    session: tidalapi.Session, artist: str, title: str, limit: int = 5
) -> List[tidalapi.media.Track]:
    query = f"{artist} {title}".strip()
    results = session.search(query, models=[tidalapi.media.Track])
    tracks = results.get("tracks") or []
    return tracks[:limit]


def create_playlist(
    session: tidalapi.Session, title: str, description: str = ""
) -> tidalapi.playlist.UserPlaylist:
    return session.user.create_playlist(title, description)
