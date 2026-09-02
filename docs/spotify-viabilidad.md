# Informe: viabilidad de añadir Spotify como servicio alternativo a Tidal

Fecha: 2026-09-02

## Conclusión

**Sí, es viable** y técnicamente limpio de integrar, pero Spotify impone una restricción estructural que Tidal no tiene: **requiere que cada aplicación esté registrada como "app" en el Spotify Developer Dashboard**, y en su modo gratuito ("Development Mode") solo permite hasta **25 usuarios autorizados explícitamente**. Esto no afecta a un uso personal/local del script, pero sí limita la distribución pública sin más trámites.

---

## 1. Autenticación (el punto más distinto respecto a Tidal)

| | Tidal (actual) | Spotify |
|---|---|---|
| Client ID | Embebido en `tidalapi` (público, compartido por todos) | **Debe crearlo cada usuario** en https://developer.spotify.com/dashboard |
| Flujo | OAuth *device code* (visita URL, sin servidor local) | Authorization Code + **PKCE** (recomendado para apps CLI/desktop, no requiere `client_secret`) |
| Redirect URI | No aplica (device flow) | Obligatoria, debe registrarse en el dashboard (p. ej. `http://127.0.0.1:8888/callback`) |
| Captura del código | Polling automático en segundo plano | Requiere **servidor HTTP local temporal** (la librería `spotipy` ya lo implementa) o pegar la URL manualmente |
| Restricción de usuarios | Ninguna | **Development Mode: máx. 25 usuarios** añadidos a mano en el dashboard. Pasar de ese límite requiere solicitar extensión de cuota a Spotify (proceso de revisión, no garantizado) |
| Almacenamiento local | Token OAuth en fichero propio | Igual patrón: `spotipy` ya soporta `CacheFileHandler` (fichero JSON con `access_token`/`refresh_token`), reutilizable con la misma estrategia de permisos restringidos que ya usamos para Tidal |

Esto significa que, para que **el usuario del proyecto** use la función, basta con crear una app gratuita en el dashboard de Spotify (dos minutos) y añadirse como usuario autorizado. Para que **otras personas** usaran el mismo script libremente sin configurar nada (como pasa con Tidal), habría que publicar una app en modo "Extended" aprobada por Spotify, lo cual no es inmediato.

## 2. Librería recomendada: `spotipy`

Es el equivalente de facto a `tidalapi` (aunque no oficial, muy usado y estable). Cubre exactamente lo que necesitamos:

- `SpotifyPKCE(client_id, redirect_uri, scope, cache_handler=CacheFileHandler(cache_path=...))` → login con caché en disco, igual que hacemos con la sesión de Tidal.
- `sp.search(q, type="track", limit=...)` → búsqueda de canciones (mapea 1:1 con `search_track` actual).
- `sp.current_user_playlist_create(name, description=...)` → crear playlist.
- `sp.playlist_add_items(playlist_id, uris)` → añadir canciones (acepta lista ordenada, igual que `UserPlaylist.add()` de Tidal).

## 3. Límites de la API (rate limits)

A diferencia de setlist.fm/Tidal, Spotify **no publica una cifra fija** (no es "X/segundo, Y/día"). Aplica un límite dinámico por app en una ventana móvil de ~30 segundos; si se excede, responde `429` con cabecera `Retry-After`. `spotipy` ya incluye reintento automático con backoff ante `429/500/502/503/504`, por lo que el impacto práctico para el volumen de peticiones de este script (una búsqueda por canción de un concierto, quizá 15-25 llamadas) es despreciable.

## 4. Cambios de arquitectura necesarios en el proyecto

Actualmente `tidal_client.py` y `cli.py` están acoplados directamente a `tidalapi`. Para soportar Spotify sin duplicar lógica, propondría:

1. **Extraer una interfaz común** (`MusicService`) con los métodos que ya usa `cli.py`: `login()`, `search_track(artist, title)`, `create_playlist(title, description)`, `playlist.add(ids)`.
2. **Renombrar** `tidal_client.py` → implementación `TidalService`, y añadir `spotify_client.py` → `SpotifyService` con la misma forma.
3. **CLI**: añadir flag `--service {tidal,spotify}` (o preguntar interactivamente si no se especifica), y mantener el resto del flujo (`resolve_songs`, elección múltiple, informe de no encontradas) **sin cambios**, ya que opera sobre objetos abstractos (id, nombre, artista, álbum, duración) en vez de tipos concretos de `tidalapi`.
4. **Config**: nuevas claves `spotify_client_id` y fichero de caché de sesión `spotify_session.json`, con los mismos permisos restringidos que ya aplicamos a Tidal, más el flujo de "eliminar y reintroducir" ya implementado para credenciales inválidas.
5. Track matching (elegir entre varias opciones / marcar como no encontrada) es reutilizable tal cual, ya que Spotify también permite ver resultados múltiples ambiguos por canción.

## 5. Riesgos y matices a tener en cuenta

- **Cobertura de catálogo distinta a Tidal**: una canción puede existir en uno y no en el otro (o versión distinta: directo/estudio), así que el listado de "no encontradas" podría variar según el servicio elegido.
- **Mercado/disponibilidad regional** (`market`): Spotify puede devolver pistas no reproducibles en el mercado del usuario; conviene pasar el parámetro `market="from_token"` en las búsquedas.
- **Modo Development limitado a 25 usuarios**: aceptable para uso personal o un grupo reducido; bloqueante si se quisiera ofrecer como herramienta pública sin fricciones (habría que documentarlo claramente en el README).
- Igual que con Tidal, no se necesita gestionar contraseñas: PKCE es totalmente seguro para un cliente público sin backend.

## 6. Recomendación

Viable y coherente con la arquitectura actual. Si se decide implementar, el diseño propuesto es: interfaz común + `spotify_client.py` + flag `--service`, dejando claro en el README el requisito de crear una app en el Spotify Developer Dashboard y el límite de 25 usuarios en modo Development.
