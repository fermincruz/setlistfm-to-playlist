// Configuración pública de la web. Ninguno de estos valores es secreto.
// Al publicar con GitHub Actions este archivo se genera a partir de las
// variables del repositorio (ver docs/web-app.md).
window.APP_CONFIG = {
  // Client ID de tu app en https://developer.tidal.com/dashboard
  tidalClientId: '',
  // URL del Cloudflare Worker que hace de proxy de setlist.fm (carpeta worker/)
  setlistProxyUrl: '',
  // Opcional: URI de redirección OAuth. Por defecto, la URL de esta página.
  redirectUri: '',
};
