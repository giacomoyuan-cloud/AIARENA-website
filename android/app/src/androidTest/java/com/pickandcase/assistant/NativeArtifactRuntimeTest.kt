package com.pickandcase.assistant

import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.compose.ui.test.*
import androidx.core.content.FileProvider
import java.io.File
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.ZipOutputStream
import java.util.zip.ZipEntry
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeArtifactRuntimeTest : NativeHarness() {
    private fun state():AssistantState { lateinit var s:AssistantState;scene.onActivity{s=ViewModelProvider(it)[AssistantViewModel::class.java].state.value};return s }
    @Test fun generated_artifact_download_preserves_original_bytes_and_delete_persists() {
        login();ui.waitUntil(15000){state().catalog.arr("skills").length()>0}
        val f=File(app.filesDir,"attachments/native-artifact-input.docx");f.parentFile!!.mkdirs()
        ZipOutputStream(f.outputStream()).use{z->z.putNextEntry(ZipEntry("word/document.xml"));z.write("<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Synthetic input</w:t></w:r></w:p></w:body></w:document>".toByteArray());z.closeEntry()}
        model{it.skillConfig(json("mode" to "manual","ids" to JSONArray(listOf("docx"))));it.addFiles(listOf(FileProvider.getUriForFile(app,app.packageName+".files",f)))}
        ui.waitUntil(15000){state().attachments.size==1&&!state().loading};model{it.draft("合成文件下载验收");it.send()}
        ui.waitUntil(30000){!state().busy&&state().messages.size==2};val reply=state().messages.last();assertFalse(state().error,reply.optBoolean("isError"));assertEquals(1,reply.arr("artifacts").length());val artifact=reply.arr("artifacts").getJSONObject(0)
        val downloaded=AtomicReference<File>();model{it.artifact(reply,artifact,onFile={out,_->downloaded.set(out)})};ui.waitUntil(15000){downloaded.get()!=null};assertEquals("Synthetic original artifact bytes",downloaded.get().readText())
        model{it.artifact(reply,artifact,delete=true)};ui.waitUntil(15000){state().messages.last().arr("artifacts").getJSONObject(0).optBoolean("deleted")};val id=state().chatId;model{it.openChat(id,"合成文件下载验收")};ui.waitUntil(15000){!state().loading&&state().messages.size==2};assertTrue(state().messages.last().arr("artifacts").getJSONObject(0).optBoolean("deleted"))
    }
}
