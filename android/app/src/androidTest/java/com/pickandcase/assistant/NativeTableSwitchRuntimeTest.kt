package com.pickandcase.assistant

import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.text.Spanned
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeTableSwitchRuntimeTest {
    @get:Rule val ui = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val clickStart = AtomicLong()
    private val layoutAt = AtomicLong()
    private lateinit var root: View

    private fun sample(rows: Int = 40) = NativeMarkdownPart.Table(
        List(8) { "字段 ${it + 1}" },
        List(rows) { row -> List(8) { column ->
            when (column % 4) {
                0 -> "第 ${row + 1} 项，内容必须完整保留"
                1 -> "**重要信息** 与 *说明*"
                2 -> "`ID-${row + 1}`"
                else -> "[来源 ${row + 1}](https://example.test/${row + 1})"
            }
        } },
    )

    private fun show(table: NativeMarkdownPart.Table) {
        ui.setContent {
            root = LocalView.current
            MaterialTheme(typography = NativeTypography.typography(context)) {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                        Box(Modifier.onGloballyPositioned {
                            if (clickStart.get() > 0) layoutAt.compareAndSet(0, SystemClock.elapsedRealtimeNanos())
                        }) { NativeReadableTable(table) }
                    }
                }
            }
        }
        ui.waitForIdle()
    }

    /** Identical black-box tap-to-idle measurement before and after the fix. */
    @Test fun switches_render_on_the_first_tap_and_record_response_times() {
        show(sample())
        val timings = JSONArray()
        repeat(3) {
            for (mode in listOf("table", "cards")) {
                val node = ui.onNodeWithTag("markdown-$mode-view").performScrollTo()
                val start = SystemClock.elapsedRealtimeNanos()
                layoutAt.set(0)
                node.performSemanticsAction(SemanticsActions.OnClick) { action ->
                    clickStart.set(SystemClock.elapsedRealtimeNanos()); action()
                }
                ui.waitForIdle()
                node.assertIsSelected()
                assertTrue("The selected layout must be measured after every tap", layoutAt.get() > clickStart.get())
                timings.put(JSONObject().put("mode", mode)
                    .put("clickToLayoutMs", (layoutAt.get() - clickStart.get()) / 1_000_000.0)
                    .put("tapToIdleMs", (SystemClock.elapsedRealtimeNanos() - start) / 1_000_000.0))
                clickStart.set(0)
                if (mode == "table") ui.onNodeWithTag("markdown-table-scroll").assertExists()
                else ui.onNodeWithTag("markdown-row-card-0").assertExists()
            }
        }
        val label = InstrumentationRegistry.getArguments().getString("tableBenchmarkLabel") ?: "after"
        val report = JSONObject().put("label", label).put("rows", 40).put("columns", 8)
            .put("measurement", "debug emulator: click callback to completed layout; tap-to-idle also includes test synchronization and chip color animation")
            .put("realModelCalls", 0).put("timings", timings)
        File(context.filesDir, "table-switch-$label.json").writeText(report.toString(2))
        ui.onRoot().captureToImage().asAndroidBitmap().let { bitmap ->
            File(context.filesDir, "table-switch-$label.png").outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
        println("TABLE_SWITCH_TIMINGS=$report")
    }

    @Test fun all_rows_remain_reachable_and_switching_keeps_the_current_page() {
        show(sample(25))
        ui.onNodeWithTag("markdown-row-card-0").assertExists()
        ui.onNodeWithTag("markdown-row-card-12").assertDoesNotExist()
        ui.onNodeWithTag("markdown-table-page-next").performScrollTo().performClick()
        ui.onNodeWithTag("markdown-row-card-12").assertExists()
        ui.onNodeWithTag("markdown-row-card-23").assertExists()
        ui.onNodeWithTag("markdown-row-card-24").assertDoesNotExist()
        ui.onNodeWithTag("markdown-table-view").performScrollTo().performClick().assertIsSelected()
        ui.onAllNodesWithText("第 13 项，内容必须完整保留").assertCountEquals(2)
        ui.onAllNodesWithText("第 1 项，内容必须完整保留").assertCountEquals(0)
        ui.onNodeWithTag("markdown-table-page-next").performScrollTo().performClick()
        ui.onAllNodesWithText("第 25 项，内容必须完整保留").assertCountEquals(2)
        ui.onNodeWithTag("markdown-table-page-next").assertIsNotEnabled()
        ui.onNodeWithTag("markdown-cards-view").performScrollTo().performClick()
        ui.onNodeWithTag("markdown-row-card-24").assertExists()
        ui.onNodeWithTag("markdown-table-page-prev").performScrollTo().performClick()
        ui.onNodeWithTag("markdown-row-card-12").assertExists()
        ui.onNodeWithTag("markdown-row-card-24").assertDoesNotExist()
    }

    @Test fun horizontal_position_survives_layout_switches() {
        show(sample(2))
        ui.onNodeWithTag("markdown-table-view").performScrollTo().performClick()
        ui.onNodeWithTag("markdown-table-scroll").performTouchInput { swipeLeft() }
        val before = ui.onNodeWithTag("markdown-table-scroll").fetchSemanticsNode()
            .config[androidx.compose.ui.semantics.SemanticsProperties.HorizontalScrollAxisRange].value()
        assertTrue(before > 0)
        ui.onNodeWithTag("markdown-cards-view").performScrollTo().performClick()
        ui.onNodeWithTag("markdown-table-view").performScrollTo().performClick()
        val after = ui.onNodeWithTag("markdown-table-scroll").fetchSemanticsNode()
            .config[androidx.compose.ui.semantics.SemanticsProperties.HorizontalScrollAxisRange].value()
        assertEquals(before, after, 1f)
    }

    @Test fun formula_cells_render_after_switching_in_both_directions() {
        show(NativeMarkdownPart.Table(listOf("公式", "价格", "代码", "说明"),
            List(2) { listOf("\\(x^2+1\\)", "\$20 / \$100", "`ID-001`", "**保留格式**") }))
        fun textViews(view: View): List<TextView> = (if (view is TextView) listOf(view) else emptyList()) +
            (if (view is ViewGroup) (0 until view.childCount).flatMap { textViews(view.getChildAt(it)) } else emptyList())
        fun awaitFormulas() {
            ui.waitUntil(15000) {
                var count = 0
                ui.runOnUiThread {
                    count = textViews(root).sumOf { view ->
                        val text = view.text as? Spanned
                        text?.getSpans(0, text.length, io.noties.markwon.ext.latex.JLatexAsyncDrawableSpan::class.java)
                            ?.count { it.drawable.hasResult() && it.color() == view.currentTextColor } ?: 0
                    }
                }
                count == 2
            }
        }
        awaitFormulas()
        ui.onNodeWithTag("markdown-table-view").performScrollTo().performClick(); awaitFormulas()
        ui.onNodeWithTag("markdown-cards-view").performScrollTo().performClick(); awaitFormulas()
        ui.onAllNodesWithText("\$20 / \$100").assertCountEquals(2)
    }
}
