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
    private val preferences = context.getSharedPreferences("native_project_upload_v2", 0)

    suspend fun upload(
        account: String,
        project: String,
        attachment: NativeAttachment,
        replaceId: String? = null,
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
        val id = saved.str("id").ifBlank { UUID.randomUUID().toString() }
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
        suspend fun action(name: String, extra: JSONObject = JSONObject()): JSONObject =
            api.call(
                "/projects",
                extra.put("action", "library_" + name).put("projectId", project).put("fileId", id),
            )
        fun persist() {
            preferences.edit().putString(key, saved.toString()).apply()
        }
        val start = action("start", json("file" to descriptor, "replaceFileId" to replaceId))
        persist()
        if (start.obj("file").str("status") in listOf("ready", "partial")) {
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
                        )
                    parts.add(result.obj("part"))
                    saved.put("parts", JSONArray(parts.sortedBy { it.optInt("partNumber") }))
                    persist()
                }
                onProgress("上传 ${attachment.name} · $part / $count")
            }
            action("original_complete", json("parts" to saved.arr("parts")))
        }
        try {
            require(attachment.text.isNotBlank() && attachment.emptyUnits < attachment.units) {
                attachment.parseError.ifBlank { "没有可读文字；原文件已保留，扫描 PDF 需要先进行 OCR" }
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
            val result =
                action(
                    "commit",
                    json(
                        "segments" to ordinal,
                        "coverage" to
                            json("units" to attachment.units, "emptyUnits" to attachment.emptyUnits),
                    ),
                )
            preferences.edit().remove(key).apply()
            return result.obj("file")
        } catch (error: Exception) {
            runCatching { action("parse_failed", json("error" to (error.message ?: "解析未完成"))) }
            throw error
        }
    }
}
