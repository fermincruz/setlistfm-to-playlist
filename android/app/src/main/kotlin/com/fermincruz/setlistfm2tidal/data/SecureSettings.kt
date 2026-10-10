package com.fermincruz.setlistfm2tidal.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecureSettings(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context,
        "private_settings",
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var setlistFmApiKey: String
        get() = preferences.getString(KEY_SETLISTFM_API_KEY, "").orEmpty()
        set(value) = preferences.edit().putString(KEY_SETLISTFM_API_KEY, value).apply()

    fun readTidalAuthState(): String? = preferences.getString(KEY_TIDAL_AUTH_STATE, null)

    fun writeTidalAuthState(value: String) {
        preferences.edit().putString(KEY_TIDAL_AUTH_STATE, value).apply()
    }

    fun clearTidalAuthState() {
        preferences.edit().remove(KEY_TIDAL_AUTH_STATE).apply()
    }

    fun clearSetlistFmApiKey() {
        preferences.edit().remove(KEY_SETLISTFM_API_KEY).apply()
    }

    private companion object {
        const val KEY_SETLISTFM_API_KEY = "setlistfm_api_key"
        const val KEY_TIDAL_AUTH_STATE = "tidal_auth_state"
    }
}