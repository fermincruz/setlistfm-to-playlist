# Aplicacion Android: Setlist.fm a TIDAL

Aplicacion nativa para buscar un concierto en setlist.fm, encontrar sus canciones
en TIDAL y crear una playlist. Requiere Android 8.0 (API 26) o posterior.

## Guia de usuario

### Requisitos

- Una API key personal de setlist.fm, solicitada en
  https://www.setlist.fm/settings/api.
- Una cuenta TIDAL y conexion a Internet.
- Un APK compilado por el mantenedor con el Client ID de su app TIDAL. Si la
  pantalla indica que falta el Client ID, esa compilacion no esta configurada y
  no puede iniciar el acceso TIDAL.

### Instalar y conectar

1. Instala el APK recibido. Si Android lo solicita, permite temporalmente la
   instalacion desde la aplicacion que abrio el archivo.
2. Pega la API key de setlist.fm y pulsa **Guardar clave**. La clave se conserva
   cifrada en el almacenamiento privado de la app; puedes usar **Borrar** para
   eliminarla de este dispositivo.
3. Pulsa **Conectar** en la seccion de TIDAL. Se abrira el navegador del sistema
   para iniciar sesion y autorizar los permisos solicitados. La app nunca pide
   ni recibe tu contrasena de TIDAL.

### Crear una playlist

1. Elige **URL** para pegar una direccion de concierto de setlist.fm, o **Artista**
   para buscar el concierto mas reciente que tenga canciones registradas.
2. Pulsa **Cargar setlist** o **Buscar ultimo concierto**. Revisa el artista, el
   recinto, la fecha y el numero de canciones mostrados.
3. Pulsa **Buscar canciones en TIDAL**. Las coincidencias claras se seleccionan
   automaticamente; las canciones sin resultados se omiten.
4. Si aparecen varias versiones posibles, toca la pista correcta. Pulsa
   **Omitir esta cancion** para no incluirla.
5. Revisa cuantas pistas se encontraron y pulsa **Crear playlist en TIDAL**. La
   app no crea una playlist si no se selecciono ninguna pista.
6. Al terminar, **Abrir en TIDAL** abre la playlist. La pantalla tambien informa
   de las canciones que no se encontraron.

Las canciones `tape` (sonidos de megafonia) se excluyen. Las canciones repetidas
del concierto, por ejemplo un bis, se mantienen en el mismo orden.

### Desconectar TIDAL

Pulsa **Desconectar** para borrar del dispositivo el estado OAuth local. Esto no
cambia la contrasena de TIDAL ni elimina playlists ya creadas. Borrar los datos
de la app tambien elimina las credenciales locales.

### Problemas habituales

- **API key no valida**: revisa la clave en setlist.fm, actualizala y vuelve a
  guardarla. La API limita las solicitudes; espera si se muestra un aviso de
  limite.
- **No hay concierto con canciones**: comprueba el nombre del artista; la app
  solo considera hasta cinco paginas de resultados recientes.
- **TIDAL no autoriza o no permite crear**: desconecta y vuelve a conectar. Si
  persiste, el mantenedor debe revisar en TIDAL Developer Dashboard el Client ID,
  URI de redireccion, scopes de busqueda/escritura y nivel de acceso de la app.
- **No se encuentra una pista**: el catalogo puede variar por pais o no incluir
  esa grabacion. Se puede continuar sin ella.

La API de setlist.fm es gratuita para proyectos no comerciales segun sus
condiciones; revisalas antes de distribuir o usar la app con fines comerciales.

## Desarrollo y compilacion

Consulta [como generar y firmar el APK](../docs/android-apk.md). La app necesita
un Client ID de TIDAL registrado por quien prepara el APK; el Client ID no es un
secreto y no se incorpora ningun `client_secret`.