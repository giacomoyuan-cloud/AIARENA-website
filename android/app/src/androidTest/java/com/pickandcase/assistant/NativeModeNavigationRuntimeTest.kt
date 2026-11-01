package com.pickandcase.assistant

import androidx.compose.ui.test.*
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real Compose + Worker storage; providers are synthetic and external calls are blocked. */
@RunWith(AndroidJUnit4::class)
class NativeModeNavigationRuntimeTest : NativeHarness() {
    private fun snapshot(): AssistantState { lateinit var s: AssistantState; scene.onActivity { s = ViewModelProvider(it)[AssistantViewModel::class.java].state.value }; return s }
    private fun await(predicate: (AssistantState) -> Boolean) = ui.waitUntil(20000) { predicate(snapshot()) }
    private fun api() = NativeApi(base).apply { token = NativeSession(app).load()!!.token }
    private fun request(path: String, payload: JSONObject) = runBlocking { api().call(path, payload) }
    private fun seed(mode: String, project: JSONObject? = null): String {
        val id = UUID.randomUUID().toString()
        val messages = JSONArray().put(json("uid" to 1, "isUser" to true, "chatMode" to mode, "text" to "OLD_CONTEXT_" + id))
            .put(json("uid" to 2, "isUser" to false, "chatMode" to mode, "text" to "OLD_REPLY_" + id))
        request("/chats", json("action" to "save", "chatId" to id, "projectId" to project?.str("id"), "title" to "旧会话 " + mode, "messages" to messages))
        model { it.openChat(id, "旧会话 " + mode, project) }; await { !it.loading && it.chatId == id && it.messages.size == 2 }
        assertEquals(mode, snapshot().mode)
        return id
    }
    private fun attach() {
        val f = File(app.filesDir, "attachments/navigation-${UUID.randomUUID()}.txt").apply { parentFile!!.mkdirs(); writeText("OLD_ATTACHMENT_CONTEXT") }
        model { it.addFiles(listOf(FileProvider.getUriForFile(app, app.packageName + ".files", f))) }
        await { !it.loading && it.attachments.size == 1 }
    }
    private fun choose(mode: String) {
        ui.onNodeWithContentDescription("打开导航").performClick()
        ui.onNodeWithTag("navigation-mode-" + mode).performScrollTo().performClick()
    }
    private fun assertFresh(mode: String, old: String) {
        await { !it.loading && it.chatId != old }
        val s = snapshot()
        assertEquals(mode, s.mode); assertEquals(Page.CHAT, s.page); assertNull(s.project)
        assertTrue(s.messages.isEmpty()); assertTrue(s.draft.isEmpty()); assertTrue(s.attachments.isEmpty()); assertNull(s.documentPayload)
        assertNull(s.quote); assertNull(s.imageParent); assertNull(s.imageMask); assertEquals("generation", s.imageTask)
        assertNull(s.run); assertFalse(s.busy); assertFalse(s.needsHistorySync)
        assertEquals("", s.debate.str("priorRunId")); assertEquals("", s.debate.str("context")); assertEquals("", s.debate.str("constraints"))
        assertFalse(app.getSharedPreferences("native_preferences_v2", 0).contains("draft:" + s.session!!.accountId + ":general"))
    }

    @Test fun all_nine_sidebar_mode_routes_create_fresh_sessions_and_keep_old_records() {
        login()
        for (from in listOf("chat", "debate", "image")) for (target in listOf("chat", "debate", "image")) {
            val old = seed(from); attach()
            model {
                it.draft("OLD_UNSENT_QUESTION"); it.quote(it.state.value.messages.last())
                it.debateConfig(it.state.value.debate.copyJson().put("context", "OLD_BACKGROUND").put("constraints", "OLD_LIMIT").put("priorRunId", "OLD_RUN"))
                it.imageConfig(it.state.value.imageModel, "edit", it.state.value.imageSettings)
            }
            choose(target); assertFresh(target, old)
            val saved = request("/chats", json("action" to "load", "chatId" to old)).arr("messages")
            assertEquals(2, saved.length()); assertEquals("OLD_CONTEXT_" + old, saved.getJSONObject(0).str("text"))
        }
        screenshot("native-fresh-mode-session")
    }

    @Test fun sidebar_from_project_opens_general_session_and_preserves_project_record() {
        login()
        val project = request("/projects", json("action" to "create", "name" to "模式隔离合成项目")).obj("project")
        val old = seed("chat", project)
        choose("debate"); assertFresh("debate", old)
        assertTrue(snapshot().histories.none { it.str("id") == old })
        assertEquals(2, request("/chats", json("action" to "load", "chatId" to old, "projectId" to project.str("id"))).arr("messages").length())
        model { it.openChat(old, "项目旧会话", project) }; await { !it.loading && it.messages.size == 2 }
        assertEquals(project.str("id"), snapshot().project!!.str("id")); assertEquals("chat", snapshot().mode)
    }

    @Test fun save_failure_retains_the_original_record_draft_and_attachments_until_retry() {
        login(); val old = seed("chat"); attach(); model { it.draft("KEEP_UNSENT"); it.quote(it.state.value.messages.last()) }
        runBlocking { NativeApi(java.net.URI(base).resolve("/").toString()).route("__offline?ms=30000") }
        choose("image"); await { !it.loading && it.error.isNotEmpty() }
        val s = snapshot(); assertEquals(old, s.chatId); assertEquals("chat", s.mode); assertEquals(2, s.messages.size)
        assertEquals("KEEP_UNSENT", s.draft); assertEquals(1, s.attachments.size); assertNotNull(s.quote)
        runBlocking { NativeApi(java.net.URI(base).resolve("/").toString()).route("__offline?ms=0") }
        model { it.dismissError() }; choose("image"); assertFresh("image", old)
    }

    @Test fun a_late_history_load_cannot_repopulate_a_new_session() {
        login(); val old = seed("image")
        model { it.openChat(old); it.newChat() }
        val fresh = snapshot().chatId
        Thread.sleep(700); ui.waitForIdle()
        assertEquals(fresh, snapshot().chatId); assertTrue(snapshot().messages.isEmpty()); assertFalse(snapshot().loading)
    }

    @Test fun rapid_mode_requests_serialize_and_empty_unsent_sessions_are_also_reset() {
        login(); val old = seed("image")
        model { it.mode("chat"); it.mode("image") }
        assertFresh("chat", old)
        val empty = snapshot().chatId
        attach(); model { it.draft("UNSENT_ONLY"); it.quote(json("text" to "OLD_QUOTE")) }
        choose("chat"); assertFresh("chat", empty)
    }

    @Test fun the_first_request_in_the_new_chat_has_no_previous_conversation_history() {
        login(); val old = seed("debate"); attach(); model { it.draft("OLD_UNSENT"); it.quote(it.state.value.messages.last()) }
        choose("chat"); assertFresh("chat", old)
        model { it.skillConfig(json("mode" to "off", "ids" to JSONArray())); it.search(false); it.draft("NEW_SESSION_ONLY"); it.send(); it.mode("image") }
        await { !it.busy && it.messages.size == 2 && it.messages.last().str("text").isNotEmpty() }
        val s = snapshot(); assertEquals("chat", s.mode); assertFalse(s.messages.last().optBoolean("isError")); assertEquals("NEW_SESSION_ONLY", s.messages.first().str("text"))
        assertEquals(0, s.messages.last().obj("context").optInt("historyCount", -1))
        screenshot("native-new-session-first-reply")
    }
}
