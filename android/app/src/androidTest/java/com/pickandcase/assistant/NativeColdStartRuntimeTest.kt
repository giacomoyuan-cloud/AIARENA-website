package com.pickandcase.assistant

import android.app.Application
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Run prepare and restore in separate instrumentations with force-stop between them. */
@RunWith(AndroidJUnit4::class)
class NativeColdStartRuntimeTest {
    @get:Rule val ui=createEmptyComposeRule()
    private val app get()=ApplicationProvider.getApplicationContext<Application>()
    private val base get()=androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("nativeFixtureBase") ?: "http://127.0.0.1:4197/native/"
    private val saved get()=File(app.filesDir,"native-cold-start-proof.json")
    @Test fun prepare_local_persistent_session() {
        NativeSession(app).logout();app.getSharedPreferences("native_preferences_v2",0).edit().clear().commit();NativeTestHooks.baseUrl=base
        ActivityScenario.launch(MainActivity::class.java).use { scene ->
            ui.onNodeWithTag("login-username").performTextInput("qa-reader");ui.onNodeWithTag("login-password").performTextInput("offline-fixture");scene.onActivity { a -> a.currentFocus?.clearFocus();androidx.core.view.WindowCompat.getInsetsController(a.window,a.window.decorView).hide(androidx.core.view.WindowInsetsCompat.Type.ime()) };ui.waitForIdle();ui.onNodeWithTag("login-submit").performScrollTo().performClick()
            ui.waitUntil(15000){ui.onAllNodesWithTag("login-submit").fetchSemanticsNodes().isEmpty()};val s=NativeSession(app).load()!!;saved.writeText(json("pid" to android.os.Process.myPid(),"tokenDigest" to sha256(s.token),"account" to s.accountId).toString())
        };NativeTestHooks.baseUrl=null
    }
    @Test fun restore_after_real_process_death_without_login() {
        val before=org.json.JSONObject(saved.readText());assertNotEquals(before.optInt("pid"),android.os.Process.myPid());NativeTestHooks.baseUrl=base
        ActivityScenario.launch(MainActivity::class.java).use { scene ->
            ui.waitUntil(15000){ui.onAllNodesWithContentDescription("打开导航").fetchSemanticsNodes().isNotEmpty()};ui.onNodeWithTag("login-submit").assertDoesNotExist();val session=NativeSession(app).load()!!;assertEquals(before.str("tokenDigest"),sha256(session.token));assertEquals(before.str("account"),session.accountId)
            scene.onActivity { assertEquals(session.token,ViewModelProvider(it)[AssistantViewModel::class.java].state.value.session!!.token) }
        };NativeTestHooks.baseUrl=null;saved.delete()
    }
}
