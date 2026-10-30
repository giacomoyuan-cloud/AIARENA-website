package com.pickandcase.assistant

import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import androidx.compose.ui.test.*
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

@RunWith(AndroidJUnit4::class)
class NativeParityRuntimeTest : NativeHarness() {
    private fun snapshot(): AssistantState { lateinit var s:AssistantState;scene.onActivity { s=ViewModelProvider(it)[AssistantViewModel::class.java].state.value };return s }
    private fun await(ms:Long=25000, check:(AssistantState)->Boolean) { ui.waitUntil(ms){check(snapshot())} }
    private fun client()=NativeApi(base).apply { token=NativeSession(app).load()!!.token }
    private fun request(path:String,body:JSONObject)=runBlocking { client().call(path,body) }
    private fun ask(text:String) { model { it.skillConfig(json("mode" to "off","ids" to JSONArray()));it.draft(text);it.send() };await { !it.busy&&it.messages.lastOrNull()?.str("text")?.isNotBlank()==true };assertFalse(snapshot().messages.last().optBoolean("isError")) }

    @Test fun long_history_can_jump_to_top_and_latest_without_losing_messages() {
        login();val id=UUID.randomUUID().toString();val rows=JSONArray()
        for(i in 0..29) rows.put(json("uid" to (1000L+i),"isUser" to false,"name" to "合成记录","text" to ("记录位置-$i "+"原生滚动内容。".repeat(18))))
        request("/chats",json("action" to "save","chatId" to id,"title" to "原生长记录","messages" to rows))
        model { it.openChat(id,"原生长记录") };await { it.messages.size==30&&!it.loading }
        ui.onNodeWithContentDescription("回到对话顶部").performClick();ui.waitUntil(10000){ui.onNodeWithTag("conversation-list").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.VerticalScrollAxisRange].value()==0f};screenshot("native-history-top")
        ui.onNodeWithContentDescription("回到最下面").performClick();ui.waitUntil(10000){val range=ui.onNodeWithTag("conversation-list").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.VerticalScrollAxisRange];range.value()==range.maxValue()};screenshot("native-history-latest")
    }

    @Test fun incognito_is_not_saved_in_shared_history_or_restore_pointer() {
        login();model { it.incognito(true) };val id=snapshot().chatId;ask("原生无痕隔离验收")
        assertFalse(request("/chats",json("action" to "list")).arr("chats").objects().any{it.str("id")==id})
        assertTrue(app.getSharedPreferences("native_preferences_v2",0).getString("last-view:"+snapshot().session!!.accountId,"").orEmpty().isEmpty())
        model { it.incognito(false) };assertFalse(snapshot().incognito);assertTrue(snapshot().messages.isEmpty())
    }

    @Test fun message_quote_like_note_and_search_history_survive_reload() {
        login();ask("原生消息操作与搜索验收");val first=snapshot().messages.last();val id=snapshot().chatId
        model { it.messageFlag(first.optLong("uid"),"_liked",true);it.messageFlag(first.optLong("uid"),"_comment","原生备注");it.quote(first) }
        assertNotNull(snapshot().quote);ask("基于刚才引用的观点继续")
        model { it.openChat(id,"原生消息操作与搜索验收") };await { !it.loading&&it.messages.size==4 }
        val saved=snapshot().messages.first{it.optLong("uid")==first.optLong("uid")};assertTrue(saved.optBoolean("_liked"));assertEquals("原生备注",saved.str("_comment"));assertTrue(snapshot().messages[2].has("_quote"))
        model { it.navigate(Page.HISTORY) };await { it.histories.any{c->c.str("id")==id} }
        ui.onNode(hasSetTextAction()).performTextInput("不存在的搜索词-"+UUID.randomUUID())
        ui.onNodeWithText("没有找到相关对话").assertExists()
    }

    @Test fun history_grouping_and_delete_are_shared_with_web_api() {
        login();ask("原生历史分组删除验收");val id=snapshot().chatId
        val group=request("/chats",json("action" to "create_group","name" to "原生分组-"+UUID.randomUUID().toString().take(6))).obj("group")
        model { it.historyAction("group",id,json("groupId" to group.str("id"))) };await { it.histories.any{c->c.str("id")==id&&c.str("groupId")==group.str("id")} }
        model { it.historyAction("group",id,json("groupId" to JSONObject.NULL)) };await { it.histories.any{c->c.str("id")==id&&c.isNull("groupId")} }
        model { it.historyAction("delete",id) };await { it.histories.none{c->c.str("id")==id} };assertFalse(request("/chats",json("action" to "list")).arr("chats").objects().any{it.str("id")==id})
    }

    @Test fun project_instructions_memory_pin_archive_delete_and_restore() {
        login();val p=request("/projects",json("action" to "create","name" to "原生项目生命周期","instructions" to "初始说明")).obj("project");val id=p.str("id")
        model { it.openProject(p) };await { it.project?.str("id")==id&&!it.loading }
        model { it.projectAction("update",id,json("name" to "修改后的项目","instructions" to "隔离说明","memory" to "隔离项目记忆","readingMode" to "full")) { } }
        await { request("/projects",json("action" to "get","projectId" to id)).obj("project").str("instructions")=="隔离说明" }
        val updated=request("/projects",json("action" to "get","projectId" to id)).obj("project");assertEquals("隔离项目记忆",updated.str("memory"));assertEquals("full",updated.str("readingMode"))
        request("/projects",json("action" to "pin","projectId" to id,"pinned" to true));assertTrue(request("/projects",json("action" to "list")).arr("projects").objects().first{it.str("id")==id}.optBoolean("pinned"))
        request("/projects",json("action" to "archive","projectId" to id));assertTrue(request("/projects",json("action" to "list","includeArchived" to true)).arr("projects").objects().any{it.str("id")==id})
        request("/projects",json("action" to "archive","projectId" to id,"archived" to false));request("/projects",json("action" to "delete","projectId" to id));assertTrue(request("/projects",json("action" to "list","includeDeleted" to true)).arr("projects").objects().any{it.str("id")==id})
        request("/projects",json("action" to "restore","projectId" to id));assertTrue(request("/projects",json("action" to "list")).arr("projects").objects().any{it.str("id")==id})
        model { it.general() };assertNull(snapshot().project)
    }

    @Test fun system_prompts_are_independent_between_project_and_general_and_reset() {
        login();request("/system-prompt",json("action" to "save","prompt" to "普通范围测试提示词"))
        val p=request("/projects",json("action" to "create","name" to "提示词范围项目")).obj("project")
        model { it.openProject(p) };await { it.project?.str("id")==p.str("id")&&it.page==Page.PROJECT };model { it.navigate(Page.PROMPT) };await { !it.loading&&it.data.has("prompt") };assertFalse(snapshot().data.str("prompt").contains("普通范围测试"))
        model { it.service("/system-prompt",json("action" to "save","prompt" to "项目范围测试提示词")){r->it.pageData(r)} };await { it.data.str("prompt")=="项目范围测试提示词" }
        model { it.general();it.navigate(Page.PROMPT) };await { !it.loading&&it.data.str("prompt")=="普通范围测试提示词" }
        model { it.service("/system-prompt",json("action" to "reset")){r->it.pageData(r)} };await { it.data.str("prompt")!="普通范围测试提示词" }
    }

    @Test fun skills_modes_and_official_model_constraints_are_persisted() {
        login();model { it.skillConfig(json("mode" to "off","ids" to JSONArray())) };scene.recreate();await { it.session!=null&&it.catalog.obj("skillModels").length()>0 };assertEquals("off",snapshot().skills.str("mode"))
        model { it.skillConfig(json("mode" to "manual","ids" to JSONArray(listOf("xlsx")))) };assertTrue(snapshot().catalog.obj("skillModels").has(snapshot().model))
        model { it.skillConfig(json("mode" to "auto","ids" to JSONArray()));it.model("gpt-6.1-sol","low") };assertEquals("auto",snapshot().skills.str("mode"));assertEquals("low",snapshot().effort)
    }

    @Test fun theme_switches_preserve_account_and_draft() {
        login();val token=snapshot().session!!.token;model { it.draft("未发送草稿");it.theme("dark") };assertEquals("未发送草稿",snapshot().draft);assertEquals(token,snapshot().session!!.token);scene.onActivity { assertFalse(androidx.core.view.WindowCompat.getInsetsController(it.window,it.window.decorView).isAppearanceLightStatusBars) };screenshot("native-theme-dark")
        scene.recreate();await { it.session!=null };assertEquals("dark",snapshot().theme);assertEquals(token,snapshot().session!!.token)
        model { it.theme("light");it.theme("system") };assertEquals("system",snapshot().theme)
    }

    @Test fun profile_rename_password_avatar_keeps_existing_native_session() {
        login();val name="qa-profile-"+System.currentTimeMillis();runBlocking { client().route("users",json("username" to name,"password" to "initial-password")) }
        model { it.logout() };waitFor("login-submit");login(name,"initial-password");val token=snapshot().session!!.token
        val avatar="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
        model { it.saveProfile("原生显示名",name+"-alias","changed-password",avatar) };await { it.session?.profile?.str("displayName")=="原生显示名" }
        assertEquals(token,snapshot().session!!.token);assertEquals(avatar,snapshot().session!!.profile.str("avatar"));scene.recreate();await { it.session?.profile?.str("displayName")=="原生显示名" }
        val other=NativeApi(base);val signed=runBlocking { other.route("login",json("username" to name+"-alias","password" to "changed-password"),null) };assertFalse(signed.optBoolean("canManage"));assertEquals(name,signed.obj("profile").str("accountId"))
    }

    @Test fun pdf_and_xlsx_parsers_preserve_coverage_leading_zeros_and_text() {
        login();val pdf=File(app.filesDir,"attachments/parity.pdf");pdf.parentFile!!.mkdirs()
        com.tom_roush.pdfbox.android.PDFBoxResourceLoader.init(app)
        com.tom_roush.pdfbox.pdmodel.PDDocument().use { doc ->
            val page=com.tom_roush.pdfbox.pdmodel.PDPage();doc.addPage(page);doc.addPage(com.tom_roush.pdfbox.pdmodel.PDPage())
            com.tom_roush.pdfbox.pdmodel.PDPageContentStream(doc,page).use { content -> content.beginText();content.setFont(com.tom_roush.pdfbox.pdmodel.font.PDType1Font.HELVETICA,12f);content.newLineAtOffset(32f,700f);content.showText("Native PDF coverage test");content.endText() };doc.save(pdf)
        }
        val uri=androidx.core.content.FileProvider.getUriForFile(app,app.packageName+".files",pdf);val parsed=NativeFiles(app).import(uri).single();assertTrue(parsed.text.contains("Native PDF coverage test"));assertEquals(2,parsed.units);assertEquals(1,parsed.emptyUnits)
        val out=File(app.filesDir,"attachments/parity.xlsx")
        org.apache.poi.xssf.usermodel.XSSFWorkbook().use { book ->val sheet=book.createSheet("中文数据");val row=sheet.createRow(0);row.createCell(0).setCellValue("000123");row.createCell(1).setCellValue(12.5);row.createCell(2).setCellValue("原生中文验证");out.outputStream().use(book::write) }
        val x=NativeFiles(app).import(androidx.core.content.FileProvider.getUriForFile(app,app.packageName+".files",out)).single().text;assertTrue(x.contains("000123"));assertTrue(x.contains("12.5"));assertTrue(x.contains("原生中文验证"))
    }
}
