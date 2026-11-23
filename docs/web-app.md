# Web app (GitHub Pages)

Página web estática que crea una playlist de TIDAL a partir de un concierto de
setlist.fm. Funciona en el ordenador y en el móvil, y en Android se puede
instalar como aplicación (PWA) desde el navegador. La persona que la usa solo
necesita una cuenta de TIDAL: no tiene que pedir API keys ni instalar nada.

```
GitHub Pages (web/)  ──►  Cloudflare Worker (worker/)  ──►  api.setlist.fm
        │                  · guarda la API key de setlist.fm
        │                  · caché de respuestas (ahorra cuota)
        └──►  TIDAL (openapi.tidal.com y login.tidal.com), directamente, con OAuth PKCE
```

- **setlist.fm** bloquea las llamadas desde navegadores (CORS) y su API key no
  debe publicarse. Por eso las consultas pasan por un Worker gratuito que añade
  la clave.
- **TIDAL** sí admite llamadas desde el navegador. El inicio de sesión se hace
  en la web de TIDAL (Authorization Code + PKCE): la página nunca ve la
  contraseña y no hay `client_secret`. Los tokens se guardan en el
  `localStorage` del navegador de cada persona.

## Guía para quien usa la web

1. Abre la web y elige el concierto:
   - **Buscar artista**: escribe el nombre y elige el artista. Verás sus
     conciertos recientes con fecha, lugar y número de canciones.
   - **Pegar enlace**: pega la dirección de un concierto de setlist.fm. En el
     móvil, con la app instalada, también puedes usar **Compartir** desde el
     navegador y elegir *Setlist→TIDAL*.
   - **Prepárate para la gira**: crea una playlist con las canciones más tocadas
     en los últimos conciertos de la gira actual. Puedes ajustar el porcentaje
     mínimo de conciertos en que debe aparecer cada canción.
2. Pulsa **Conectar con TIDAL** e inicia sesión en la web de TIDAL. Volverás
   automáticamente al mismo concierto.
3. Revisa las canciones:
   - ✅ **Encontrada**: coincidencia clara.
   - ⚠️ **Revisar**: es probable, pero conviene comprobarlo con **Cambiar**.
   - ❌ **No encontrada**: con **Cambiar** puedes elegir otro resultado o hacer
     una búsqueda manual.
   - Las intros/cintas y los fragmentos (*snippets*) se excluyen por defecto;
     puedes incluirlos con **Incluir** o desde **Opciones de búsqueda**.
   - En **Opciones de búsqueda** puedes preferir versiones en directo. Las
     elecciones manuales se recuerdan para próximas veces.
4. Cambia el nombre, la descripción o la visibilidad si quieres y pulsa
   **Crear playlist en TIDAL**. Al terminar tendrás el enlace a la playlist y la
   lista de canciones que no se pudieron añadir.

**Instalar en Android:** en Chrome, abre la web, menú ⋮ → **Instalar
aplicación** (o *Añadir a pantalla de inicio*).

## Puesta en marcha (para quien mantiene la web)

Hay que hacerlo una sola vez. Todos los servicios usados son gratuitos.

### 1. Publicar en GitHub Pages

1. En el repositorio de GitHub: **Settings → Pages → Build and deployment →
   Source: GitHub Actions**.
2. Haz merge a `main`. El workflow [`.github/workflows/web.yml`](../.github/workflows/web.yml)
   ejecuta los tests y publica la carpeta `web/`. La URL será
   `https://<usuario>.github.io/<repositorio>/`.

### 2. Registrar la app en TIDAL

1. Entra en https://developer.tidal.com/dashboard y crea una app.
2. Añade como **Redirect URI** la URL exacta de la web, con la barra final:
   `https://<usuario>.github.io/<repositorio>/`. Para desarrollo local añade
   también `http://localhost:8000/`.
3. Activa los scopes `user.read`, `search.read`, `playlists.read` y
   `playlists.write`. Son los scopes de nivel *THIRD_PARTY*; no uses `r_usr` ni
   `w_usr`, que son internos de TIDAL.
4. Copia el **Client ID**. No es secreto. No hace falta (ni se debe usar) el
   *Client Secret*.

### 3. Desplegar el proxy de setlist.fm (Cloudflare Worker)

1. Pide una API key gratuita en https://www.setlist.fm/settings/api.
2. Crea una cuenta gratuita en https://dash.cloudflare.com.
3. Despliega el Worker de una de estas dos formas:
   - **Sin instalar nada:** *Workers & Pages → Create → Worker*. Ponle de nombre
     `setlistfm-proxy`, pulsa **Edit code**, pega el contenido de
     [`worker/src/index.js`](../worker/src/index.js) y pulsa **Deploy**. Después,
     en **Settings → Variables and Secrets**, añade:
     - `SETLISTFM_API_KEY` (tipo *Secret*): tu API key.
     - `ALLOWED_ORIGINS` (tipo *Text*): `https://<usuario>.github.io` (y
       `http://localhost:8000` si vas a desarrollar en local).
   - **Con Node.js:** desde la carpeta `worker/` ejecuta
     `npx wrangler login`, edita `ALLOWED_ORIGINS` en `wrangler.toml`, ejecuta
     `npx wrangler secret put SETLISTFM_API_KEY` y después `npx wrangler deploy`.
4. Anota la URL del Worker, del tipo
   `https://setlistfm-proxy.<tu-subdominio>.workers.dev`.

`ALLOWED_ORIGINS` evita que otras webs gasten tu cuota (el origen es solo el
dominio, sin la ruta del repositorio). El Worker solo deja pasar las tres
consultas que usa la web (buscar artista, conciertos de un artista y un
setlist concreto) y cachea las respuestas: los setlists 6 horas, las búsquedas
de artistas 24 horas y las listas de conciertos 1 hora.

### 4. Conectar todo

En GitHub: **Settings → Secrets and variables → Actions → Variables → New
repository variable**:

| Variable | Valor |
| --- | --- |
| `TIDAL_CLIENT_ID` | Client ID de la app de TIDAL |
| `SETLIST_PROXY_URL` | URL del Worker |
| `OAUTH_REDIRECT_URI` | Opcional. Solo si la URL de la web no coincide con la Redirect URI registrada |

Vuelve a lanzar el workflow (**Actions → Web → Run workflow**). El workflow
genera `web/config.js` con esos valores al publicar.

### Límites a tener en cuenta

- setlist.fm: 2 peticiones/segundo y 1440 al día por API key. Gracias a la
  caché, cada concierto se pide una sola vez aunque lo usen muchas personas.
  Cargar un concierto o buscar un artista gasta una llamada.
- TIDAL: cada canción necesita entre 2 y 10 llamadas (búsqueda y detalle de
  pistas, con búsquedas alternativas si la primera no encuentra nada). La web
  hace como mucho 3 búsquedas a la vez y reintenta automáticamente si TIDAL
  responde *429*.
- Las condiciones de setlist.fm permiten el uso no comercial con atribución. La
  descripción de cada playlist incluye el enlace al setlist.

## Desarrollo local

```powershell
# En web/config.js pon tu Client ID y la URL del Worker (no lo subas al repo).
cd web
python -m http.server 8000
# Abre http://localhost:8000/
```

El Client ID debe tener registrada `http://localhost:8000/` como Redirect URI,
y el Worker debe permitir el origen `http://localhost:8000`.

### Tests

Las pruebas no necesitan red ni dependencias:

- Con Node.js 20+: `node web/tests/run.js`.
- Sin Node: sirve la raíz del repositorio (`python -m http.server 8000`) y abre
  `http://localhost:8000/web/tests/index.html`.

Cubren la normalización y la puntuación de coincidencias, la lectura de
setlists (cintas, versiones, medleys, fragmentos, bises y modo gira), los
clientes de setlist.fm y TIDAL con respuestas simuladas, el flujo OAuth PKCE y
el Worker.

## Cómo se eligen las canciones

Para cada canción del setlist:

1. Se prueban búsquedas de la más precisa a la más amplia: `artista + título`,
   `artista + título sin añadidos` y `título`. En las versiones (*covers*) se
   busca también con el artista original. La búsqueda se detiene en cuanto hay
   una coincidencia clara.
2. Cada resultado se puntúa por la similitud del título (sin tildes,
   puntuación, "Remastered 2011", "- Live", "feat."…) y del artista (ignorando
   "The" y aceptando "Bruce Springsteen & The E Street Band"). Los resultados
   con un título o un artista poco parecidos se descartan: **nunca se elige otra
   canción del mismo grupo**.
3. Se penalizan karaoke, tributos e instrumentales, se prefiere estudio o
   directo según la opción elegida, y la popularidad solo desempata. Se eliminan
   duplicados por ISRC.
4. Si la mejor opción coincide claramente, se marca como *Encontrada*; si es
   probable pero no segura, como *Revisar*.

El código está en [`web/js/core/matcher.js`](../web/js/core/matcher.js) y
[`web/js/core/text.js`](../web/js/core/text.js).
