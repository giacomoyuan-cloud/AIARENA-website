package com.pickandcase.assistant

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject

fun json(vararg values: Pair<String, Any?>): JSONObject =
    JSONObject().apply { values.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) } }

fun JSONObject.str(key: String, fallback: String = ""): String =
    if (isNull(key)) fallback else optString(key, fallback)

fun JSONObject.obj(key: String): JSONObject = optJSONObject(key) ?: JSONObject()

fun JSONObject.arr(key: String): JSONArray = optJSONArray(key) ?: JSONArray()

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

fun JSONArray.strings(): List<String> = (0 until length()).map { optString(it) }

fun JSONObject.copyJson() = JSONObject(toString())

fun JSONObject.requiresHostedSkill(): Boolean = str("kind") == "compute" || when (val official = opt("official")) {
    is Boolean -> official
    is String -> official.isNotBlank()
    else -> false
}


fun nativeImageItems(message: JSONObject): List<JSONObject> {
    val items = message.arr("imgItems").objects()
    if (items.isNotEmpty()) return items
    if (message.str("imgData").isNotBlank())
        return listOf(
            json("data" to message.str("imgData"), "mime" to message.str("imgMime", "image/png"))
        )
    return message
        .arr("imgSrcs")
        .strings()
        .filter { it.startsWith("data:image/") && it.contains(";base64,") }
        .map {
            json(
                "mime" to it.substringAfter("data:").substringBefore(';'),
                "data" to it.substringAfter(";base64,"),
            )
        }
}

fun sha256(value: String) =
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString(
        ""
    ) {
        "%02x".format(it)
    }

class ApiFailure(val status: Int, message: String) : Exception(message)

data class StreamFrame(val id: Long, val value: String)

class NativeApi(
    var baseUrl: String = BuildConfig.API_URL,
    private val client: OkHttpClient =
        OkHttpClient.Builder()
            .retryOnConnectionFailure(false)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .build(),
) {
    @Volatile var token: String? = null
    private val contentType = "application/json; charset=utf-8".toMediaType()

    private fun request(
        route: String,
        body: JSONObject?,
        method: String = if (body == null) "GET" else "POST",
        authorization: String? = token,
    ): Request {
        val builder =
            Request.Builder()
                .url(baseUrl + route)
                .header("Accept", "application/json, text/event-stream")
        if (authorization != null) builder.header("Authorization", "Bearer $authorization")
        return builder
            .method(
                method,
                if (method == "GET") null
                else (body ?: JSONObject()).toString().toRequestBody(contentType),
            )
            .build()
    }

    private fun problem(status: Int, text: String): ApiFailure =
        ApiFailure(
            status,
            runCatching { JSONObject(text).str("error") }
                .getOrDefault("")
                .ifBlank { "请求未完成（$status），请稍后重试" },
        )

    suspend fun route(
        route: String,
        body: JSONObject? = null,
        authorization: String? = token,
    ): JSONObject =
        withContext(Dispatchers.IO) {
            client.newCall(request(route, body, authorization = authorization)).execute().use {
                response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw problem(response.code, text)
                if (text.isBlank()) JSONObject() else JSONObject(text)
            }
        }

    suspend fun call(
        path: String,
        payload: JSONObject = JSONObject(),
        method: String = "POST",
    ): JSONObject = route("api", json("path" to path, "method" to method, "payload" to payload))

    suspend fun uploadPart(
        projectId: String,
        fileId: String,
        part: Int,
        file: File,
        offset: Long,
        length: Long,
        chatId: String? = null,
        conversationProjectId: String? = null,
    ): JSONObject {
        val authorization = token
        return withContext(Dispatchers.IO) {
            val body =
                object : RequestBody() {
                    override fun contentType() = "application/octet-stream".toMediaType()

                    override fun contentLength() = length

                    override fun writeTo(sink: BufferedSink) {
                        RandomAccessFile(file, "r").use { input ->
                            input.seek(offset)
                            var remaining = length
                            val buffer = ByteArray(16384)
                            while (remaining > 0) {
                                val n =
                                    input.read(
                                        buffer,
                                        0,
                                        minOf(buffer.size.toLong(), remaining).toInt(),
                                    )
                                check(n > 0) { "原文件读取不完整" }
                                sink.write(buffer, 0, n)
                                remaining -= n
                            }
                        }
                    }
                }
            val url =
                baseUrl +
                    (if(chatId == null) "project-upload?project=" + java.net.URLEncoder.encode(projectId, "UTF-8") else "conversation-upload?chat=" + java.net.URLEncoder.encode(chatId,"UTF-8") + "&project=" + java.net.URLEncoder.encode(conversationProjectId.orEmpty(),"UTF-8")) +
                    "&file=" +
                    java.net.URLEncoder.encode(fileId, "UTF-8") +
                    "&part=" +
                    part
            val request =
                Request.Builder()
                    .url(url)
                    .header("Authorization", "Bearer " + authorization)
                    .put(body)
                    .build()
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw problem(response.code, text)
                JSONObject(text)
            }
        }
    }

    suspend fun stream(route: String, body: JSONObject, onFrame: (StreamFrame) -> Unit) =
        withContext(Dispatchers.IO) {
            suspendCancellableCoroutine<Unit> { continuation ->
                val call =
                    client
                        .newBuilder()
                        .readTimeout(15, TimeUnit.MINUTES)
                        .build()
                        .newCall(request(route, body))
                continuation.invokeOnCancellation { call.cancel() }
                call.enqueue(
                    object : Callback {
                        override fun onFailure(call: Call, error: IOException) {
                            if (continuation.isActive) continuation.resumeWithException(error)
                        }

                        override fun onResponse(call: Call, response: Response) {
                            try {
                                response.use {
                                    if (!it.isSuccessful)
                                        throw problem(it.code, it.body?.string().orEmpty())
                                    val input =
                                        it.body?.charStream()?.buffered()
                                            ?: throw ApiFailure(503, "返回内容为空")
                                    var id = 0L
                                    val data = mutableListOf<String>()
                                    while (continuation.isActive) {
                                        val line = input.readLine() ?: break
                                        if (line.isEmpty()) {
                                            if (data.isNotEmpty()) {
                                                val value = data.joinToString("\n")
                                                onFrame(StreamFrame(id, value))
                                                data.clear()
                                                if (value == "[DONE]") break
                                            }
                                        } else if (line.startsWith("id:"))
                                            id = line.substring(3).trim().toLongOrNull() ?: 0L
                                        else if (line.startsWith("data:"))
                                            data.add(line.substring(5).trimStart())
                                    }
                                }
                                if (continuation.isActive) continuation.resume(Unit)
                            } catch (error: Exception) {
                                if (continuation.isActive) continuation.resumeWithException(error)
                            }
                        }
                    }
                )
            }
        }

    suspend fun download(path: String, payload: JSONObject, file: File): String =
        withContext(Dispatchers.IO) {
            client
                .newCall(request("api", json("path" to path, "payload" to payload)))
                .execute()
                .use { response ->
                    if (!response.isSuccessful)
                        throw problem(response.code, response.body?.string().orEmpty())
                    file.outputStream().use { output ->
                        response.body?.byteStream()?.use { it.copyTo(output) }
                    }
                    response.header("Content-Type") ?: "application/octet-stream"
                }
        }
}
