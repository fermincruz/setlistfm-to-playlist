package com.fermincruz.setlistfm2tidal.data

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.fermincruz.setlistfm2tidal.domain.SetlistInfo
import com.fermincruz.setlistfm2tidal.domain.SetlistParser
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

class SetlistFmApi(
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val baseUrl: HttpUrl = "https://api.setlist.fm/rest/1.0/".toHttpUrl(),
) {
    private val requestMutex = Mutex()
    private var lastRequestAt = 0L

    suspend fun fetchSetlist(url: String, apiKey: String): SetlistInfo {
        val id = SetlistParser.extractSetlistId(url)
            ?: throw IllegalArgumentException("La URL no parece ser un setlist válido de setlist.fm.")
        val response = get("setlist/$id", apiKey)
        return SetlistParser.parseSetlist(response.toString(), url)
    }

    suspend fun findLatestSetlistForArtist(
        artist: String,
        apiKey: String,
        maxPages: Int = MAX_ARTIST_PAGES,
    ): SetlistInfo {
        require(artist.isNotBlank()) { "Introduce el nombre de un artista." }
        val entries = mutableListOf<JsonObject>()
        var page = 1
        var totalPages = 1

        while (page <= maxPages && page <= totalPages) {
            val query = mapOf("artistName" to artist, "p" to page.toString())
            val response = get("search/setlists", apiKey, query)
            val setlists = response.get("setlist")?.takeIf(JsonElement::isJsonArray)?.asJsonArray
            if (setlists == null || setlists.size() == 0) break
            setlists.mapNotNullTo(entries) { it.takeIf(JsonElement::isJsonObject)?.asJsonObject }

            val itemsPerPage = response.intOr("itemsPerPage", setlists.size()).coerceAtLeast(1)
            val total = response.intOr("total", setlists.size())
            totalPages = (total + itemsPerPage - 1) / itemsPerPage
            page += 1
        }

        val latest = entries
            .sortedByDescending { it.eventDateOrMinimum() }
            .firstOrNull { setlist -> SetlistParser.hasSongs(setlist.toString()) }
            ?: throw IllegalStateException("No se encontraron conciertos con canciones para '$artist'.")

        return SetlistParser.parseSetlist(latest.toString(), latest.stringOr("url"))
    }

    private suspend fun get(
        path: String,
        apiKey: String,
        query: Map<String, String> = emptyMap(),
    ): JsonObject = withContext(Dispatchers.IO) {
        require(apiKey.isNotBlank()) { "Introduce tu API key de setlist.fm." }
        var attempt = 0
        while (true) {
            throttle()
            val urlBuilder = baseUrl.newBuilder().addPathSegments(path)
            query.forEach { (name, value) -> urlBuilder.addQueryParameter(name, value) }
            val request = Request.Builder()
                .url(urlBuilder.build())
                .header("x-api-key", apiKey)
                .header("Accept", "application/json")
                .get()
                .build()

            var shouldRetry = false
            httpClient.newCall(request).execute().use { response ->
                if (response.code == 429 && attempt < MAX_RATE_RETRIES) {
                    val retryAfter = response.header("Retry-After")?.toLongOrNull()?.coerceIn(1, 30) ?: 1L
                    attempt += 1
                    delay(retryAfter * 1000)
                    shouldRetry = true
                } else if (!response.isSuccessful) {
                    val message = when (response.code) {
                        401, 403 -> "La API key de setlist.fm no es válida o no tiene permisos."
                        404 -> "No se encontró el setlist indicado."
                        429 -> "Se alcanzó el límite de peticiones de setlist.fm. Espera y vuelve a intentarlo."
                        else -> "Error de setlist.fm (${response.code})."
                    }
                    throw SetlistFmApiException(response.code, message)
                } else {
                    return@withContext JsonParser.parseString(response.body?.string().orEmpty()).asJsonObject
                }
            }
            if (shouldRetry) continue
        }
        error("No se pudo completar la solicitud a setlist.fm.")
    }

    private suspend fun throttle() = requestMutex.withLock {
        val waitMillis = MIN_REQUEST_INTERVAL_MS - (System.currentTimeMillis() - lastRequestAt)
        if (waitMillis > 0) delay(waitMillis)
        lastRequestAt = System.currentTimeMillis()
    }

    private fun JsonObject.intOr(name: String, default: Int): Int =
        get(name)?.takeIf(JsonElement::isJsonPrimitive)?.let { runCatching { it.asInt }.getOrDefault(default) } ?: default

    private fun JsonObject.stringOr(name: String, default: String = ""): String =
        get(name)?.takeIf(JsonElement::isJsonPrimitive)?.asString ?: default

    private fun JsonObject.eventDateOrMinimum(): LocalDate = runCatching {
        LocalDate.parse(stringOr("eventDate"), EVENT_DATE_FORMAT)
    }.getOrDefault(LocalDate.MIN)

    companion object {
        private const val MAX_ARTIST_PAGES = 5
        private const val MAX_RATE_RETRIES = 3
        private const val MIN_REQUEST_INTERVAL_MS = 600L
        private val EVENT_DATE_FORMAT = DateTimeFormatter.ofPattern("dd-MM-yyyy", Locale.ROOT)
    }
}

class SetlistFmApiException(val statusCode: Int, message: String) : Exception(message)