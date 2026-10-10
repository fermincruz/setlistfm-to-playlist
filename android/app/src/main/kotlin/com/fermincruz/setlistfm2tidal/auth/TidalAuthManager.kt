package com.fermincruz.setlistfm2tidal.auth

import android.content.Context
import android.content.Intent
import android.net.Uri
import net.openid.appauth.AuthState
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.ResponseTypeValues
import com.fermincruz.setlistfm2tidal.data.SecureSettings
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

class TidalAuthManager(
    context: Context,
    private val clientId: String,
    private val settings: SecureSettings,
) {
    private val appContext = context.applicationContext
    private val serviceConfiguration = AuthorizationServiceConfiguration(
        Uri.parse(AUTHORIZATION_ENDPOINT),
        Uri.parse(TOKEN_ENDPOINT),
    )
    private val authorizationService = AuthorizationService(appContext)

    val isConfigured: Boolean
        get() = clientId.isNotBlank()

    fun authorizationIntent(): Intent {
        check(isConfigured) { "La aplicación no tiene configurado el Client ID de TIDAL." }
        val request = AuthorizationRequest.Builder(
            serviceConfiguration,
            clientId,
            ResponseTypeValues.CODE,
            Uri.parse(REDIRECT_URI),
        )
            .setScopes(*REQUIRED_SCOPES)
            .build()
        return authorizationService.getAuthorizationRequestIntent(request)
    }

    suspend fun completeAuthorization(intent: Intent?) {
        val response = AuthorizationResponse.fromIntent(intent)
        val exception = AuthorizationException.fromIntent(intent)
        val state = AuthState(serviceConfiguration)
        state.update(response, exception)
        if (response == null) {
            throw exception ?: IllegalStateException("No se recibió respuesta de TIDAL.")
        }

        suspendCancellableCoroutine { continuation ->
            authorizationService.performTokenRequest(response.createTokenExchangeRequest()) { token, tokenException ->
                state.update(token, tokenException)
                persist(state)
                if (token != null) {
                    continuation.resume(Unit)
                } else {
                    continuation.resumeWithException(
                        tokenException ?: IllegalStateException("No se pudo completar el acceso a TIDAL."),
                    )
                }
            }
        }
    }

    suspend fun freshAccessToken(): String = suspendCancellableCoroutine { continuation ->
        val state = readState()
        if (state == null || !state.isAuthorized) {
            continuation.resumeWithException(IllegalStateException("Inicia sesión en TIDAL para continuar."))
            return@suspendCancellableCoroutine
        }

        state.performActionWithFreshTokens(authorizationService) { accessToken, _, exception ->
            persist(state)
            if (accessToken != null) {
                continuation.resume(accessToken)
            } else {
                continuation.resumeWithException(
                    exception ?: IllegalStateException("La sesión de TIDAL ha caducado. Vuelve a autorizar la app."),
                )
            }
        }
    }

    fun isAuthorized(): Boolean = readState()?.isAuthorized == true

    fun disconnect() {
        settings.clearTidalAuthState()
    }

    private fun readState(): AuthState? = settings.readTidalAuthState()?.let {
        runCatching { AuthState.jsonDeserialize(it) }.getOrNull()
    }

    private fun persist(state: AuthState) {
        settings.writeTidalAuthState(state.jsonSerializeString())
    }

    private companion object {
        const val AUTHORIZATION_ENDPOINT = "https://login.tidal.com/authorize"
        const val TOKEN_ENDPOINT = "https://auth.tidal.com/v1/oauth2/token"
        const val REDIRECT_URI = "com.fermincruz.setlistfm2tidal:/oauth2redirect"
        val REQUIRED_SCOPES = arrayOf("r_usr", "search.read", "playlists.write", "w_usr")
    }
}