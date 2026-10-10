# Generar el APK Android

## Requisitos

- Android Studio con Android SDK Platform 35 y Build Tools instalados.
- JDK 17.
- Gradle 8.9 para crear el wrapper inicial. El plugin Android del proyecto es
  8.7.3 y requiere Gradle 8.9.
- Una app registrada en [TIDAL Developer Dashboard](https://developer.tidal.com/dashboard).

## Configurar TIDAL

1. Crea una app en el dashboard y configura como redirect URI exactamente:
   `com.fermincruz.setlistfm2tidal:/oauth2redirect`.
2. Habilita los permisos necesarios para buscar (`search.read`, `r_usr`) y crear
   playlists (`playlists.write`, `w_usr`). TIDAL puede requerir aprobacion o un
   nivel de acceso habilitado para las escrituras; confirma esto con la app de
   prueba antes de distribuir.
3. Anota el Client ID. La app usa Authorization Code + PKCE y no necesita un
   `client_secret`; no pongas uno en el APK, en Gradle ni en el repositorio.

## Preparar el proyecto

Desde PowerShell, abre `android` y genera el wrapper una vez usando Gradle 8.9:

```powershell
cd android
gradle wrapper --gradle-version 8.9
```

Android Studio tambien puede abrir directamente la carpeta `android`. La primera
sincronizacion descarga plugins y dependencias, por lo que necesita Internet.

Pasa el Client ID publico al build con `-PTIDAL_CLIENT_ID=...` o guardalo como
`TIDAL_CLIENT_ID=...` en `%USERPROFILE%\.gradle\gradle.properties`. No compartas
credenciales OAuth ni una API key de usuario en los comandos, logs o archivos del
proyecto.

## Ejecutar pruebas y crear APK debug

```powershell
cd android
.\gradlew.bat testDebugUnitTest -PTIDAL_CLIENT_ID=TU_CLIENT_ID
.\gradlew.bat assembleDebug -PTIDAL_CLIENT_ID=TU_CLIENT_ID
```

El APK debug aparece en
`android/app/build/outputs/apk/debug/app-debug.apk`. Para instalarlo en un
emulador o dispositivo conectado con depuracion USB:

```powershell
.\gradlew.bat installDebug -PTIDAL_CLIENT_ID=TU_CLIENT_ID
```

La prueba instrumentada de Compose necesita un emulador/dispositivo activo:

```powershell
.\gradlew.bat connectedDebugAndroidTest -PTIDAL_CLIENT_ID=TU_CLIENT_ID
```

## Firmar y generar APK release

Genera una clave privada de firma una sola vez y guardala en un lugar respaldado
con seguridad. No la pierdas: las actualizaciones deben conservar la misma firma.

```powershell
keytool -genkeypair -v -keystore release-key.jks -alias setlistfm2tidal -keyalg RSA -keysize 2048 -validity 10000
```

Crea `android/keystore.properties` (ignorado por Git) con las rutas y secretos de
esa clave:

```properties
storeFile=release-key.jks
storePassword=CONTRASENA_DEL_KEYSTORE
keyAlias=setlistfm2tidal
keyPassword=CONTRASENA_DE_LA_CLAVE
```

Para ruta relativa, `storeFile` se resuelve desde la carpeta `android`. No subas
`keystore.properties`, el keystore ni contrasenas a Git. La configuracion deja el
APK release sin firmar si faltan estas propiedades; comprueba que existen antes
de compilar una entrega.

```powershell
cd android
.\gradlew.bat assembleRelease -PTIDAL_CLIENT_ID=TU_CLIENT_ID
```

Con firma configurada, el APK final se genera en
`android/app/build/outputs/apk/release/app-release.apk`. Verifica su firma con
Android SDK Build Tools:

```powershell
apksigner verify --verbose --print-certs app\build\outputs\apk\release\app-release.apk
```

Antes de distribuir, instala el APK en un dispositivo limpio, autoriza TIDAL,
prueba URL y artista, confirma una playlist de prueba y verifica las canciones
omitidas. TIDAL debe haber habilitado la escritura para el Client ID de release.
Incrementa `versionCode` en `android/app/build.gradle.kts` para cada actualizacion.

Este repositorio no contiene un APK precompilado. En el entorno donde se preparo
este cambio no hay JDK, Gradle ni Android SDK; por ello el build, la firma y las
pruebas de dispositivo quedan pendientes de ejecutar con las herramientas
anteriores.