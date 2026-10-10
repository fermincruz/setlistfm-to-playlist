package com.fermincruz.setlistfm2tidal.data

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.fermincruz.setlistfm2tidal.domain.TrackCandidate
import java.time.Duration
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class TidalApi(
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val baseUrl: HttpUrl = "https://openapi.tidal.com/v2/".toHttpUrl(),
) {
    suspend fun searchTracks(
        accessToken: String,
        artist: String,
        title: String,
        countryCode: String,
    ): List<TrackCandidate> {
        val query = "$artist $title".trim()
        val url = baseUrl.newBuilder()
            .addPathSegment("searchResults")
            .addQueryParameter("filter[query]", query)
            .addQueryParameter("countryCode", countryCode)
            .addQueryParameter("include", "tracks.albums,tracks.artists")
            .build()
        val response = request("GET", url, accessToken)
        val included = response.get("included")?.takeIf(JsonElement::isJsonArray)?.asJsonArray
            ?: JsonArray()
        val resourcesById = included.mapNotNull { element ->
            element.takeIf(JsonElement::isJsonObject)?.asJsonObject?.let { it.stringOrNull("id") to it }
        }.filter { it.first != null }.associate { it.first!! to it.second }

        return included
            .mapNotNull { it.takeIf(JsonElement::isJsonObject)?.asJsonObject }
            .filter { it.stringOrNull("type") == "tracks" }
            .map { it.toTrackCandidate(resourcesById) }
            .take(MAX_TRACK_CANDIDATES)
    }

    suspend fun createPlaylist(
        accessToken: String,
        title: String,
        description: String,
        trackIds: List<String>,
        operationId: String = UUID.randomUUID().toString(),
    ): CreatedPlaylist {
        require(trackIds.isNotEmpty()) { "No hay canciones para añadir a la playlist." }
        val attributes = JsonObject().apply {
            addProperty("name", title.take(MAX_PLAYLIST_TITLE_LENGTH))
            addProperty("description", description.take(MAX_PLAYLIST_DESCRIPTION_LENGTH))
        }
        val data = JsonObject().apply {
            addProperty("type", "playlists")
            add("attributes", attributes)
        }
        val body = JsonObject().apply { add("data", data) }
        val playlistResponse = request(
            method = "POST",
            url = baseUrl.newBuilder().addPathSegment("playlists").build(),
            accessToken = accessToken,
            body = body,
            idempotencyKey = operationId,
        )
        val playlistId = playlistResponse.objectOrNull("data")?.stringOrNull("id")
            ?: throw TidalApiException(200, "TIDAL no devolvió el identificador de la playlist.")

        trackIds.chunked(MAX_TRACKS_PER_REQUEST).forEachIndexed { batchIndex, batch ->
            val items = JsonArray().apply {
                batch.forEach { id ->
                    add(JsonObject().apply {
                        addProperty("id", id)
                        addProperty("type", "tracks")
                    })
                }
            }
            val addBody = JsonObject().apply { add("data", items) }
            request(
                method = "POST",
                url = baseUrl.newBuilder()
                    .addPathSegment("playlists")
                    .addPathSegment(playlistId)
                    .addPathSegment("relationships")
                    .addPathSegment("items")
                    .build(),
                accessToken = accessToken,
                body = addBody,
                idempotencyKey = "$operationId-$batchIndex",
            )
        }

        return CreatedPlaylist(
            id = playlistId,
            url = "https://tidal.com/browse/playlist/$playlistId",
            trackCount = trackIds.size,
        )
    }

    private suspend fun request(
        method: String,
        url: HttpUrl,
        accessToken: String,
        body: JsonObject? = null,
        idempotencyKey: String? = null,
    ): JsonObject = withContext(Dispatchers.IO) {
        require(accessToken.isNotBlank()) { "Autoriza la aplicación en TIDAL para continuar." }
        val requestBody = body?.toString()?.toRequestBody(JSON_API_MEDIA_TYPE)
        val builder = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $accessToken")
            .header("Accept", JSON_API_CONTENT_TYPE)
            .header("Content-Type", JSON_API_CONTENT_TYPE)
        if (idempotencyKey != null) builder.header("Idempotency-Key", idempotencyKey)
        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post(requireNotNull(requestBody))
            else -> error("Método HTTP no soportado.")
        }

        httpClient.newCall(builder.build()).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val message = when (response.code) {
                    401, 403 -> "TIDAL rechazó el acceso. Reautoriza la aplicación o revisa sus permisos de playlist."
                    else -> "Error de TIDAL (${response.code})."
                }
                throw TidalApiException(response.code, message)
            }
            if (responseBody.isBlank()) JsonObject() else JsonParser.parseString(responseBody).asJsonObject
        }
    }

    private fun JsonObject.toTrackCandidate(resourcesById: Map<String, JsonObject>): TrackCandidate {
        val attributes = objectOrNull("attributes") ?: JsonObject()
        val relationships = objectOrNull("relationships") ?: JsonObject()
        val artistId = relationships.resourceId("artists")
        val albumId = relationships.resourceId("albums")
        val duration = attributes.stringOrNull("duration")?.let {
            runCatching { Duration.parse(it).seconds.toInt() }.getOrNull()
        } ?: 0

        return TrackCandidate(
            id = stringOrNull("id").orEmpty(),
            title = attributes.stringOrNull("title").orEmpty(),
            artist = artistId?.let(resourcesById::get)?.objectOrNull("attributes")
                ?.stringOrNull("name").orEmpty(),
            album = albumId?.let(resourcesById::get)?.objectOrNull("attributes")
                ?.stringOrNull("title").orEmpty(),
            durationSeconds = duration,
            listenUrl = "https://tidal.com/browse/track/${stringOrNull("id").orEmpty()}",
        )
    }

    private fun JsonObject.resourceId(name: String): String? {
        val data = objectOrNull(name)?.get("data") ?: return null
        return when {
            data.isJsonArray -> data.asJsonArray.firstOrNull()?.takeIf(JsonElement::isJsonObject)
                ?.asJsonObject?.stringOrNull("id")
            data.isJsonObject -> data.asJsonObject.stringOrNull("id")
            else -> null
        }
    }

    private fun JsonObject.objectOrNull(name: String): JsonObject? =
        get(name)?.takeIf(JsonElement::isJsonObject)?.asJsonObject

    private fun JsonObject.stringOrNull(name: String): String? =
        get(name)?.takeIf(JsonElement::isJsonPrimitive)?.asString

    companion object {
        private const val MAX_TRACK_CANDIDATES = 5
        private const val MAX_TRACKS_PER_REQUEST = 50
        private const val MAX_PLAYLIST_TITLE_LENGTH = 250
        private const val MAX_PLAYLIST_DESCRIPTION_LENGTH = 500
        private const val JSON_API_CONTENT_TYPE = "application/vnd.api+json"
        private val JSON_API_MEDIA_TYPE = JSON_API_CONTENT_TYPE.toMediaType()
    }
}

data class CreatedPlaylist(val id: String, val url: String, val trackCount: Int)

class TidalApiException(val statusCode: Int, message: String) : Exception(message)