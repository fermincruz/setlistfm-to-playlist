# Plan de la aplicacion Android

## Objetivo

Ofrecer en Android el flujo esencial de `setlistfm2tidal`: obtener un setlist de
setlist.fm, resolver sus canciones en TIDAL y crear una playlist en la cuenta del
usuario. La app sera nativa, sencilla, sin backend y sin funciones ajenas a ese
flujo.

## Requisitos

- Android 8.0 (API 26) o posterior; interfaz nativa en Kotlin y Jetpack Compose.
- Aceptar una URL de setlist.fm o buscar el ultimo concierto con canciones de un
  artista. En la busqueda por artista, mostrar el concierto y pedir confirmacion
  antes de crear la playlist.
- Pedir la API key personal de setlist.fm dentro de la app; guardarla de forma
  privada en el dispositivo y permitir cambiarla o borrarla. Usar `x-api-key`,
  JSON y respetar el limite documentado de 2 solicitudes por segundo.
- Autorizar TIDAL desde el navegador del sistema con OAuth Authorization Code y
  PKCE. La app nunca solicita la contrasena de TIDAL.
- Buscar canciones en el catalogo, preferir coincidencias exactas y del artista,
  permitir elegir cuando haya varias opciones y omitir canciones no encontradas.
- Ignorar canciones marcadas como `tape`; no crear una playlist si no queda
  ninguna pista. Mostrar un resumen y un enlace a la playlist creada.
- No solicitar ni incluir un `client_secret` en la app. Configurar el `Client ID`
  publico de una aplicacion registrada en TIDAL al compilar; registrar tambien
  el URI de redireccion OAuth correspondiente.
- Guardar tokens OAuth con almacenamiento cifrado respaldado por Android
  Keystore. No registrar API keys, tokens ni codigos OAuth en logs.
- Mostrar estados de carga, errores recuperables y resultados parciales sin
  bloquear la interfaz durante llamadas de red.

## Arquitectura propuesta

- Una actividad Compose con flujo por pasos: credenciales, origen del setlist,
  revision y resultado.
- Capa de dominio independiente de Android para modelos de setlist, canciones,
  resultados y reglas de resolucion.
- Adaptadores HTTP separados para Setlist.fm y TIDAL, con DTOs de API distintos
  de los modelos de dominio.
- Repositorio local para preferencias y credenciales; almacenamiento cifrado
  para tokens y preferencias privadas para la API key.
- AppAuth para navegador externo, PKCE, validacion `state` y recepcion del
  callback OAuth mediante deep link registrado.
- TIDAL Web API oficial, no la API no oficial `tidalapi` que usa el CLI. El
  acceso de escritura depende de que la aplicacion registrada tenga habilitados
  los permisos y el nivel de acceso requeridos por TIDAL.

## Fases, pruebas y commits

1. **Requisitos y diseno**: este documento. Revisar el flujo del CLI, los
   contratos publicos de ambas APIs, privacidad y criterios de aceptacion.
   Prueba: comprobar contra la documentacion que TIDAL soporta PKCE, busqueda,
   creacion de playlist y adicion de pistas. Commit: `docs: define Android app requirements and phases`.
2. **Base Android y dominio**: proyecto Gradle/Kotlin, modelos y reglas de
   parsing/resolucion separadas de la UI. Pruebas unitarias para URL/ID, parsing
   de setlists, canciones `tape`, coincidencias y resumen. Commit:
   `feat(android): add app foundation and setlist domain`.
3. **Integraciones y autorizacion**: Setlist.fm, OAuth PKCE TIDAL, persistencia
   segura de credenciales, busqueda y mutaciones de playlist. Pruebas unitarias
   de mapeo/serializacion, mocks HTTP y estados de token; ninguna prueba usa
   credenciales reales. Commit: `feat(android): integrate Setlist.fm and TIDAL APIs`.
4. **Interfaz y flujo completo**: formulario URL/artista, autorizacion, revision
   de candidatos, confirmacion, progreso, errores y resultado. Pruebas Compose
   para entradas, estados, seleccion/omision y prevencion de creacion vacia.
   Commit: `feat(android): implement playlist creation flow`.
5. **Documentacion y entrega**: guia de usuario, registro/configuracion de la
   app TIDAL, generacion de APK debug/release, firma y comprobaciones previas a
   distribuir. Ejecutar pruebas y build disponible; documentar cualquier
   limitacion del entorno. Commit: `docs(android): add user and APK build guides`.

Cada fase se valida antes de crear su commit. Las fases que llamen servicios
remotos se prueban con mocks; la prueba real de OAuth y permisos requiere una
app registrada por el mantenedor y una cuenta TIDAL.

## Estado de ejecucion

| Fase | Estado | Commit | Validacion |
| --- | --- | --- | --- |
| Requisitos y diseno | Completa | `5383b39` | Contratos oficiales TIDAL y Setlist.fm revisados. |
| Base Android y dominio | Completa | `2565cf3` | Pruebas unitarias escritas; diagnosticos del editor sin errores. No ejecutables sin Gradle/JDK. |
| Integraciones y autorizacion | Completa | `fbae6c7` | Pruebas HTTP mock escritas; diagnosticos del editor sin errores. No ejecutables sin Gradle/JDK. |
| Interfaz y flujo completo | Completa | `20ddf27`, `12eddaa` | Pruebas Compose para entrada, seleccion/omision y bloqueo de playlist vacia; no ejecutables sin Android SDK/emulador. |
| Documentacion y APK | Completa | Commit de entrega | Guia de usuario, firma local y comandos de build documentados; APK no generado en este entorno. |

Los commits pertenecen a la rama `feature/android-app`. No se ha generado un APK
en este entorno porque no estan instalados Java, Gradle ni Android SDK. El APK
release necesita ademas que el mantenedor registre y configure una app TIDAL con
permisos de escritura aprobados.

## Criterios de aceptacion

- Se pueden obtener setlists tanto por URL como por artista, conservando las
  reglas del CLI y mostrando errores entendibles.
- Ninguna llamada de TIDAL con datos del usuario ocurre antes de autorizar;
  ninguna playlist se crea sin confirmacion y sin al menos una pista resuelta.
- El usuario puede escoger una coincidencia ambigua, omitirla y ver cuales no
  se encontraron.
- La API key y tokens no se exponen en logs; no se incluye client secret.
- El proyecto documenta comandos para generar e instalar un APK y una guia que
  permite a una persona nueva completar el flujo.

## Riesgos y decisiones pendientes de publicacion

- TIDAL requiere registrar la aplicacion en su Developer Dashboard. El
  mantenedor debe configurar un `Client ID`, un URI de redireccion y los
  permisos de escritura de playlist; TIDAL puede exigir aprobacion o acceso
  adicional. Un APK con el valor de ejemplo no puede iniciar OAuth.
- La disponibilidad y el formato actual de endpoints de escritura dependen del
  nivel de acceso de TIDAL. Antes de distribuir, verificar el permiso efectivo
  y probar con una playlist de prueba.
- La API key de setlist.fm es individual; el usuario debe solicitarla en
  setlist.fm. Los limites de la API aplican tambien a la app.
- Sin Java/Android SDK en el entorno de desarrollo no se podra certificar un APK
  localmente; la fase final incluira instrucciones para validar el build en
  Android Studio o en un entorno Android configurado.