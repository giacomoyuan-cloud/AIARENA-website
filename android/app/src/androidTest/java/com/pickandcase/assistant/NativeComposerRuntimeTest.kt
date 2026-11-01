package com.pickandcase.assistant

import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.DpRect
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** User-visible layout and native editing actions; real Worker with synthetic providers only. */
@RunWith(AndroidJUnit4::class)
class NativeComposerRuntimeTest : NativeHarness() {
    private val DpRect.heightDp get() = bottom - top
    private fun snapshot(): AssistantState { lateinit var s: AssistantState; scene.onActivity { s = ViewModelProvider(it)[AssistantViewModel::class.java].state.value }; return s }
    private fun await(predicate: (AssistantState) -> Boolean) = ui.waitUntil(20000) { predicate(snapshot()) }
    private fun prepare() { login(); model { it.theme("light"); it.skillConfig(json("mode" to "off", "ids" to JSONArray())); it.search(false) } }

    private fun assertCompact() {
        val shell = ui.onNodeWithTag("composer-shell").getUnclippedBoundsInRoot()
        for (tag in listOf("composer-attachment", "send")) {
            val node = ui.onNodeWithTag(tag).assertIsDisplayed().assertHeightIsAtLeast(44.dp).assertWidthIsAtLeast(44.dp)
            val rect = node.getUnclippedBoundsInRoot()
            assertTrue("$tag must stay inside input", rect.left >= shell.left && rect.right <= shell.right && rect.top >= shell.top && rect.bottom <= shell.bottom)
        }
        val settings = ui.onNodeWithTag("composer-settings").assertIsDisplayed().assertHeightIsAtLeast(44.dp).getUnclippedBoundsInRoot()
        assertTrue("Model selection belongs below input", settings.top >= shell.bottom)
        assertTrue("Empty/one-line input must remain compact", shell.heightDp <= 60.dp)
        assertTrue("Complete composer must not regain the old three rows", ui.onNodeWithTag("composer-area").getUnclippedBoundsInRoot().heightDp <= 120.dp)
    }

    private fun accentCoverage(): Double {
        val pixels = ui.onNodeWithTag("send").captureToImage().toPixelMap()
        var orange = 0
        for (y in 0 until pixels.height) for (x in 0 until pixels.width) {
            val c = pixels[x, y]
            if (c.red > c.green + .06f && c.green > c.blue + .02f && c.red > c.blue + .10f) orange++
        }
        return orange.toDouble() / (pixels.width * pixels.height)
    }

    @Test fun actions_fit_inside_the_compact_input_and_model_selection_sits_below_in_all_modes_and_themes() {
        prepare(); val rows = JSONArray()
        for (theme in listOf("light", "dark")) for (mode in listOf("chat", "image", "debate")) {
            model { it.theme(theme); it.mode(mode) }; await { !it.loading && it.mode == mode }
            assertCompact()
            ui.onNodeWithTag("send").assertIsNotEnabled()
            model { it.draft("简短问题") }; ui.onNodeWithTag("send").assertIsEnabled()
            assertCompact()
            val coverage = accentCoverage()
            assertTrue("Only the arrow may be orange, not a filled button", coverage < .20)
            val shell = ui.onNodeWithTag("composer-shell").getUnclippedBoundsInRoot()
            rows.put(json("theme" to theme, "mode" to mode, "inputHeightDp" to shell.heightDp.value, "composerHeightDp" to ui.onNodeWithTag("composer-area").getUnclippedBoundsInRoot().heightDp.value, "orangeCoverage" to coverage))
            screenshot("compact-composer-$theme-$mode")
            ui.onNodeWithTag("composer-area").captureToImage().asAndroidBitmap().let { bitmap ->
                File(app.getExternalFilesDir(null), "compact-composer-$theme-$mode-detail.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
            }
        }
        File(app.getExternalFilesDir(null), "compact-composer-metrics.json").writeText(rows.toString(2))
    }

    @Test fun multiline_drafts_keep_all_text_and_the_attachment_and_model_controls_work() {
        prepare(); val text = (1..20).joinToString("\n") { "第${it}行：token、中文和 🐈" }
        model { it.draft(text) }
        val shell = ui.onNodeWithTag("composer-shell").getUnclippedBoundsInRoot()
        assertTrue(shell.heightDp > 60.dp && shell.heightDp <= 190.dp)
        assertEquals(text, ui.onNodeWithTag("composer").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        ui.onNodeWithTag("composer-attachment").performClick()
        ui.onNodeWithText("文件或 ZIP").assertIsDisplayed()
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        ui.onNodeWithTag("composer-settings").performClick()
        ui.onNodeWithText("模型与思考深度").assertIsDisplayed()
        ui.onNodeWithTag("ordered-slider-思考深度").assertExists()
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        assertEquals(text, snapshot().draft)
        screenshot("compact-composer-multiline")
    }

    @Test fun native_keyboard_send_preserves_unicode_and_the_send_button_stays_visible() {
        prepare(); val text = "token 怎么才能少点？\n保留中文、emoji 🐈 和第二行。"
        ui.onNodeWithTag("composer").performTextInput(text)
        ui.onNodeWithTag("send").assertIsDisplayed().assertIsEnabled()
        ui.onNodeWithTag("composer-attachment").assertIsDisplayed()
        var keyboardTop = 0f
        var density = 1f
        ui.waitUntil(15000) {
            var shown = false
            scene.onActivity { activity ->
                val view = activity.window.decorView
                val ime = androidx.core.view.ViewCompat.getRootWindowInsets(view)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime())?.bottom ?: 0
                shown = ime > 0
                keyboardTop = (view.height - ime).toFloat()
                density = activity.resources.displayMetrics.density
            }
            shown
        }
        val controlsBottom = ui.onNodeWithTag("composer-toolbar").fetchSemanticsNode().boundsInRoot.bottom
        assertTrue("Keyboard must not create an extra navigation-bar-sized gap", (keyboardTop - controlsBottom) / density <= 16f)
        screenshot("compact-composer-keyboard")
        ui.onNodeWithTag("composer").performImeAction()
        await { !it.busy && it.messages.size == 2 && it.messages.last().str("text").isNotEmpty() }
        assertEquals(text, snapshot().messages.first().str("topicText"))
        assertFalse(snapshot().messages.last().optBoolean("isError"))
        assertEquals("", snapshot().draft)
    }

    @Test fun the_same_transparent_action_stops_generation_and_accepts_the_next_draft() {
        prepare(); model { it.draft("慢速任务验收：停止按钮合成测试") }
        ui.onNodeWithTag("send").performClick()
        await { it.busy && it.messages.size == 2 && it.messages.last().obj("run").str("id").isNotBlank() }
        ui.onNodeWithContentDescription("停止生成").assertIsDisplayed()
        assertTrue(accentCoverage() < .20)
        ui.onNodeWithTag("send").performClick()
        await { !it.busy }
        ui.onNodeWithTag("composer").performTextInput("下一条问题")
        ui.onNodeWithTag("send").assertIsEnabled().assertIsDisplayed()
        assertEquals(1, snapshot().messages.count { it.optBoolean("isUser") })
        assertEquals("下一条问题", snapshot().draft)
    }
}
