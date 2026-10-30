package com.pickandcase.assistant

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeFeatureRuntimeTest : NativeHarness() {
    @Test
    fun automatic_image_quality_selects_max_with_one_gesture() {
        login()
        model { it.mode("image") }
        ui.onNodeWithText("图像设置").performClick()
        ui.onNodeWithTag("ordered-slider-画质").performScrollTo().performTouchInput {
            click(Offset(width * 0.95f, height / 2f))
        }
        await { it.imageSettings.str("quality") == "max" }
        screenshot("native-image-settings")
    }

    @Test
    fun regenerating_and_editing_preserve_document_and_vision_inputs() {
        login()
        val picture =
            java.io
                .ByteArrayOutputStream()
                .apply {
                    Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
                        .compress(Bitmap.CompressFormat.PNG, 100, this)
                }
                .toByteArray()
        val files =
            listOf(
                fixture("branch-context.txt", "保留这段附件上下文".toByteArray()),
                fixture("branch-reference.png", picture),
            )
        model { it.addFiles(files.map(::uri)) }
        await { it.attachments.size == 2 && !it.loading }
        model {
            it.draft("合成附件问题")
            it.send()
        }
        await { it.messages.size == 2 && !it.busy }
        val first = current()
        model { it.regenerate(first.messages.last()) }
        await(25000) { it.chatId != first.chatId && it.messages.size == 2 && !it.busy }
        assertEquals(1, current().messages.first().arr("imgSrcs").length())
        assertTrue(
            current().messages.first().arr("pastedTexts").strings().single().contains("保留这段附件上下文")
        )
        model { it.fork(current().messages.first(), "修改后的附件问题") }
        await { it.attachments.size == 2 && !it.loading }
        model { it.send() }
        await { it.messages.size == 2 && !it.busy }
        assertFalse(current().messages.last().optBoolean("isError"))
        assertEquals(1, current().messages.first().arr("imgSrcs").length())
    }

    @Test
    fun reasoning_slider_reaches_both_endpoints_without_calling_a_model() {
        login()
        ui.onNodeWithText("GPT-6.1 Sol · Low").performClick()
        ui.onNodeWithText("模型与思考深度").assertExists()
        val slider =
            ui.onNode(
                SemanticsMatcher.keyIsDefined(
                    androidx.compose.ui.semantics.SemanticsProperties.ProgressBarRangeInfo
                )
            )
        slider.performTouchInput { click(Offset(width * 0.95f, height / 2f)) }
        ui.waitForIdle()
        println(
            "Native slider effort=" +
                current().effort +
                " range=" +
                slider
                    .fetchSemanticsNode()
                    .config[androidx.compose.ui.semantics.SemanticsProperties.ProgressBarRangeInfo]
        )
        screenshot("native-slider-endpoint")
        await { it.effort == "max" }
        slider.performTouchInput { click(Offset(width * 0.05f, height / 2f)) }
        await { it.effort == "low" }
    }

    @Test
    fun editing_a_message_keeps_prior_history_in_a_separate_thread() {
        login()
        model {
            it.draft("第一条合成问题")
            it.send()
        }
        await { it.messages.size == 2 && !it.busy }
        model {
            it.draft("第二条合成问题")
            it.send()
        }
        await { it.messages.size == 4 && !it.busy }
        val original = current()
        val edited =
            original.messages.first { it.optBoolean("isUser") && it.str("text") == "第二条合成问题" }
        model {
            it.fork(edited, "修改后的第二条问题")
            it.send()
        }
        await(25000) { it.messages.size == 4 && !it.busy }
        assertNotEquals(original.chatId, current().chatId)
        assertEquals(original.messages.first().str("text"), current().messages.first().str("text"))
        assertFalse(
            current().messages.last().str("text"),
            current().messages.last().optBoolean("isError"),
        )
    }

    private fun current(): AssistantState {
        lateinit var value: AssistantState
        scene.onActivity {
            value = ViewModelProvider(it)[AssistantViewModel::class.java].state.value
        }
        return value
    }

    private fun await(timeout: Long = 20000, predicate: (AssistantState) -> Boolean) {
        ui.waitUntil(timeout) { predicate(current()) }
    }

    private fun api() = NativeApi(base).apply { token = NativeSession(app).load()!!.token }

    private fun fixture(name: String, bytes: ByteArray): File =
        File(app.filesDir, "attachments/$name").apply {
            parentFile!!.mkdirs()
            writeBytes(bytes)
        }

    private fun uri(file: File) = FileProvider.getUriForFile(app, app.packageName + ".files", file)

    private fun zipped(name: String, entries: Map<String, String>): File {
        val target = fixture(name, byteArrayOf())
        ZipOutputStream(target.outputStream()).use { out ->
            entries.forEach { (path, text) ->
                out.putNextEntry(ZipEntry(path))
                out.write(text.toByteArray())
                out.closeEntry()
            }
        }
        return target
    }

    @Test
    fun private_project_upload_download_update_remove_restore_and_reading_mode() {
        login()
        val api = api()
        val project =
            runBlocking { api.call("/projects", json("action" to "create", "name" to "原生私有资料验收")) }
                .obj("project")
        model { it.openProject(project) }
        await { it.page == Page.PROJECT && it.project?.str("id") == project.str("id") }
        val original = "sku,price\n00123,1.50\n".toByteArray()
        val source = fixture("native-original.csv", original)
        model { it.importProjectFiles(listOf(uri(source))) }
        await(30000) { it.project?.arr("files")?.length() == 1 && !it.loading }
        val first = current().project!!.arr("files").getJSONObject(0)
        assertEquals("r2", first.str("storage"))
        assertEquals("ready", first.str("status"))
        val destination = fixture("native-exported.csv", byteArrayOf())
        val inst = InstrumentationRegistry.getInstrumentation()
        val monitor =
            inst.addMonitor(
                IntentFilter(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    addDataType("*/*")
                },
                Instrumentation.ActivityResult(
                    Activity.RESULT_OK,
                    Intent().setData(uri(destination)),
                ),
                true,
            )
        try {
            model { it.downloadProjectFile(first) }
            ui.waitUntil(10000) { destination.length() == original.size.toLong() }
            assertArrayEquals(original, destination.readBytes())
        } finally {
            inst.removeMonitor(monitor)
        }
        model {
            it.projectAction("update", project.str("id"), json("readingMode" to "full")) { itData ->
                it.openProject(itData.obj("project").takeIf { p -> p.has("id") } ?: project)
            }
        }
        await { it.project?.str("readingMode") == "full" }
        val changed = fixture("native-new-version.csv", "sku,price\n000456,2.50\n".toByteArray())
        model { it.importProjectFiles(listOf(uri(changed)), first.str("id")) }
        await(30000) {
            it.project?.arr("files")?.objects()?.any { f -> f.str("name") == changed.name } ==
                true && !it.loading
        }
        val latest =
            current().project!!.arr("files").objects().first { it.str("name") == changed.name }
        assertNotEquals(first.str("id"), latest.str("id"))
        model {
            it.projectAction(
                "remove_file",
                project.str("id"),
                json("fileId" to latest.str("id")),
            ) { _ ->
                it.openProject(project)
            }
        }
        await { it.project?.arr("files")?.length() == 0 }
        model {
            it.projectAction(
                "restore_file",
                project.str("id"),
                json("fileId" to latest.str("id")),
            ) { _ ->
                it.openProject(project)
            }
        }
        await { it.project?.arr("files")?.length() == 1 }
        screenshot("native-project-files")
    }

    @Test
    fun history_groups_pinning_renaming_and_project_move_use_shared_records() {
        login()
        val api = api()
        val id = UUID.randomUUID().toString()
        val uid = System.currentTimeMillis()
        runBlocking {
            api.call(
                "/chats",
                json(
                    "action" to "save",
                    "chatId" to id,
                    "title" to "原生历史验收",
                    "messages" to
                        JSONArray(
                            listOf(
                                json("uid" to uid, "isUser" to true, "text" to "虚构问题"),
                                json(
                                    "uid" to uid + 1,
                                    "name" to "GPT-6.1 Sol",
                                    "submodel" to "gpt-6.1-sol",
                                    "text" to "虚构回答",
                                    "chatMode" to "chat",
                                ),
                            )
                        ),
                ),
            )
        }
        model { it.loadHistory() }
        await { it.histories.any { chat -> chat.str("id") == id } }
        model { it.historyAction("rename", id, json("title" to "已重命名")) }
        await { it.histories.any { chat -> chat.str("id") == id && chat.str("title") == "已重命名" } }
        model { it.historyAction("pin", id, json("pinned" to true)) }
        await { it.histories.any { chat -> chat.str("id") == id && chat.optBoolean("pinned") } }
        val project =
            runBlocking { api.call("/projects", json("action" to "create", "name" to "历史移动目标")) }
                .obj("project")
        model { it.historyAction("move", id, json("targetProjectId" to project.str("id"))) }
        await { it.histories.none { chat -> chat.str("id") == id } }
        model { it.openChat(id, "已重命名", project) }
        await { it.messages.size == 2 }
        assertEquals("虚构回答", current().messages.last().str("text"))
        screenshot("native-history-project")
    }

    @Test
    fun each_debate_mode_and_summary_run_with_sol_low() {
        login()
        for (mode in listOf("free", "persona", "2v2")) {
            val count = if (mode == "2v2") 4 else 2
            val members =
                (0 until count).map { index ->
                    json(
                        "id" to "member-$index",
                        "label" to "席位 ${index+1}",
                        "model" to "gpt-6.1-sol",
                        "effort" to "low",
                        "role" to "研究员 ${index+1}",
                        "team" to if (index < 2) "pro" else "con",
                    )
                }
            model {
                it.newChat()
                it.mode("debate")
                it.debateConfig(
                    json(
                        "mode" to mode,
                        "rounds" to 1,
                        "objective" to "explore",
                        "detail" to "balanced",
                        "members" to JSONArray(members),
                        "summaryModel" to "gpt-6.1-sol",
                        "summaryEffort" to "low",
                    )
                )
                it.draft("合成讨论：如何比较两个方案")
                it.send()
            }
            await(40000) { it.run?.str("status") == "completed" && !it.busy }
            assertTrue(
                current()
                    .messages
                    .filterNot { it.optBoolean("isUser") }
                    .all { !it.optBoolean("isError") }
            )
            assertEquals(count + 1, current().run!!.arr("turns").length())
        }
        screenshot("native-debate-2v2")
    }

    @Test
    fun failed_debate_turn_retries_without_repeating_completed_seats() {
        login()
        model {
            it.mode("debate")
            it.draft("合成重试验收")
            it.send()
        }
        await(25000) { it.run?.str("status") == "paused" && !it.busy }
        val before = current()
        val first = before.messages.first { it.str("participantId") == "seat-1" }.str("text")
        val failed = before.messages.first { it.str("turnStatus") == "failed" }
        model { it.debateAction("retry", failed) }
        await(30000) { it.run?.str("status") == "completed" && !it.busy }
        assertEquals(
            first,
            current().messages.first { it.str("participantId") == "seat-1" }.str("text"),
        )
        assertTrue(current().messages.none { it.str("turnStatus") == "failed" })
        screenshot("native-debate-recovery")
    }

    @Test
    fun scheduler_preserves_sol_low_and_produces_a_history_record() {
        login()
        val api = api()
        val id = UUID.randomUUID().toString()
        val created =
            runBlocking {
                    api.call(
                        "/schedules",
                        json(
                            "action" to "create",
                            "id" to id,
                            "name" to "原生定时任务验收",
                            "prompt" to "合成任务问题",
                            "model" to "gpt-6.1-sol",
                            "effort" to "low",
                            "enabled" to false,
                            "schedule" to
                                json(
                                    "frequency" to "once",
                                    "timeZone" to "Asia/Shanghai",
                                    "at" to java.time.Instant.now().plusSeconds(86400).toString(),
                                ),
                        ),
                    )
                }
                .obj("task")
        assertEquals("low", created.str("effort"))
        model { it.navigate(Page.TASKS) }
        await { it.data.arr("tasks").objects().any { task -> task.str("id") == id } }
        model { it.taskAction("run", created) }
        ui.waitUntil(25000) {
            val tasks =
                runBlocking { api.call("/schedules", json("action" to "list")) }
                    .arr("tasks")
                    .objects()
            tasks.any { it.str("id") == id && it.str("status") == "completed" }
        }
        val finished =
            runBlocking { api.call("/schedules", json("action" to "list")) }
                .arr("tasks")
                .objects()
                .first { it.str("id") == id }
        assertTrue(finished.arr("history").length() > 0)
        model { it.openTaskChat(finished, finished.arr("history").getJSONObject(0).str("chatId")) }
        await {
            it.messages.any { message ->
                !message.optBoolean("isUser") && message.str("text").isNotEmpty()
            }
        }
        screenshot("native-scheduled-result")
    }

    @Test
    fun native_office_parsers_preserve_text_and_xlsb_is_readable() {
        login()
        val docs =
            zipped(
                "native.docx",
                mapOf(
                    "word/document.xml" to
                        "<w:document xmlns:w=\"urn:w\"><w:p><w:r><w:t>原生文档 00123</w:t></w:r></w:p></w:document>"
                ),
            )
        val word = NativeFiles(app).import(uri(docs)).single()
        assertTrue(word.text.contains("00123"))
        val spreadsheet =
            fixture(
                "native-sample.xlsb",
                InstrumentationRegistry.getInstrumentation()
                    .context
                    .assets
                    .open("Simple.xlsb")
                    .use { it.readBytes() },
            )
        val binary = NativeFiles(app).import(uri(spreadsheet)).single()
        assertTrue("XLSB text must be readable on Android", binary.text.isNotBlank())
        val odt =
            zipped(
                "native.odt",
                mapOf(
                    "content.xml" to
                        "<office:document xmlns:office=\"urn:o\" xmlns:text=\"urn:t\"><text:p>000456 原生 ODT</text:p></office:document>"
                ),
            )
        assertTrue(NativeFiles(app).import(uri(odt)).single().text.contains("000456"))
        val archive =
            zipped(
                "native-materials.zip",
                mapOf("资料/子目录/编号.csv" to "sku\n00123\n", "资料/readme.md" to "原生测试"),
            )
        val contents = NativeFiles(app).projectImport(uri(archive))
        assertEquals(2, contents.size)
        assertTrue(contents.any { it.relativePath == "资料/子目录/编号.csv" && it.text.contains("00123") })
    }

    @Test
    fun native_mask_paints_a_matching_alpha_png_and_gallery_keeps_original_bytes() {
        login()
        val original = fixture("native-mask-source.png", byteArrayOf())
        val bitmap = Bitmap.createBitmap(120, 80, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.GREEN)
        original.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        model {
            it.mode("image")
            it.addFiles(listOf(uri(original)))
        }
        await { it.attachments.size == 1 && !it.loading }
        ui.onNodeWithText("图像设置").performClick()
        ui.onNodeWithText("涂抹修改区域").performScrollTo().performClick()
        waitFor("mask-canvas")
        ui.onNodeWithTag("mask-canvas").performTouchInput {
            swipe(Offset(width * .2f, height * .5f), Offset(width * .8f, height * .5f), 500)
        }
        ui.onNodeWithText("应用").performClick()
        await { it.imageMask != null }
        val mask = BitmapFactory.decodeFile(current().imageMask!!.path)
        assertEquals(120, mask.width)
        assertEquals(80, mask.height)
        assertEquals(0, android.graphics.Color.alpha(mask.getPixel(60, 40)))
        assertEquals(255, android.graphics.Color.alpha(mask.getPixel(2, 2)))
        mask.recycle()
        val saved = NativeFiles(app).saveGallery(original, "image/png")!!
        val bytes = app.contentResolver.openInputStream(saved)!!.use { it.readBytes() }
        assertArrayEquals(original.readBytes(), bytes)
        app.contentResolver.delete(saved, null, null)
    }

    @Test
    fun image_generation_edit_and_multiple_references_use_the_native_stream() {
        login()
        model {
            it.mode("image")
            it.draft("合成协议测试，生成一个色块")
            it.send()
        }
        await(25000) { !it.busy && it.messages.lastOrNull()?.arr("imgItems")?.length() == 1 }
        assertFalse(
            current().messages.last().str("generationError"),
            current().messages.last().optBoolean("isError"),
        )
        val generated = current().messages.last()
        model { it.editImage(generated, 0) }
        await { it.attachments.size == 1 }
        model {
            it.draft("合成编辑测试")
            it.send()
        }
        await(25000) { !it.busy && it.messages.count { m -> m.arr("imgItems").length() > 0 } == 2 }
        val source =
            fixture(
                "native-reference-two.png",
                android.util.Base64.decode(
                    current().messages.last().arr("imgItems").getJSONObject(0).str("data"),
                    android.util.Base64.DEFAULT,
                ),
            )
        model { it.editImage(current().messages.last(), 0) }
        await { it.attachments.size == 1 }
        model { it.addFiles(listOf(uri(source))) }
        await { it.attachments.size == 2 && !it.loading }
        model {
            it.imageConfig(it.state.value.imageModel, "multi-edit", it.state.value.imageSettings)
            it.draft("合成多图编辑测试")
            it.send()
        }
        await(25000) { !it.busy && it.messages.count { m -> m.arr("imgItems").length() > 0 } == 3 }
        screenshot("native-image-result")
    }

    @Test
    fun prompts_skills_memory_and_usage_pages_are_native_and_account_scoped() {
        login()
        val api = api()
        runBlocking {
            api.call("/system-prompt", json("action" to "save", "prompt" to "仅用于原生合成验收"))
        }
        model { it.navigate(Page.PROMPT) }
        await { it.data.str("prompt").contains("原生合成验收") }
        model { it.navigate(Page.MEMORY) }
        await { !it.loading }
        ui.onNodeWithText("记忆", substring = false).assertExists()
        model { it.navigate(Page.SKILLS) }
        ui.waitForIdle()
        model { it.navigate(Page.USAGE) }
        await { !it.loading && it.data.has("total") }
        screenshot("native-usage")
    }
}
