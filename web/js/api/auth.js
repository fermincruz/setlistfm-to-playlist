// Inicio de sesión en TIDAL con OAuth 2.1 Authorization Code + PKCE.
// La contraseña se introduce solo en la web de TIDAL; aquí solo se guardan tokens.
import { ApiError } from './errors.js';

export const AUTHORIZE_URL = 'https://login.tidal.com/authorize';
export const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
// Scopes disponibles para apps de terceros (nivel THIRD_PARTY).
export const SCOPES = ['user.read', 'search.read', 'playlists.read', 'playlists.write'];

const TOKENS_KEY = 'tidal:tokens';
const PKCE_KEY = 'tidal:pkce';
const EXPIRY_MARGIN_MS = 60_000;

export function base64Url(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(byteLength = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(digest);
}

export function createAuth({
  clientId,
  redirectUri,
  localStore,
  sessionStore,
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = () => Date.now(),
}) {
  let refreshing = null;

  function saveTokens(json, previous = {}) {
    const tokens = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? previous.refreshToken ?? null,
      expiresAt: now() + (Number(json.expires_in) || 3600) * 1000,
      userId: json.user_id ?? previous.userId ?? null,
    };
    localStore.set(TOKENS_KEY, tokens);
    return tokens;
  }

  async function tokenRequest(params) {
    let response;
    try {
      response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, ...params }).toString(),
      });
    } catch (error) {
      throw new ApiError('network', { detail: String(error) });
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError('tidal_auth_failed', { status: response.status, detail: json.error ?? '' });
    return json;
  }

  async function refresh(tokens) {
    if (!tokens?.refreshToken) throw new ApiError('tidal_not_connected');
    try {
      const json = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
      return saveTokens(json, tokens);
    } catch (error) {
      if (error.code === 'tidal_auth_failed') {
        localStore.remove(TOKENS_KEY);
        throw new ApiError('tidal_session_expired');
      }
      throw error;
    }
  }

  return {
    isConfigured: Boolean(clientId),

    isConnected() {
      return Boolean(localStore.get(TOKENS_KEY)?.accessToken);
    },

    /** Construye la URL de autorización y guarda el verificador PKCE. */
    async authorizationUrl(resume = null) {
      if (!clientId) throw new ApiError('tidal_not_configured');
      const verifier = randomString(48);
      const state = randomString(16);
      sessionStore.set(PKCE_KEY, { verifier, state, redirectUri, resume });
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPES.join(' '),
        code_challenge_method: 'S256',
        code_challenge: await codeChallenge(verifier),
        state,
      }).toString();
      return url.toString();
    },

    /**
     * Procesa la vuelta desde TIDAL. Devuelve null si la URL no es una
     * respuesta OAuth, o { resume } con lo que se guardó antes de salir.
     */
    async handleRedirect(currentUrl) {
      const params = new URL(currentUrl).searchParams;
      if (!params.has('code') && !params.has('error')) return null;
      const pending = sessionStore.get(PKCE_KEY);
      sessionStore.remove(PKCE_KEY);
      if (params.has('error')) {
        throw new ApiError('tidal_auth_denied', { detail: params.get('error') ?? '' });
      }
      if (!pending || pending.state !== params.get('state')) throw new ApiError('tidal_auth_state');
      const json = await tokenRequest({
        grant_type: 'authorization_code',
        code: params.get('code'),
        redirect_uri: pending.redirectUri,
        code_verifier: pending.verifier,
      });
      saveTokens(json);
      return { resume: pending.resume };
    },

    async getAccessToken({ forceRefresh = false } = {}) {
      const tokens = localStore.get(TOKENS_KEY);
      if (!tokens?.accessToken) throw new ApiError('tidal_not_connected');
      if (!forceRefresh && tokens.expiresAt - EXPIRY_MARGIN_MS > now()) return tokens.accessToken;
      // Evita refrescos simultáneos desde búsquedas en paralelo.
      refreshing ??= refresh(tokens).finally(() => {
        refreshing = null;
      });
      return (await refreshing).accessToken;
    },

    disconnect() {
      localStore.remove(TOKENS_KEY);
    },
  };
}
