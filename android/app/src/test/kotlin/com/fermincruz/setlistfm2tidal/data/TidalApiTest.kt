package com.fermincruz.setlistfm2tidal.data

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TidalApiTest {
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
    fun createsPlaylistAndAddsTracksUsingJsonApiRelationships() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"data":{"id":"playlist-1"}}"""))
        server.enqueue(MockResponse().setBody("""{"data":[]}"""))
        val api = TidalApi(OkHttpClient(), server.url("/v2/").toString().toHttpUrl())

        val created = api.createPlaylist("access-token", "Artist - Venue", "from setlist", listOf("10", "11"))

        assertEquals("playlist-1", created.id)
        assertEquals(2, created.trackCount)
        assertTrue(created.url.endsWith("/playlist/playlist-1"))
        val createRequest = server.takeRequest()
        assertEquals("POST", createRequest.method)
        assertEquals("Bearer access-token", createRequest.getHeader("Authorization"))
        assertTrue(createRequest.body.readUtf8().contains("\"name\":\"Artist - Venue\""))
        val addRequest = server.takeRequest()
        assertEquals("/v2/playlists/playlist-1/relationships/items", addRequest.path)
        assertTrue(addRequest.body.readUtf8().contains("\"type\":\"tracks\""))
    }

    @Test(expected = IllegalArgumentException::class)
    fun doesNotCreateEmptyPlaylist() = runBlocking {
        TidalApi(OkHttpClient(), server.url("/v2/").toString().toHttpUrl())
            .createPlaylist("access-token", "title", "", emptyList())
    }
}