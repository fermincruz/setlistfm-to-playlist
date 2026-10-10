package com.fermincruz.setlistfm2tidal.data

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class SetlistFmApiTest {
    private val server = MockWebServer()

    @Before
    fun startServer() {
        server.start()
    }

    @After
    fun stopServer() {
        server.shutdown()
    }

    @Test
    fun fetchSetlistSendsApiKeyAndParsesResponse() = runBlocking {
        server.enqueue(MockResponse().setBody("""
            {"artist":{"name":"Artist"},"venue":{"name":"Venue"},"eventDate":"01-02-2024",
             "sets":{"set":[{"song":[{"name":"Song"}]}]}}
        """.trimIndent()))
        val api = SetlistFmApi(OkHttpClient(), server.url("/1.0/").toString().toHttpUrl())

        val setlist = api.fetchSetlist(
            "https://www.setlist.fm/setlist/artist/2024/venue-2bd6a1e3.html",
            "test-key",
        )

        assertEquals("Artist", setlist.artist)
        assertEquals("Song", setlist.songs.single().name)
        val request = server.takeRequest()
        assertEquals("test-key", request.getHeader("x-api-key"))
        assertEquals("/1.0/setlist/2bd6a1e3", request.path)
    }
}