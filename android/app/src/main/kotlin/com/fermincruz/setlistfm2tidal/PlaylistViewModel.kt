package com.fermincruz.setlistfm2tidal

import android.app.Application
import android.content.Intent
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.fermincruz.setlistfm2tidal.auth.TidalAuthManager
import com.fermincruz.setlistfm2tidal.data.SecureSettings
import com.fermincruz.setlistfm2tidal.data.SetlistFmApi
import com.fermincruz.setlistfm2tidal.data.TidalApi
import com.fermincruz.setlistfm2tidal.domain.PlaylistCreationResult
import com.fermincruz.setlistfm2tidal.domain.SetlistInfo
import com.fermincruz.setlistfm2tidal.domain.SetlistSong
import com.fermincruz.setlistfm2tidal.domain.SongResolution
import com.fermincruz.setlistfm2tidal.domain.SongResolver
import com.fermincruz.setlistfm2tidal.domain.TrackCandidate
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class PlaylistViewModel(application: Application) : AndroidViewModel(application) {
    private val settings = SecureSettings(application)
    private val setlistFmApi = SetlistFmApi()
    private val tidalApi = TidalApi()
    private val tidalAuth = TidalAuthManager(application, BuildConfig.TIDAL_CLIENT_ID, settings)
    private val mutableState = MutableStateFlow(
        PlaylistUiState(
            apiKey = settings.setlistFmApiKey,
            apiKeySaved = settings.setlistFmApiKey.isNotBlank(),
            tidalConfigured = tidalAuth.isConfigured,
            tidalAuthorized = tidalAuth.isAuthorized(),
        ),
    )
    val state: StateFlow<PlaylistUiState> = mutableState.asStateFlow()

    private var resolutionProgress: ResolutionProgress? = null
    private var createOperationId: String? = null

    fun updateApiKey(value: String) {
        mutableState.value = mutableState.value.copy(apiKey = value, apiKeySaved = false)
    }

    fun saveApiKey() {
        val key = mutableState.value.apiKey.trim()
        if (key.isEmpty()) {
            showMessage("Introduce la API key de setlist.fm.")
            return
        }
        settings.setlistFmApiKey = key
        mutableState.value = mutableState.value.copy(
            apiKey = key,
            apiKeySaved = true,
            message = null,
        )
    }

    fun clearApiKey() {
        settings.clearSetlistFmApiKey()
        mutableState.value = mutableState.value.copy(apiKey = "", apiKeySaved = false)
    }

    fun selectMode(mode: SetlistInputMode) {
        resolutionProgress = null
        createOperationId = null
        mutableState.value = mutableState.value.copy(
            inputMode = mode,
            input = "",
            setlist = null,
            currentSong = null,
            candidates = emptyList(),
            selectedTrackCount = 0,
            notFoundSongs = emptyList(),
            canRetryResolution = false,
            result = null,
            stage = PlaylistStage.INPUT,
            message = null,
        )
    }

    fun updateInput(value: String) {
        mutableState.value = mutableState.value.copy(input = value, message = null)
    }

    fun showMessage(message: String) {
        mutableState.value = mutableState.value.copy(message = message)
    }

    fun authorizationIntent(): Intent = tidalAuth.authorizationIntent()

    suspend fun completeAuthorization(intent: Intent?) {
        mutableState.value = mutableState.value.copy(busy = true, message = null)
        runCatching { tidalAuth.completeAuthorization(intent) }
            .onSuccess {
                mutableState.value = mutableState.value.copy(
                    busy = false,
                    tidalAuthorized = true,
                    message = null,
                )
            }
            .onFailure { error ->
                mutableState.value = mutableState.value.copy(
                    busy = false,
                    tidalAuthorized = tidalAuth.isAuthorized(),
                    message = error.message ?: "No se pudo autorizar la cuenta de TIDAL.",
                )
            }
    }

    fun disconnectTidal() {
        tidalAuth.disconnect()
        mutableState.value = mutableState.value.copy(
            tidalAuthorized = false,
            message = null,
        )
    }

    fun findSetlist() {
        val current = mutableState.value
        if (current.apiKey.isBlank() || current.input.isBlank()) return
        settings.setlistFmApiKey = current.apiKey.trim()
        mutableState.value = current.copy(
            apiKey = current.apiKey.trim(),
            apiKeySaved = true,
            busy = true,
            message = null,
            progressMessage = "Obteniendo setlist...",
            setlist = null,
            stage = PlaylistStage.INPUT,
            result = null,
            canRetryResolution = false,
        )
        resolutionProgress = null
        createOperationId = null

        viewModelScope.launch {
            runCatching {
                when (current.inputMode) {
                    SetlistInputMode.URL -> setlistFmApi.fetchSetlist(current.input.trim(), current.apiKey.trim())
                    SetlistInputMode.ARTIST -> setlistFmApi.findLatestSetlistForArtist(
                        current.input.trim(),
                        current.apiKey.trim(),
                    )
                }
            }.onSuccess { setlist ->
                mutableState.value = mutableState.value.copy(
                    busy = false,
                    progressMessage = null,
                    setlist = setlist,
                    stage = PlaylistStage.REVIEW,
                    message = null,
                )
            }.onFailure { error ->
                mutableState.value = mutableState.value.copy(
                    busy = false,
                    progressMessage = null,
                    message = error.message ?: "No se pudo obtener el setlist.",
                )
            }
        }
    }

    fun resolveSongs() {
        val setlist = mutableState.value.setlist ?: return
        if (!mutableState.value.tidalAuthorized) {
            showMessage("Conecta primero tu cuenta de TIDAL.")
            return
        }
        resolutionProgress = ResolutionProgress(setlist)
        createOperationId = UUID.randomUUID().toString()
        continueResolution()
    }

    fun retryResolution() {
        if (resolutionProgress != null) continueResolution()
    }

    fun chooseCandidate(candidate: TrackCandidate) {
        val progress = resolutionProgress ?: return
        progress.selectedTracks.add(candidate)
        progress.currentIndex += 1
        mutableState.value = mutableState.value.copy(
            candidates = emptyList(),
            currentSong = null,
            selectedTrackCount = progress.selectedTracks.size,
            message = null,
        )
        continueResolution()
    }

    fun skipSong() {
        val progress = resolutionProgress ?: return
        progress.notFoundSongs.add(progress.setlist.songs[progress.currentIndex].name)
        progress.currentIndex += 1
        mutableState.value = mutableState.value.copy(
            candidates = emptyList(),
            currentSong = null,
            notFoundSongs = progress.notFoundSongs.toList(),
            message = null,
        )
        continueResolution()
    }

    fun createPlaylist() {
        val progress = resolutionProgress ?: return
        if (progress.selectedTracks.isEmpty()) return
        mutableState.value = mutableState.value.copy(
            busy = true,
            message = null,
            progressMessage = "Creando playlist en TIDAL...",
        )
        viewModelScope.launch {
            runCatching {
                tidalApi.createPlaylist(
                    accessToken = tidalAuth.freshAccessToken(),
                    title = progress.setlist.playlistTitle,
                    description = "Generada automáticamente desde ${progress.setlist.url}",
                    trackIds = progress.selectedTracks.map(TrackCandidate::id),
                    operationId = requireNotNull(createOperationId),
                )
            }.onSuccess { playlist ->
                mutableState.value = mutableState.value.copy(
                    busy = false,
                    progressMessage = null,
                    stage = PlaylistStage.RESULT,
                    result = PlaylistCreationResult(
                        title = progress.setlist.playlistTitle,
                        url = playlist.url,
                        addedTrackCount = playlist.trackCount,
                        setlistSongCount = progress.setlist.songs.size,
                        notFoundSongs = progress.notFoundSongs.toList(),
                    ),
                    message = null,
                )
            }.onFailure { error ->
                mutableState.value = mutableState.value.copy(
                    busy = false,
                    progressMessage = null,
                    message = error.message ?: "No se pudo crear la playlist.",
                )
            }
        }
    }

    fun startOver() {
        resolutionProgress = null
        createOperationId = null
        mutableState.value = mutableState.value.copy(
            input = "",
            setlist = null,
            currentSong = null,
            candidates = emptyList(),
            selectedTrackCount = 0,
            notFoundSongs = emptyList(),
            canRetryResolution = false,
            result = null,
            message = null,
            progressMessage = null,
            stage = PlaylistStage.INPUT,
        )
    }

    private fun continueResolution() {
        val progress = resolutionProgress ?: return
        mutableState.value = mutableState.value.copy(
            stage = PlaylistStage.MATCHING,
            busy = true,
            currentSong = null,
            candidates = emptyList(),
            canRetryResolution = false,
            message = null,
        )
        viewModelScope.launch {
            try {
                while (progress.currentIndex < progress.setlist.songs.size) {
                    val song = progress.setlist.songs[progress.currentIndex]
                    if (song.isTape) {
                        progress.currentIndex += 1
                        continue
                    }
                    mutableState.value = mutableState.value.copy(
                        progressMessage = "Buscando ${progress.currentIndex + 1}/${progress.setlist.songs.size}: ${song.name}",
                    )
                    val artist = song.coverArtist ?: progress.setlist.artist
                    val candidates = tidalApi.searchTracks(
                        accessToken = tidalAuth.freshAccessToken(),
                        artist = artist,
                        title = song.name,
                        countryCode = Locale.getDefault().country.ifBlank { "US" },
                    )
                    when (val resolution = SongResolver.resolve(song, progress.setlist.artist, candidates)) {
                        SongResolution.Ignore -> Unit
                        SongResolution.NotFound -> progress.notFoundSongs.add(song.name)
                        is SongResolution.Selected -> progress.selectedTracks.add(resolution.track)
                        is SongResolution.NeedsChoice -> {
                            mutableState.value = mutableState.value.copy(
                                stage = PlaylistStage.MATCHING,
                                busy = false,
                                progressMessage = null,
                                currentSong = song,
                                candidates = resolution.candidates,
                                selectedTrackCount = progress.selectedTracks.size,
                                notFoundSongs = progress.notFoundSongs.toList(),
                                message = null,
                            )
                            return@launch
                        }
                    }
                    progress.currentIndex += 1
                    mutableState.value = mutableState.value.copy(
                        selectedTrackCount = progress.selectedTracks.size,
                        notFoundSongs = progress.notFoundSongs.toList(),
                    )
                }

                mutableState.value = if (progress.selectedTracks.isEmpty()) {
                    mutableState.value.copy(
                        stage = PlaylistStage.REVIEW,
                        busy = false,
                        progressMessage = null,
                        selectedTrackCount = 0,
                        notFoundSongs = progress.notFoundSongs.toList(),
                        message = "No se encontró ninguna canción en TIDAL. No se creará una playlist.",
                    ).also { resolutionProgress = null }
                } else {
                    mutableState.value.copy(
                        stage = PlaylistStage.READY_TO_CREATE,
                        busy = false,
                        progressMessage = null,
                        selectedTrackCount = progress.selectedTracks.size,
                        notFoundSongs = progress.notFoundSongs.toList(),
                        message = null,
                    )
                }
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(
                    stage = PlaylistStage.REVIEW,
                    busy = false,
                    progressMessage = null,
                    canRetryResolution = true,
                    message = error.message ?: "Falló la búsqueda de canciones en TIDAL.",
                )
            }
        }
    }

    private data class ResolutionProgress(
        val setlist: SetlistInfo,
        var currentIndex: Int = 0,
        val selectedTracks: MutableList<TrackCandidate> = mutableListOf(),
        val notFoundSongs: MutableList<String> = mutableListOf(),
    )
}

enum class SetlistInputMode { URL, ARTIST }

enum class PlaylistStage { INPUT, REVIEW, MATCHING, READY_TO_CREATE, RESULT }

data class PlaylistUiState(
    val apiKey: String = "",
    val apiKeySaved: Boolean = false,
    val tidalConfigured: Boolean = false,
    val tidalAuthorized: Boolean = false,
    val inputMode: SetlistInputMode = SetlistInputMode.URL,
    val input: String = "",
    val busy: Boolean = false,
    val message: String? = null,
    val progressMessage: String? = null,
    val setlist: SetlistInfo? = null,
    val stage: PlaylistStage = PlaylistStage.INPUT,
    val currentSong: SetlistSong? = null,
    val candidates: List<TrackCandidate> = emptyList(),
    val selectedTrackCount: Int = 0,
    val notFoundSongs: List<String> = emptyList(),
    val canRetryResolution: Boolean = false,
    val result: PlaylistCreationResult? = null,
)