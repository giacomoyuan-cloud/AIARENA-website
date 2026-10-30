package com.pickandcase.assistant

import androidx.compose.ui.test.*
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeTaskJournalRuntimeTest : NativeHarness() {
    private fun state():AssistantState { lateinit var s:AssistantState;scene.onActivity{s=ViewModelProvider(it)[AssistantViewModel::class.java].state.value};return s }
    private fun api()=NativeApi(base).apply{token=NativeSession(app).load()!!.token}
    private fun call(p:JSONObject)=runBlocking{api().call("/schedules",p)}
    private fun create(id:String=UUID.randomUUID().toString(),name:String="原生执行日志",prompt:String="合成日志问题")=call(json("action" to "create","id" to id,"name" to name,"prompt" to prompt,"model" to "gpt-6.1-sol","effort" to "low","enabled" to false,"schedule" to json("frequency" to "once","timeZone" to "Asia/Shanghai","at" to java.time.Instant.now().plusSeconds(86400).toString()))).obj("task")
    private fun task(id:String)=call(json("action" to "list")).arr("tasks").objects().first{it.str("id")==id}
    private fun page(id:String){model{it.navigate(Page.TASKS)};ui.waitUntil(20000){state().data.arr("tasks").objects().any{it.str("id")==id}}}
    private fun button(id:String,label:String)=ui.onNode(hasText(label) and hasAnyAncestor(hasTestTag("task-card-$id")))

    @Test fun full_history_loads_beyond_the_twenty_entry_cache() {
        login();val t=create("fixture-history-"+UUID.randomUUID(),"分页历史验收");page(t.str("id"));button(t.str("id"),"执行记录").performScrollTo().performClick()
        ui.waitUntil(15000){ui.onAllNodesWithText("加载更早的记录").fetchSemanticsNodes().isNotEmpty()};ui.onNodeWithText("加载更早的记录").performScrollTo().performClick()
        ui.waitUntil(15000){ui.onAllNodesWithText("合成历史记录-69").fetchSemanticsNodes().isNotEmpty()};ui.onNodeWithText("合成历史记录-69").performScrollTo().assertIsDisplayed();screenshot("native-complete-task-history")
    }

    @Test fun independent_journal_replays_after_shared_chat_deletion_without_resurrecting_it() {
        login();val t=create();val id=t.str("id");call(json("action" to "run","id" to id));ui.waitUntil(60000){task(id).str("status")=="completed"}
        val done=task(id);val entry=call(json("action" to "history","id" to id)).arr("runs").getJSONObject(0);assertTrue(entry.str("runId").isNotBlank())
        runBlocking{api().call("/chats",json("action" to "delete","chatId" to entry.str("chatId")))}
        page(id);button(id,"执行记录").performScrollTo().performClick();ui.waitUntil(15000){ui.onAllNodesWithText(dateLabel(entry.opt("at"))).fetchSemanticsNodes().isNotEmpty()};ui.onNodeWithText(dateLabel(entry.opt("at"))).performClick()
        ui.onNodeWithText("任务执行日志").assertExists();ui.waitUntil(15000){ui.onAllNodes(hasText("复制内容") and isEnabled()).fetchSemanticsNodes().isNotEmpty()};ui.onNodeWithText("复制内容").performClick();screenshot("native-retained-task-journal")
        assertTrue(runBlocking{api().call("/chats",json("action" to "list"))}.arr("chats").objects().none{it.str("id")==entry.str("chatId")})
    }

    @Test fun stopping_one_active_task_keeps_its_run_history() {
        login();val t=create(prompt="慢速任务验收");val id=t.str("id");call(json("action" to "run","id" to id));ui.waitUntil(15000){task(id).str("status")=="running"};page(id)
        button(id,"停止本次执行").performScrollTo().performClick();ui.waitUntil(60000){task(id).str("status")=="cancelled"};assertEquals("cancelled",call(json("action" to "history","id" to id)).arr("runs").getJSONObject(0).str("status"))
    }
}
