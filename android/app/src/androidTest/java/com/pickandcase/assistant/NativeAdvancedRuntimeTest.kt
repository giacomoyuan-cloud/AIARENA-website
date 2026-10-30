package com.pickandcase.assistant

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeAdvancedRuntimeTest : NativeHarness() {
    private fun state():AssistantState { lateinit var s:AssistantState;scene.onActivity {s=ViewModelProvider(it)[AssistantViewModel::class.java].state.value};return s }
    private fun await(ms:Long=30000,p:(AssistantState)->Boolean)=ui.waitUntil(ms){p(state())}
    private fun api()=NativeApi(base).apply {token=NativeSession(app).load()!!.token}
    private fun request(path:String,p:JSONObject)=runBlocking {api().call(path,p)}
    private fun file(name:String,bytes:ByteArray):android.net.Uri { val f=File(app.filesDir,"attachments/$name");f.parentFile!!.mkdirs();f.writeBytes(bytes);return FileProvider.getUriForFile(app,app.packageName+".files",f) }
    private fun ask(q:String) {model{it.skillConfig(json("mode" to "off","ids" to JSONArray()));it.model("gpt-6.1-sol","low");it.draft(q);it.send()};await{!it.busy&&it.messages.lastOrNull()?.str("text")?.isNotEmpty()==true};assertFalse(state().messages.last().optBoolean("isError"))}

    @Test fun all_image_providers_support_generate_edit_and_multiple_references_without_external_calls() {
        login();await {it.catalog.arr("models").length()>0}
        val bytes=java.io.ByteArrayOutputStream().apply{Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG,100,this)}.toByteArray()
        val refs=listOf(file("sweep-a.png",bytes),file("sweep-b.png",bytes))
        for(imageId in listOf("gpt-image-2.5-flare","gpt-image-2.5-sunburst","gemini-nano-banana-2.1","grok-imagine-image-2.0")) {
            for(count in 0..2) {
                model{it.newChat();it.mode("image");it.selectImageModel(imageId)}
                if(count>0){model{it.addFiles(refs.take(count))};await{it.attachments.size==count&&!it.loading}}
                model{it.draft("合成图片协议验收-$imageId-$count");it.send()};await{!it.busy&&it.messages.size==2}
                val output=state().messages.last();assertFalse("$imageId references=$count "+state().error,output.optBoolean("isError"));assertEquals(1,output.arr("imgItems").length());assertTrue(File(output.arr("imgItems").getJSONObject(0).str("localPath")).length()>0)
            }
        }
    }

    @Test fun background_memory_extracts_and_incognito_never_writes_memory() {
        login();ask("请记住：我喜欢合成账号的简短回答")
        ui.waitUntil(20000){request("/memory",json("action" to "get")).str("memory").contains("合成账号")}
        val original=request("/memory",json("action" to "get")).str("memory")
        model{it.incognito(true)};ask("请记住：这个无痕内容不能进入记忆")
        assertEquals(original,request("/memory",json("action" to "get")).str("memory"))
    }

    @Test fun scheduled_task_edit_pause_automatic_alarm_and_delete_keep_sol_low() {
        login();val id=UUID.randomUUID().toString()
        val schedule=json("frequency" to "once","timeZone" to "Asia/Shanghai","at" to java.time.Instant.now().plusSeconds(5).toString())
        val task=request("/schedules",json("action" to "create","id" to id,"name" to "自动触发验收","prompt" to "合成自动任务","model" to "gpt-6.1-sol","effort" to "low","enabled" to false,"schedule" to schedule)).obj("task")
        request("/schedules",json("action" to "update","id" to id,"name" to "修改后任务","prompt" to "修改后的合成指令","model" to "gpt-6.1-sol","effort" to "low","enabled" to true,"schedule" to schedule))
        ui.waitUntil(60000){request("/schedules",json("action" to "list")).arr("tasks").objects().any{it.str("id")==id&&it.str("status")=="completed"}}
        val done=request("/schedules",json("action" to "list")).arr("tasks").objects().first{it.str("id")==id};assertFalse(done.optBoolean("enabled"));assertEquals("low",done.str("effort"));assertEquals(1,done.arr("history").length())
        request("/schedules",json("action" to "toggle","id" to id,"enabled" to false));request("/schedules",json("action" to "delete","id" to id));assertTrue(request("/schedules",json("action" to "list")).arr("tasks").objects().none{it.str("id")==id})
    }

    @Test fun active_run_reconnects_after_activity_recreation_without_duplicate_generation() {
        login();model{it.skillConfig(json("mode" to "off","ids" to JSONArray()));it.draft("原生运行中重建活动验收");it.send()};await{it.messages.size==2&&it.messages.last().obj("run").str("id").isNotBlank()}
        val id=state().chatId;val ref=state().messages.last().obj("run");scene.recreate();await{!it.loading&&it.chatId==id&&it.messages.size==2};await{!it.busy&&it.messages.last().obj("run").str("status")=="completed"}
        assertEquals(ref.str("id"),state().messages.last().obj("run").str("id"));assertEquals(2,request("/chats",json("action" to "load","chatId" to id)).arr("messages").length())
    }

    @Test fun ordinary_accounts_cannot_read_owner_chats_projects_or_usage() {
        login();ask("账号隔离合成记录");val chatId=state().chatId;val project=request("/projects",json("action" to "create","name" to "仅所有者可读项目")).obj("project").str("id")
        val other=NativeApi(base);val signed=runBlocking{other.route("login",json("username" to "qa-regular","password" to "offline-fixture"),null)};other.token=signed.str("token")
        assertTrue(runBlocking{other.call("/chats",json("action" to "list"))}.arr("chats").objects().none{it.str("id")==chatId})
        assertTrue(runBlocking{other.call("/projects",json("action" to "list"))}.arr("projects").objects().none{it.str("id")==project})
        assertTrue(runCatching{runBlocking{other.call("/projects",json("action" to "get","projectId" to project))}}.isFailure)
        assertTrue(runCatching{runBlocking{other.route("users")}}.isFailure)
    }
}
