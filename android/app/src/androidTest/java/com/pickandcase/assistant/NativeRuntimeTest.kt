package com.pickandcase.assistant

import android.app.Application
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

/**
 * Actual Android Compose runtime + actual Worker contracts; providers are synthetic and
 * network-blocked.
 */
@RunWith(AndroidJUnit4::class)
class NativeRuntimeTest {
    @get:Rule val ui = createEmptyComposeRule()
    private lateinit var scene: ActivityScenario<MainActivity>
    private val app
        get() = ApplicationProvider.getApplicationContext<Application>()

    private val base = "http://10.0.2.2:4197/native/"

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

    private fun waitFor(tag: String) {
        ui.waitUntil(15000) { ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun login(name: String = "qa-reader", password: String = "offline-fixture") {
        waitFor("login-submit")
        ui.onNodeWithTag("login-username").performTextInput(name)
        ui.onNodeWithTag("login-password").performTextInput(password)
        ui.onNodeWithTag("login-submit").performClick()
        ui.waitUntil(15000) { ui.onAllNodesWithTag("login-submit").fetchSemanticsNodes().isEmpty() }
        ui.waitForIdle()
    }

    private fun model(action: (AssistantViewModel) -> Unit) {
        scene.onActivity { action(ViewModelProvider(it)[AssistantViewModel::class.java]) }
        ui.waitForIdle()
    }

    private fun screenshot(name: String) {
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
            File(app.getExternalFilesDir(null), "$name.png").outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
    }

    private fun containsWeb(view: View): Boolean =
        view is android.webkit.WebView ||
            view is ViewGroup && (0 until view.childCount).any { containsWeb(view.getChildAt(it)) }

    @Test
    fun login_is_encrypted_persistent_and_business_views_are_native() {
        login()
        val saved = NativeSession(app).load()!!
        assertEquals("qa-reader", saved.accountId)
        assertTrue(saved.canManage)
        val prefs = app.getSharedPreferences("native_session_v2", 0).all.toString()
        assertFalse(prefs.contains(saved.token))
        assertFalse(prefs.contains("offline-fixture"))
        scene.recreate()
        ui.waitForIdle()
        ui.onNodeWithTag("login-submit").assertDoesNotExist()
        assertEquals(saved.token, NativeSession(app).load()!!.token)
        scene.onActivity { activity -> assertFalse(containsWeb(activity.window.decorView)) }
        screenshot("native-chat")
    }

    @Test
    fun management_creates_a_web_compatible_account_and_other_accounts_cannot_manage() {
        login()
        model { it.navigate(Page.SETTINGS) }
        ui.onNodeWithTag("admin-menu").assertExists().performClick()
        waitFor("admin-username")
        val username = "qa-native-" + System.currentTimeMillis()
        ui.onNodeWithTag("admin-username").performTextInput(username)
        ui.onNodeWithTag("admin-password").performTextInput("def")
        ui.onNodeWithTag("admin-create").performClick()
        ui.waitUntil(15000) { ui.onAllNodesWithText(username).fetchSemanticsNodes().size >= 2 }
        screenshot("native-management")
        model { it.navigate(Page.SETTINGS) }
        ui.onNodeWithTag("settings-logout").performClick()
        waitFor("logout-confirm")
        ui.onNodeWithTag("logout-confirm").performClick()
        login(username, "def")
        model { it.navigate(Page.SETTINGS) }
        ui.onNodeWithTag("admin-menu").assertDoesNotExist()
        assertFalse(NativeSession(app).load()!!.canManage)
        val api = NativeApi(base).apply { token = NativeSession(app).load()!!.token }
        val denied = runBlocking { runCatching { api.route("users") }.exceptionOrNull() }
        assertTrue(denied is ApiFailure && (denied as ApiFailure).status == 403)
        screenshot("native-ordinary-settings")
    }

    @Test
    fun text_streaming_and_reopening_history_use_the_same_sol_low_run() {
        login()
        model {
            it.model("gpt-6.1-sol", "low")
            it.draft("原生合成验收：解释一个观点")
            it.send()
        }
        ui.waitUntil(25000) {
            var done = false
            scene.onActivity {
                val s = ViewModelProvider(it)[AssistantViewModel::class.java].state.value
                done = s.messages.size >= 2 && !s.busy && s.messages.last().str("text").isNotEmpty()
            }
            done
        }
        var chat = ""
        model {
            assertEquals("low", it.state.value.effort)
            assertFalse(
                it.state.value.messages.last().str("text"),
                it.state.value.messages.last().optBoolean("isError"),
            )
            chat = it.state.value.chatId
            it.newChat()
            it.openChat(chat, "验收对话")
        }
        ui.waitUntil(15000) {
            var loaded = false
            scene.onActivity {
                loaded =
                    ViewModelProvider(it)[AssistantViewModel::class.java]
                        .state
                        .value
                        .messages
                        .size >= 2
            }
            loaded
        }
        screenshot("native-streaming-result")
    }

    @Test
    fun offline_does_not_clear_login_and_large_image_cache_is_account_isolated() {
        login()
        val token = NativeSession(app).load()!!.token
        val cache = NativeCache(app)
        val large = "x".repeat(3 * 1024 * 1024)
        cache.put("qa-reader", "general", "large", json("image" to large))
        assertEquals(large.length, cache.get("qa-reader", "general", "large")!!.str("image").length)
        assertNull(cache.get("qa-regular", "general", "large"))
        cache.clearAccount("qa-regular")
        assertNotNull(cache.get("qa-reader", "general", "large"))
        cache.clearAccount("qa-reader")
        cache.close()
        runBlocking { NativeApi("http://10.0.2.2:4197/").route("__offline?ms=1500") }
        scene.recreate()
        ui.waitForIdle()
        ui.onNodeWithTag("login-submit").assertDoesNotExist()
        assertEquals(token, NativeSession(app).load()!!.token)
    }
}
