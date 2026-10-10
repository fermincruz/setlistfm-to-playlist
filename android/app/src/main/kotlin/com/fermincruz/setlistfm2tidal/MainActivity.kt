package com.fermincruz.setlistfm2tidal

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.fermincruz.setlistfm2tidal.domain.PlaylistCreationResult
import com.fermincruz.setlistfm2tidal.domain.SetlistInfo
import com.fermincruz.setlistfm2tidal.domain.TrackCandidate
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val viewModel: PlaylistViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val state by viewModel.state.collectAsState()
            val coroutineScope = rememberCoroutineScope()
            val authorizationLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.StartActivityForResult(),
            ) { result ->
                coroutineScope.launch { viewModel.completeAuthorization(result.data) }
            }

            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    PlaylistScreen(
                        state = state,
                        onApiKeyChanged = viewModel::updateApiKey,
                        onSaveApiKey = viewModel::saveApiKey,
                        onClearApiKey = viewModel::clearApiKey,
                        onModeSelected = viewModel::selectMode,
                        onInputChanged = viewModel::updateInput,
                        onFindSetlist = viewModel::findSetlist,
                        onConnectTidal = {
                            runCatching { viewModel.authorizationIntent() }
                                .onSuccess { intent -> authorizationLauncher.launch(intent) }
                                .onFailure { error ->
                                    viewModel.showMessage(error.message ?: "No se pudo abrir el acceso a TIDAL.")
                                }
                        },
                        onDisconnectTidal = viewModel::disconnectTidal,
                        onResolveSongs = viewModel::resolveSongs,
                        onChooseCandidate = viewModel::chooseCandidate,
                        onSkipSong = viewModel::skipSong,
                        onRetryResolution = viewModel::retryResolution,
                        onCreatePlaylist = viewModel::createPlaylist,
                        onStartOver = viewModel::startOver,
                    )
                }
            }
        }
    }
}

@Composable
private fun PlaylistScreen(
    state: PlaylistUiState,
    onApiKeyChanged: (String) -> Unit,
    onSaveApiKey: () -> Unit,
    onClearApiKey: () -> Unit,
    onModeSelected: (SetlistInputMode) -> Unit,
    onInputChanged: (String) -> Unit,
    onFindSetlist: () -> Unit,
    onConnectTidal: () -> Unit,
    onDisconnectTidal: () -> Unit,
    onResolveSongs: () -> Unit,
    onChooseCandidate: (TrackCandidate) -> Unit,
    onSkipSong: () -> Unit,
    onRetryResolution: () -> Unit,
    onCreatePlaylist: () -> Unit,
    onStartOver: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    var showApiKey by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            text = "Setlist.fm -> TIDAL",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
        )

        Text("API key de setlist.fm", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = state.apiKey,
            onValueChange = onApiKeyChanged,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("API key") },
            visualTransformation = if (showApiKey) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                TextButton(onClick = { showApiKey = !showApiKey }) {
                    Text(if (showApiKey) "Ocultar" else "Mostrar")
                }
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onSaveApiKey, enabled = state.apiKey.isNotBlank()) {
                Text(if (state.apiKeySaved) "Clave guardada" else "Guardar clave")
            }
            if (state.apiKey.isNotBlank()) {
                TextButton(onClick = onClearApiKey) { Text("Borrar") }
            }
        }

        Text("Cuenta de TIDAL", style = MaterialTheme.typography.titleMedium)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(if (state.tidalAuthorized) "Conectada" else "No conectada")
                if (!state.tidalConfigured) {
                    Text("Esta compilación no tiene Client ID de TIDAL.", style = MaterialTheme.typography.bodySmall)
                }
            }
            if (state.tidalAuthorized) {
                OutlinedButton(onClick = onDisconnectTidal) { Text("Desconectar") }
            } else {
                Button(onClick = onConnectTidal, enabled = state.tidalConfigured && !state.busy) {
                    Text("Conectar")
                }
            }
        }

        TabRow(selectedTabIndex = state.inputMode.ordinal) {
            SetlistInputMode.entries.forEach { mode ->
                Tab(
                    selected = state.inputMode == mode,
                    onClick = { onModeSelected(mode) },
                    text = { Text(if (mode == SetlistInputMode.URL) "URL" else "Artista") },
                )
            }
        }
        OutlinedTextField(
            value = state.input,
            onValueChange = onInputChanged,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text(if (state.inputMode == SetlistInputMode.URL) "URL de setlist.fm" else "Nombre del artista") },
        )
        Button(
            onClick = onFindSetlist,
            enabled = !state.busy && state.apiKey.isNotBlank() && state.input.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.inputMode == SetlistInputMode.URL) "Cargar setlist" else "Buscar último concierto")
        }

        if (state.busy) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            state.progressMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
        state.message?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        state.setlist?.let { setlist ->
            SetlistSummary(setlist)
            when (state.stage) {
                PlaylistStage.REVIEW -> {
                    if (state.canRetryResolution) {
                        Button(onClick = onRetryResolution, enabled = !state.busy) {
                            Text("Reintentar búsqueda de canciones")
                        }
                    } else {
                        Button(
                            onClick = onResolveSongs,
                            enabled = state.tidalAuthorized && !state.busy && setlist.songs.any { !it.isTape },
                        ) {
                            Text("Buscar canciones en TIDAL")
                        }
                    }
                }
                PlaylistStage.MATCHING -> {
                    state.currentSong?.let { song ->
                        Text("Elige una versión de: ${song.name}", style = MaterialTheme.typography.titleMedium)
                        state.candidates.forEach { candidate ->
                            TrackChoice(candidate = candidate, onClick = { onChooseCandidate(candidate) })
                        }
                        OutlinedButton(onClick = onSkipSong) { Text("Omitir esta canción") }
                    }
                }
                PlaylistStage.READY_TO_CREATE -> {
                    Text("Pistas seleccionadas: ${state.selectedTrackCount}/${setlist.songs.count { !it.isTape }}")
                    if (state.notFoundSongs.isNotEmpty()) {
                        Text("No encontradas: ${state.notFoundSongs.joinToString(", ")}")
                    }
                    Button(onClick = onCreatePlaylist, enabled = !state.busy && state.selectedTrackCount > 0) {
                        Text("Crear playlist en TIDAL")
                    }
                }
                PlaylistStage.RESULT, PlaylistStage.INPUT -> Unit
            }
        }

        state.result?.let { result ->
            Text("Playlist creada", style = MaterialTheme.typography.titleMedium)
            Text("${result.addedTrackCount} pistas añadidas de ${result.setlistSongCount} canciones.")
            if (result.notFoundSongs.isNotEmpty()) {
                Text("No encontradas: ${result.notFoundSongs.joinToString(", ")}")
            }
            Button(onClick = { uriHandler.openUri(result.url) }) { Text("Abrir en TIDAL") }
            OutlinedButton(onClick = onStartOver) { Text("Crear otra playlist") }
        }
    }
}

@Composable
private fun SetlistSummary(setlist: SetlistInfo) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp,
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(setlist.playlistTitle, style = MaterialTheme.typography.titleMedium)
            Text(listOf(setlist.city, setlist.country).filter(String::isNotBlank).joinToString(", "))
            Text("${setlist.songs.size} canciones")
        }
    }
}

@Composable
private fun TrackChoice(candidate: TrackCandidate, onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = MaterialTheme.shapes.small,
        tonalElevation = 1.dp,
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text("${candidate.artist} - ${candidate.title}", fontWeight = FontWeight.Medium)
            Text("${candidate.album} · ${formatDuration(candidate.durationSeconds)}")
        }
    }
}

private fun formatDuration(seconds: Int): String {
    val minutes = seconds.coerceAtLeast(0) / 60
    val remainingSeconds = seconds.coerceAtLeast(0) % 60
    return "$minutes:${remainingSeconds.toString().padStart(2, '0')}"
}