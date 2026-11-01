package com.pickandcase.assistant

import androidx.compose.ui.test.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith

/** The production chat/view-model path, against a network-blocked synthetic Worker. */
@RunWith(AndroidJUnit4::class)
class NativeTableChatRuntimeTest : NativeHarness() {
    @Test fun generated_reply_keeps_table_and_cards_controls_working() {
        login()
        model { it.theme("light"); it.mode("chat"); it.draft("UI 排版验收：显示合成表格。"); it.send() }
        ui.waitUntil(30000) {
            var ready = false
            model { ready = !it.state.value.busy && it.state.value.messages.any { message -> message.str("text").contains("逐项阅读") } }
            ready
        }
        ui.onNodeWithTag("markdown-table-view").performScrollTo().performClick().assertIsSelected()
        ui.onNodeWithTag("markdown-table-scroll").assertIsDisplayed()
        ui.onNodeWithText("示例 A", substring = false).assertIsDisplayed()
        screenshot("native-chat-table-mode")
        ui.onNodeWithTag("markdown-cards-view").performScrollTo().performClick().assertIsSelected()
        ui.onNodeWithTag("markdown-row-card-0").assertIsDisplayed()
        ui.onNodeWithText("示例 A", substring = false).assertIsDisplayed()
        ui.onNodeWithTag("markdown-row-card-1").assertExists()
        screenshot("native-chat-cards-mode")
        ui.onNodeWithTag("markdown-table-view").performScrollTo().performClick().assertIsSelected()
    }
}
