package com.pickandcase.assistant

import androidx.compose.ui.test.*
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeSiteAlignmentTest : NativeHarness() {
    private fun snapshot(): AssistantState { var s: AssistantState? = null; model { s = it.state.value }; return s!! }

    @Test fun fresh_defaults_are_the_website_defaults() {
        model {
            val s = it.state.value
            assertEquals(it.clientContract.defaultModel, s.model)
            assertEquals(it.clientContract.defaultEffort(s.model), s.effort)
            assertEquals(it.clientContract.defaultImageModel, s.imageModel)
            assertTrue(s.search)
        }
    }

    @Test fun every_picker_uses_current_website_models_only() {
        login()
        ui.waitUntil(15000) { snapshot().catalog.arr("models").length() == 11 }
        model {
            val models = it.state.value.catalog.arr("models").objects()
            assertTrue("Hosted Skills metadata must retain its object shape", it.state.value.catalog.obj("skillModels").length() > 0)
            assertTrue(it.state.value.catalog.obj("skillModels").has("claude-sonnet-5-5"))
            assertEquals(it.clientContract.chatModels.map { m -> m.str("id") }.toSet(), models.filter { m -> !m.optBoolean("image") }.map { m -> m.str("id") }.toSet())
            assertEquals(it.clientContract.imageModels.map { m -> m.str("id") }.toSet(), models.filter { m -> m.optBoolean("image") }.map { m -> m.str("id") }.toSet())
            assertTrue(models.none { m -> m.str("id") in listOf("claude-opus-5", "gpt-5.6-sol", "gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-image") })
        }
        screenshot("aligned-current-models")
    }

    @Test fun saved_retired_models_are_migrated_before_reuse() {
        login()
        val saved = json("model" to "gpt-5.6-sol", "effort" to "low", "imageModel" to "gemini-3.1-flash-image", "debate" to json("members" to JSONArray().put(json("model" to "claude-opus-5", "effort" to "high")), "summaryModel" to "gemini-3.1-pro-preview", "summaryEffort" to "high"))
        app.getSharedPreferences("native_preferences_v2", 0).edit().putString("settings:qa-reader", saved.toString()).commit()
        scene.close()
        scene = androidx.test.core.app.ActivityScenario.launch(MainActivity::class.java)
        ui.waitForIdle()
        val s = snapshot()
        assertEquals("gpt-6.1-sol", s.model)
        assertEquals("low", s.effort)
        assertEquals("gemini-nano-banana-2.1", s.imageModel)
        assertEquals("claude-opus-5-5", s.debate.arr("members").getJSONObject(0).str("model"))
        assertEquals("gemini-4-argon", s.debate.str("summaryModel"))
        val persisted = JSONObject(app.getSharedPreferences("native_preferences_v2", 0).getString("settings:qa-reader", "{}")!!)
        assertEquals(s.model, persisted.str("model"))
        assertEquals(s.imageModel, persisted.str("imageModel"))
    }

    @Test fun modes_live_in_the_left_drawer_and_voice_is_absent() {
        login()
        ui.onNodeWithContentDescription("语音输入").assertDoesNotExist()
        ui.onNodeWithText("辩论", substring = false).assertIsNotDisplayed()
        ui.onNodeWithText("图片", substring = false).assertIsNotDisplayed()
        for (mode in listOf("debate", "image", "chat")) {
            ui.onNodeWithContentDescription("打开导航").performClick()
            ui.onNodeWithTag("navigation-mode-" + mode).assertIsDisplayed().performClick()
            ui.waitUntil(5000) { snapshot().mode == mode }
        }
        ui.onNodeWithContentDescription("打开导航").performClick()
        screenshot("aligned-left-navigation")
    }

    @Test fun search_defaults_on_and_is_controlled_from_plus_menu() {
        login()
        assertTrue(snapshot().search)
        ui.onNodeWithText("联网", substring = false).assertDoesNotExist()
        ui.onNodeWithContentDescription("添加附件").performClick()
        ui.onNodeWithTag("plus-search-switch").assertIsOn().performClick()
        assertFalse(snapshot().search)
        ui.onNodeWithTag("plus-search-switch").assertIsOff().performClick()
        assertTrue(snapshot().search)
        screenshot("aligned-plus-search")
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
    }

    @Test fun incognito_is_persistent_and_prominent_until_explicitly_exited() {
        login()
        ui.onNodeWithText("无痕模式", substring = false).performClick()
        ui.onNodeWithTag("incognito-banner").assertIsDisplayed()
        ui.onNodeWithText("此对话不保存到历史或记忆").assertIsDisplayed()
        model { it.newChat() }
        assertTrue(snapshot().incognito)
        ui.onNodeWithTag("incognito-banner").assertIsDisplayed()
        screenshot("aligned-incognito-banner")
        ui.onNodeWithText("退出无痕").performClick()
        assertFalse(snapshot().incognito)
        ui.onNodeWithTag("incognito-banner").assertDoesNotExist()
    }
}
