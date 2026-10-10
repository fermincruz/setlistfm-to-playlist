package com.fermincruz.setlistfm2tidal.domain

data class SetlistSong(
    val name: String,
    val coverArtist: String? = null,
    val isTape: Boolean = false,
)

data class SetlistInfo(
    val artist: String,
    val venue: String,
    val city: String,
    val country: String,
    val eventDate: String,
    val url: String,
    val songs: List<SetlistSong>,
) {
    val playlistTitle: String
        get() = "$artist - $venue ($eventDate)"
}

data class TrackCandidate(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val durationSeconds: Int,
    val listenUrl: String? = null,
)

data class PlaylistCreationResult(
    val title: String,
    val url: String,
    val addedTrackCount: Int,
    val setlistSongCount: Int,
    val notFoundSongs: List<String>,
)

sealed interface SongResolution {
    data object Ignore : SongResolution
    data object NotFound : SongResolution
    data class Selected(val track: TrackCandidate) : SongResolution
    data class NeedsChoice(val candidates: List<TrackCandidate>) : SongResolution
}