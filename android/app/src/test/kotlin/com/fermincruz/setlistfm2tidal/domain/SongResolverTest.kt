package com.fermincruz.setlistfm2tidal.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SongResolverTest {
    private val studio = TrackCandidate("1", "Song", "The Artist", "Album", 180)
    private val live = TrackCandidate("2", "Song - Live", "Other Artist", "Live", 200)

    @Test
    fun ignoresTapeAndReportsMissingTracks() {
        assertEquals(
            SongResolution.Ignore,
            SongResolver.resolve(SetlistSong("Intro", isTape = true), "The Artist", listOf(studio)),
        )
        assertEquals(
            SongResolution.NotFound,
            SongResolver.resolve(SetlistSong("Unknown"), "The Artist", emptyList()),
        )
    }

    @Test
    fun prefersExactArtistAndTitleWithoutCaseSensitivity() {
        val resolution = SongResolver.resolve(
            SetlistSong("song"),
            "the artist",
            listOf(live, studio),
        )
        assertEquals(SongResolution.Selected(studio), resolution)
    }

    @Test
    fun usesCoverArtistForSearchMatching() {
        val cover = TrackCandidate("3", "Song", "Original Artist", "Album", 180)
        assertEquals(
            SongResolution.Selected(cover),
            SongResolver.resolve(
                SetlistSong("Song", coverArtist = "Original Artist"),
                "The Artist",
                listOf(cover),
            ),
        )
    }

    @Test
    fun asksForAChoiceWhenSeveralCandidatesRemain() {
        val resolution = SongResolver.resolve(
            SetlistSong("Song"),
            "The Artist",
            listOf(live, studio.copy(artist = "Another Artist")),
        )
        assertTrue(resolution is SongResolution.NeedsChoice)
    }
}