# setlistfm2tidal

Script de terminal que, a partir de la URL de un concierto en [setlist.fm](https://www.setlist.fm/),
crea una playlist con esas canciones en la cuenta de Tidal del usuario.

## Instalación

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Configuración

Necesitas una API key gratuita de setlist.fm: https://api.setlist.fm/docs/1.0/index.html

La primera vez que ejecutes el script te la pedirá de forma interactiva y la guardará
localmente (en `~/.setlistfm2tidal/config.json`, con permisos restringidos al
propio usuario) para no tener que volver a introducirla. También puedes pasarla
explícitamente con `--setlistfm-api-key`, o mediante la variable de entorno
`SETLISTFM_API_KEY`.

El inicio de sesión en Tidal se hace mediante el flujo OAuth oficial de Tidal:
el script muestra una URL que debes abrir en el navegador e iniciar sesión allí.
La aplicación nunca ve ni almacena tu contraseña, solo el token de sesión resultante,
que se guarda en `~/.setlistfm2tidal/tidal_session.json` (permisos restringidos
al usuario) para no repetir el login en ejecuciones sucesivas.

## Uso

Generar la playlist a partir de la URL de un concierto concreto:

```powershell
python -m setlistfm2tidal url "https://www.setlist.fm/setlist/artist/2023/some-venue-city-country-2bd6a1e3.html"
```

Generar la playlist a partir del último concierto con setlist disponible de un artista
(se muestra el concierto encontrado y se pide confirmación antes de crear la playlist):

```powershell
python -m setlistfm2tidal artist "Nombre del artista"
```

Durante la ejecución:
- Si una canción tiene varios resultados posibles en Tidal, se te pedirá que elijas cuál es la correcta.
- Si una canción no se encuentra en Tidal, se te informará y se omitirá, mostrando un resumen final.
- Las canciones marcadas como "tape" (sonido de megafonía, intros/outros) se ignoran automáticamente.

## Consumo de la API de setlist.fm

La API key gratuita de setlist.fm tiene un límite de 2 llamadas/segundo y 1440 llamadas/día.
Cada ejecución del script consume, según el comando usado:

- `url`: **una única llamada** a `GET /1.0/setlist/{id}`.
- `artist`: **una llamada** a `GET /1.0/search/setlists` (página 1). Esta respuesta ya incluye el
  detalle completo de cada concierto (recinto, fecha y canciones), por lo que no hace falta una
  llamada adicional para obtener el setlist. Si los conciertos más recientes de esa primera página
  no tienen canciones registradas (setlist vacío), se buscan más páginas hasta encontrar el
  concierto más reciente que sí las tenga, con un **máximo de 5 páginas** (5 llamadas) por ejecución.

Si la API key guardada resulta inválida y decides introducir una nueva, se repiten esas llamadas
(una vez más por cada reintento). Las búsquedas y la creación de la playlist en Tidal usan la
API de Tidal, que no cuenta contra el límite de setlist.fm.

