package com.fermincruz.setlistfm2tidal

import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun showsCredentialAndSetlistControls() {
        composeRule.onNodeWithText("Setlist.fm -> TIDAL").assertExists()
        composeRule.onNodeWithText("API key de setlist.fm").assertExists()
        composeRule.onNodeWithText("Buscar último concierto").assertExists()
        composeRule.onNodeWithText("Conectar").assertExists()
    }
}