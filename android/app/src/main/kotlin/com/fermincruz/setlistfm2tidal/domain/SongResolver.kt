package com.fermincruz.setlistfm2tidal.domain

import java.util.Locale

object SongResolver {
    fun resolve(
        song: SetlistSong,
        setlistArtist: String,
        candidates: List<TrackCandidate>,
    ): SongResolution {
        if (song.isTape) return SongResolution.Ignore
        if (candidates.isEmpty()) return SongResolution.NotFound

        val searchArtist = song.coverArtist ?: setlistArtist
        val exact = candidates.firstOrNull {
            normalize(it.artist) == normalize(searchArtist) &&
                normalize(it.title) == normalize(song.name)
        }
        if (exact != null) return SongResolution.Selected(exact)

        val sameArtist = candidates.firstOrNull { normalize(it.artist) == normalize(searchArtist) }
        if (sameArtist != null) return SongResolution.Selected(sameArtist)
        if (candidates.size == 1) return SongResolution.Selected(candidates.single())
        return SongResolution.NeedsChoice(candidates)
    }

    private fun normalize(value: String): String = value.trim().lowercase(Locale.ROOT)
}