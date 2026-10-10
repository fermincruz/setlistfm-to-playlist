package com.fermincruz.setlistfm2tidal.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SetlistParserTest {
    @Test
    fun extractsOnlySetlistFmIds() {
        assertEquals(
            "2bd6a1e3",
            SetlistParser.extractSetlistId(
                "https://www.setlist.fm/setlist/artist/2023/venue-2bd6a1e3.html?x=1",
            ),
        )
        assertNull(SetlistParser.extractSetlistId("https://example.com/setlist-2bd6a1e3.html"))
        assertNull(SetlistParser.extractSetlistId("https://setlist.fm/setlist/no-id.html"))
    }

    @Test
    fun parsesSongsCoversTapesAndFallbackFields() {
        val json = """
            {
              "artist":{"name":"The Artist"},
              "venue":{"name":"The Hall","city":{"name":"Madrid","country":{"name":"Spain"}}},
              "eventDate":"01-02-2024",
              "sets":{"set":[{"song":[
                {"name":"Opening","tape":true},
                {"name":"Song","cover":{"name":"Original Artist"}},
                {"name":""},
                {}
              ]}]}
            }
        """.trimIndent()

        val setlist = SetlistParser.parseSetlist(json, "fallback")

        assertEquals("The Artist - The Hall (01-02-2024)", setlist.playlistTitle)
        assertEquals("Madrid", setlist.city)
        assertEquals("fallback", setlist.url)
        assertEquals(2, setlist.songs.size)
        assertTrue(setlist.songs.first().isTape)
        assertEquals("Original Artist", setlist.songs.last().coverArtist)
    }

    @Test
    fun acceptsAnEmptySetlist() {
        assertFalse(SetlistParser.hasSongs("""{"sets":{"set":[]}}"""))
    }
}