package com.fermincruz.setlistfm2tidal

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.fermincruz.setlistfm2tidal.domain.SetlistInfo
import com.fermincruz.setlistfm2tidal.domain.SetlistSong
import com.fermincruz.setlistfm2tidal.domain.TrackCandidate
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class PlaylistScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun switchesBetweenUrlAndArtistModes() {
        var selectedMode: SetlistInputMode? = null
        showScreen(onModeSelected = { selectedMode = it })

        composeRule.onNodeWithText("Artista").performClick()

        assertEquals(SetlistInputMode.ARTIST, selectedMode)
    }

    @Test
    fun letsTheUserChooseOrSkipAnAmbiguousTrack() {
        val track = TrackCandidate("track-1", "Song", "Artist", "Album", 180)
        var chosenTrack: TrackCandidate? = null
        var skipped = false
        showScreen(
            state = PlaylistUiState(
                setlist = sampleSetlist,
                stage = PlaylistStage.MATCHING,
                currentSong = SetlistSong("Song"),
                candidates = listOf(track),
            ),
            onChooseCandidate = { chosenTrack = it },
            onSkipSong = { skipped = true },
        )

        composeRule.onNodeWithText("Artist - Song").performClick()
        composeRule.onNodeWithText("Omitir esta canción").performClick()

        assertEquals(track, chosenTrack)
        assertEquals(true, skipped)
    }

    @Test
    fun doesNotEnableCreationWithNoResolvedTracks() {
        showScreen(
            state = PlaylistUiState(
                setlist = sampleSetlist,
                stage = PlaylistStage.READY_TO_CREATE,
                selectedTrackCount = 0,
            ),
        )

        composeRule.onNodeWithText("Crear playlist en TIDAL")
            .assertExists()
            .assertIsNotEnabled()
    }

    private fun showScreen(
        state: PlaylistUiState = PlaylistUiState(),
        onModeSelected: (SetlistInputMode) -> Unit = {},
        onChooseCandidate: (TrackCandidate) -> Unit = {},
        onSkipSong: () -> Unit = {},
    ) {
        composeRule.setContent {
            PlaylistScreen(
                state = state,
                onApiKeyChanged = {},
                onSaveApiKey = {},
                onClearApiKey = {},
                onModeSelected = onModeSelected,
                onInputChanged = {},
                onFindSetlist = {},
                onConnectTidal = {},
                onDisconnectTidal = {},
                onResolveSongs = {},
                onChooseCandidate = onChooseCandidate,
                onSkipSong = onSkipSong,
                onRetryResolution = {},
                onCreatePlaylist = {},
                onStartOver = {},
            )
        }
    }

    private companion object {
        val sampleSetlist = SetlistInfo(
            artist = "Artist",
            venue = "Venue",
            city = "Madrid",
            country = "Spain",
            eventDate = "01-02-2024",
            url = "https://www.setlist.fm/setlist/artist/2024/venue-2bd6a1e3.html",
            songs = listOf(SetlistSong("Song")),
        )
    }
}