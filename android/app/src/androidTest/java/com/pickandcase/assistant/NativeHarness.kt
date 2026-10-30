package com.pickandcase.assistant

import android.app.Application
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.*
import org.junit.Assert.*

/**
 * Actual Android Compose runtime + actual Worker contracts; providers are synthetic and
 * network-blocked.
 */
abstract class NativeHarness {
    @get:Rule val ui = createEmptyComposeRule()
    protected lateinit var scene: ActivityScenario<MainActivity>
    protected val app
        get() = ApplicationProvider.getApplicationContext<Application>()

    protected val base = "http://10.0.2.2:4197/native/"

    @Before
    fun start() {
        check(
            android.os.Build.MODEL.contains("sdk", true) ||
                android.os.Build.HARDWARE.contains("ranchu")
        ) {
            "Acceptance only runs on the isolated emulator"
        }
        NativeSession(app).logout()
        app.getSharedPreferences("native_preferences_v2", 0).edit().clear().commit()
        NativeTestHooks.baseUrl = base
        scene = ActivityScenario.launch(MainActivity::class.java)
    }

    @After
    fun finish() {
        scene.close()
        NativeTestHooks.baseUrl = null
    }

    protected fun waitFor(tag: String) {
        ui.waitUntil(15000) { ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    }

    protected fun login(name: String = "qa-reader", password: String = "offline-fixture") {
        waitFor("login-submit")
        ui.onNodeWithTag("login-username").performTextInput(name)
        ui.onNodeWithTag("login-password").performTextInput(password)
        ui.onNodeWithTag("login-submit").performClick()
        ui.waitUntil(15000) { ui.onAllNodesWithTag("login-submit").fetchSemanticsNodes().isEmpty() }
        ui.waitForIdle()
    }

    protected fun model(action: (AssistantViewModel) -> Unit) {
        scene.onActivity { action(ViewModelProvider(it)[AssistantViewModel::class.java]) }
        ui.waitForIdle()
    }

    protected fun screenshot(name: String) {
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
            File(app.getExternalFilesDir(null), "$name.png").outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
    }

    protected fun containsWeb(view: View): Boolean =
        view is android.webkit.WebView ||
            view is ViewGroup && (0 until view.childCount).any { containsWeb(view.getChildAt(it)) }
}
