"""Gestión de la configuración local de la aplicación.

Los datos sensibles (API key de setlist.fm, sesión OAuth de Tidal) se guardan
en el directorio de usuario, en un fichero al que solo el propio usuario tiene
permisos de lectura/escritura.
"""

import getpass
import json
import os
import stat
from pathlib import Path
from typing import Any, Dict

APP_DIR = Path.home() / ".setlistfm2tidal"
CONFIG_FILE = APP_DIR / "config.json"
TIDAL_SESSION_FILE = APP_DIR / "tidal_session.json"

_OWNER_READ_WRITE = stat.S_IRUSR | stat.S_IWUSR


def ensure_app_dir() -> None:
    """Crea el directorio de configuración si no existe, restringiendo el acceso al propietario."""
    APP_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(APP_DIR, stat.S_IRWXU)
    except OSError:
        pass  # En Windows chmod tiene efecto limitado; no es un error fatal.


def secure_file_permissions(path: Path) -> None:
    """Restringe el acceso de un fichero al propietario (best-effort en Windows)."""
    try:
        os.chmod(path, _OWNER_READ_WRITE)
    except OSError:
        pass


def load_config() -> Dict[str, Any]:
    if not CONFIG_FILE.exists():
        return {}
    with CONFIG_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_config(data: Dict[str, Any]) -> None:
    ensure_app_dir()
    with CONFIG_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    secure_file_permissions(CONFIG_FILE)


def get_setlistfm_api_key() -> str:
    """Obtiene la API key de setlist.fm, pidiéndola de forma interactiva la primera vez."""
    cfg = load_config()
    api_key = cfg.get("setlistfm_api_key") or os.environ.get("SETLISTFM_API_KEY")

    if not api_key:
        print("No se ha encontrado una API key de setlist.fm configurada.")
        print("Puedes solicitar una gratis en https://api.setlist.fm/docs/1.0/index.html")
        api_key = getpass.getpass("Introduce tu API key de setlist.fm: ").strip()
        if not api_key:
            raise SystemExit("Se requiere una API key de setlist.fm para continuar.")
        cfg["setlistfm_api_key"] = api_key
        save_config(cfg)

    return api_key


def set_setlistfm_api_key(api_key: str) -> None:
    cfg = load_config()
    cfg["setlistfm_api_key"] = api_key
    save_config(cfg)


def clear_setlistfm_api_key() -> None:
    cfg = load_config()
    if cfg.pop("setlistfm_api_key", None) is not None:
        save_config(cfg)


def clear_tidal_session() -> None:
    TIDAL_SESSION_FILE.unlink(missing_ok=True)
