package com.pickandcase.assistant

import android.content.Context
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Original bytes go to the same private, resumable project store used by the website. */
class NativeProjectUploads(context: Context, private val api: NativeApi) {
    private val context = context.applicationContext
    private val preferences = context.getSharedPreferences("native_project_upload_v2", 0)

    suspend fun upload(
        account: String,
        project: String,
        attachment: NativeAttachment,
        replaceId: String? = null,
        chatId: String? = null,
        conversationProjectId: String? = null,
        existingId: String? = null,
        onProgress: (String) -> Unit,
    ): JSONObject {
        val source = File(attachment.path)
        val digest =
            withContext(Dispatchers.IO) {
                val hash = MessageDigest.getInstance("SHA-256")
                source.inputStream().use { input ->
                    val buffer = ByteArray(32768)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        hash.update(buffer, 0, n)
                    }
                }
                hash.digest().joinToString("") { "%02x".format(it) }
            }
        val key =
            sha256(
                listOf(
                        account,
                        project,
                        attachment.relativePath,
                        attachment.size.toString(),
                        digest,
                        replaceId.orEmpty(),
                    )
                    .joinToString("\u0000")
            )
        val saved =
            runCatching { JSONObject(preferences.getString(key, "{}") ?: "{}") }
                .getOrDefault(JSONObject())
        val id = existingId ?: saved.str("id").ifBlank { UUID.randomUUID().toString() }
        saved.put("id", id)
        val descriptor =
            json(
                "id" to id,
                "name" to attachment.name,
                "size" to attachment.size,
                "type" to attachment.mime,
            )
        if (attachment.relativePath.contains('/'))
            descriptor
                .put("folder", attachment.relativePath.substringBefore('/'))
                .put("relativePath", attachment.relativePath.substringAfter('/'))
        var generation: String? = null
        suspend fun action(name: String, extra: JSONObject = JSONObject()): JSONObject =
            api.call(
                if(chatId == null) "/projects" else "/conversation-files",
                extra.put("action", "library_" + name).put("projectId", if(chatId == null) project else conversationProjectId).put("chatId",chatId).put("fileId", id).also { if(generation!=null)it.put("generation",generation) },
            )
        fun persist() {
            preferences.edit().putString(key, saved.toString()).apply()
        }
        val start = if(existingId!=null) action("reparse").also { generation=it.str("generation") } else action("start", json("file" to descriptor, "replaceFileId" to replaceId))
        persist()
        if (start.obj("file").str("status") in listOf("ready", "partial") && start.obj("file").obj("coverage").str("sourceVersion")=="20261031-directfiles1") {
            preferences.edit().remove(key).apply()
            return start.obj("file")
        }
        if (start.obj("file").str("status") == "uploading") {
            val size = start.getLong("partSize")
            val parts = saved.arr("parts").objects().toMutableList()
            val count = maxOf(1L, (attachment.size + size - 1) / size).toInt()
            for (part in 1..count) {
                if (parts.none { it.optInt("partNumber") == part }) {
                    val offset = (part - 1) * size
                    val result =
                        api.uploadPart(
                            project,
                            id,
                            part,
                            source,
                            offset,
                            minOf(size, attachment.size - offset),
                            chatId,conversationProjectId,
                        )
                    parts.add(result.obj("part"))
                    saved.put("parts", JSONArray(parts.sortedBy { it.optInt("partNumber") }))
                    persist()
                }
                onProgress("上传 ${attachment.name} · $part / $count")
            }
            action("original_complete", json("parts" to saved.arr("parts")))
        }
        return withContext(Dispatchers.IO) { try {
            if(start.obj("file").str("status") in listOf("ready","partial","unreadable"))generation=action("reparse").str("generation")
            require(attachment.text.isNotBlank() || attachment.name.endsWith(".pdf",true) || attachment.image || attachment.name.substringAfterLast('.').lowercase() in listOf("docx","xlsx","pptx","odt","odp","ods")) {
                attachment.parseError.ifBlank { "此文件没有可提取文字，请转换为 PDF 后发送" }
            }
            var ordinal = 0
            var offset = 0
            val batch = mutableListOf<JSONObject>()
            while (offset < attachment.text.length) {
                var end = minOf(attachment.text.length, offset + 8000)
                if (end < attachment.text.length && attachment.text[end - 1].isHighSurrogate())
                    end--
                batch.add(
                    json(
                        "ordinal" to ordinal++,
                        "location" to "文字片段 $ordinal",
                        "text" to attachment.text.substring(offset, end),
                    )
                )
                offset = end
                if (batch.size == 24 || offset == attachment.text.length) {
                    action("segments", json("segments" to JSONArray(batch)))
                    batch.clear()
                    onProgress("索引 ${attachment.name} · $ordinal 个片段")
                }
            }
            var visuals=0
            suspend fun image(bytes: ByteArray, where: String) {
                val media=action("media",json("page" to (visuals+1),"total" to Int.MAX_VALUE,"location" to where,"mime" to "image/jpeg","data" to android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP))).obj("media")
                action("segments",json("segments" to JSONArray().put(json("ordinal" to ordinal++,"location" to where,"text" to "","media" to media))))
                visuals++;onProgress("准备原图 $visuals（不调用模型）")
            }
            visuals(attachment) { bytes,where -> image(bytes,where) }
            require(ordinal>0) { "未提取到可读取图文，原件已保留，请检查文件或转换为 PDF" }
            val result=action("commit",json("segments" to ordinal,"coverage" to json("units" to maxOf(attachment.units,visuals),"emptyUnits" to 0,"preparedVisuals" to visuals,"visualComplete" to true,"sourceVersion" to "20261031-directfiles1")))
            preferences.edit().remove(key).apply()
            result.obj("file")
        } catch (error: Exception) {
            runCatching { action("parse_failed", json("error" to (error.message ?: "解析未完成"))) }
            throw error
        }
        }
    }

    private fun decodeBitmap(input: () -> java.io.InputStream): android.graphics.Bitmap {
        val bounds=android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds=true }
        input().use { android.graphics.BitmapFactory.decodeStream(it,null,bounds) }
        var sample=1
        while(maxOf(bounds.outWidth,bounds.outHeight)/sample>3000)sample*=2
        val options=android.graphics.BitmapFactory.Options().apply { inSampleSize=sample }
        return input().use { android.graphics.BitmapFactory.decodeStream(it,null,options) }?:error("内嵌图片无法解析，请转换为 PDF")
    }
    private suspend fun visuals(attachment: NativeAttachment, image: suspend (ByteArray,String)->Unit) {
        val source=File(attachment.path)
        if(attachment.image) {
            val bitmap=decodeBitmap { source.inputStream() }
            val data=try{java.io.ByteArrayOutputStream().use { out->bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,92,out);out.toByteArray() }}finally{bitmap.recycle()}
            image(data,"图片原件")
        }else if(attachment.name.endsWith(".pdf",true)) {
            android.os.ParcelFileDescriptor.open(source,android.os.ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                android.graphics.pdf.PdfRenderer(descriptor).use { renderer ->
                for(page in 0 until renderer.pageCount)renderer.openPage(page).use { view ->
                    val scale=minOf(4f,3000f/maxOf(view.width,view.height))
                    val bitmap=android.graphics.Bitmap.createBitmap(maxOf(1,(view.width*scale).toInt()),maxOf(1,(view.height*scale).toInt()),android.graphics.Bitmap.Config.ARGB_8888)
                    val bytes=try{bitmap.eraseColor(android.graphics.Color.WHITE);view.render(bitmap,null,null,android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);java.io.ByteArrayOutputStream().use { buffer-> bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,90,buffer);buffer.toByteArray() }}finally{bitmap.recycle()}
                    image(bytes,"第 ${page+1} 页")
                }
                }
            }
        }else if(attachment.name.substringAfterLast('.').lowercase() in listOf("docx","xlsx","pptx","odt","odp","ods")){
            java.util.zip.ZipFile(source).use { zip ->
                val entries=zip.entries().asSequence().filter { !it.isDirectory && (it.name.startsWith("Pictures/") || Regex("^(word|xl|ppt)/media/").containsMatchIn(it.name)) }.toList()
                for(entry in entries){
                val bitmap=decodeBitmap { zip.getInputStream(entry) }
                val bytes=try{java.io.ByteArrayOutputStream().use { out->bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,92,out);out.toByteArray() }}finally{bitmap.recycle()}
                image(bytes,"内嵌图片 · ${entry.name}")
                }
            }
        }
    }
    suspend fun inlineFile(attachment: NativeAttachment, provider: String): JSONObject = withContext(Dispatchers.IO) {
        require(attachment.text.length<=600000) { "无痕文件较大，请分批发送或使用普通对话" }
        val parts=JSONArray();var ordinal=0;var bytes=0
        attachment.text.chunked(2400).filter { it.isNotBlank() }.forEach { parts.put(json("text" to it,"location" to "正文片段 ${++ordinal}")) }
        val result=json("id" to attachment.id,"name" to attachment.name,"status" to "ready","segments" to parts)
        if(attachment.name.endsWith(".pdf",true)&&attachment.size<=8L*1024*1024&&provider!="xai") {
            result.put("original",json("mime" to "application/pdf","size" to attachment.size,"data" to android.util.Base64.encodeToString(attachment.bytes(),android.util.Base64.NO_WRAP)))
        }else visuals(attachment) { data,where ->
            bytes+=data.size;require(bytes<=8*1024*1024) { "无痕图文超过本次传输容量，请使用普通对话或分批发送" }
            parts.put(json("text" to "","location" to where,"media" to json("id" to UUID.randomUUID().toString(),"mime" to "image/jpeg","size" to data.size,"data" to android.util.Base64.encodeToString(data,android.util.Base64.NO_WRAP))))
        }
        require(parts.length()<=192) { "无痕文件片段较多，请分批发送或使用普通对话" }
        result
    }
}
