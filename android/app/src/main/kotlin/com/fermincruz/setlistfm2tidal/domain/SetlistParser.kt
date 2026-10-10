package com.fermincruz.setlistfm2tidal.domain

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.net.URI

object SetlistParser {
    private val setlistIdPattern = Regex("-([a-fA-F0-9]+)\\.html$")

    fun extractSetlistId(url: String): String? {
        val parsedUrl = runCatching { URI(url.trim()) }.getOrNull() ?: return null
        val host = parsedUrl.host?.lowercase() ?: return null
        if (parsedUrl.scheme !in setOf("http", "https")) return null
        if (host !in setOf("setlist.fm", "www.setlist.fm")) return null
        return setlistIdPattern.find(parsedUrl.path.orEmpty())?.groupValues?.get(1)
    }

    fun parseSetlist(json: String, fallbackUrl: String = ""): SetlistInfo {
        val root = JsonParser.parseString(json).asJsonObject
        val venue = root.objectOrEmpty("venue")
        val city = venue.objectOrEmpty("city")
        val songs = root.objectOrEmpty("sets")
            .arrayOrEmpty("set")
            .flatMap { set ->
                set.asJsonObjectOrEmpty()
                    .arrayOrEmpty("song")
                    .mapNotNull { songElement -> songElement.asSongOrNull() }
            }

        return SetlistInfo(
            artist = root.objectOrEmpty("artist").stringOrEmpty("name", "Desconocido"),
            venue = venue.stringOrEmpty("name"),
            city = city.stringOrEmpty("name"),
            country = city.objectOrEmpty("country").stringOrEmpty("name"),
            eventDate = root.stringOrEmpty("eventDate"),
            url = root.stringOrEmpty("url", fallbackUrl),
            songs = songs,
        )
    }

    fun hasSongs(json: String): Boolean = parseSetlist(json).songs.isNotEmpty()

    private fun JsonElement.asSongOrNull(): SetlistSong? {
        if (!isJsonObject) return null
        val song = asJsonObject
        val name = song.stringOrEmpty("name").takeIf(String::isNotBlank) ?: return null
        return SetlistSong(
            name = name,
            coverArtist = song.objectOrEmpty("cover").stringOrEmpty("name").ifBlank { null },
            isTape = song.booleanOrFalse("tape"),
        )
    }

    private fun JsonElement.asJsonObjectOrEmpty(): JsonObject =
        if (isJsonObject) asJsonObject else JsonObject()

    private fun JsonObject.objectOrEmpty(name: String): JsonObject =
        get(name)?.takeIf(JsonElement::isJsonObject)?.asJsonObject ?: JsonObject()

    private fun JsonObject.arrayOrEmpty(name: String): List<JsonElement> =
        get(name)?.takeIf(JsonElement::isJsonArray)?.asJsonArray?.toList().orEmpty()

    private fun JsonObject.stringOrEmpty(name: String, default: String = ""): String =
        get(name)?.takeIf(JsonElement::isJsonPrimitive)?.asString ?: default

    private fun JsonObject.booleanOrFalse(name: String): Boolean =
        get(name)?.takeIf(JsonElement::isJsonPrimitive)?.let {
            runCatching { it.asBoolean }.getOrDefault(false)
        } ?: false
}