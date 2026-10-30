package com.pickandcase.assistant

import android.content.Context
import android.content.Intent
import android.content.ClipData
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

internal const val MAX_UPDATE_BYTES = 150L * 1024 * 1024

data class NativeRelease(val version: String, val code: Long, val packageName: String, val url: String, val bytes: Long, val sha256: String, val notes: String = "")
enum class UpdatePhase { IDLE, CHECKING, CURRENT, AVAILABLE, DOWNLOADING, READY, FAILED }
data class NativeUpdateState(val phase: UpdatePhase = UpdatePhase.IDLE, val visible: Boolean = false, val release: NativeRelease? = null, val received: Long = 0, val error: String = "", val waitingPermission: Boolean = false)

/** Only the official release feed is accepted in release builds. Never sends account credentials. */
class NativeUpdates(private val context: Context, private val scope: CoroutineScope) {
    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    private val mutable = MutableStateFlow(NativeUpdateState())
    val state = mutable.asStateFlow()
    private val folder = File(context.filesDir, "updates")
    private val preferences = context.getSharedPreferences("native_app_updates", Context.MODE_PRIVATE)
    private var work: Job? = null
    @Volatile private var activeCall: Call? = null
    private var readyFile: File? = null
    private val installedCode get() = versionCode(packageInfo())
    private val manifestUrl get() = if (BuildConfig.DEBUG && NativeTestHooks.updateManifestUrl != null) NativeTestHooks.updateManifestUrl!! else BuildConfig.SITE_URL + "downloads/app-release.json"
    private val fixture get() = BuildConfig.DEBUG && NativeTestHooks.updateManifestUrl != null

    fun automaticCheck() {
        if (BuildConfig.DEBUG && NativeTestHooks.baseUrl != null && !fixture) return
        if (System.currentTimeMillis() - preferences.getLong("lastCheck", 0) < TimeUnit.HOURS.toMillis(12)) return
        check(false)
    }

    fun show() { mutable.update { it.copy(visible = true) }; if (mutable.value.phase == UpdatePhase.IDLE) check(true) }
    fun dismiss() {
        mutable.value.release?.let { preferences.edit().putLong("dismissedVersion", it.code).apply() }
        mutable.update { it.copy(visible = false) }
    }

    fun check(visible: Boolean = true) {
        if (mutable.value.phase == UpdatePhase.DOWNLOADING) { if (visible) mutable.update { it.copy(visible = true) }; return }
        val previous = stopWork()
        mutable.update { NativeUpdateState(phase = UpdatePhase.CHECKING, visible = visible || it.visible) }
        work = scope.launch(Dispatchers.IO) {
            previous?.join()
            ensureActive()
            try {
                val release = response(manifestUrl) { result ->
                    val body = result.body ?: throw IOException("更新信息为空")
                    val out = ByteArrayOutputStream()
                    body.byteStream().use { input ->
                        val buffer = ByteArray(4096)
                        while (true) { ensureActive(); val n = input.read(buffer); if (n < 0) break; if (out.size() + n > 65536) throw IOException("更新信息过大"); out.write(buffer, 0, n) }
                    }
                    parseRelease(JSONObject(out.toString("UTF-8")), manifestUrl, context.packageName, fixture)
                }
                ensureActive()
                preferences.edit().putLong("lastCheck", System.currentTimeMillis()).apply()
                folder.listFiles()?.filter { it.isFile && it.name != "assistant-${release.code}.apk" }?.forEach { it.delete() }
                if (release.code <= installedCode) {
                    folder.listFiles()?.filter { it.isFile }?.forEach { it.delete() }
                    readyFile = null
                    mutable.update { it.copy(phase = UpdatePhase.CURRENT, release = null) }
                } else {
                    val existing = File(folder, "assistant-${release.code}.apk")
                    var ready = false
                    if (existing.isFile) ready = runCatching { verify(existing, release); readyFile = existing; true }.getOrDefault(false)
                    if (!ready) existing.delete()
                    mutable.update { it.copy(phase = if (ready) UpdatePhase.READY else UpdatePhase.AVAILABLE, release = release, visible = it.visible || preferences.getLong("dismissedVersion", 0) != release.code) }
                }
            } catch (error: Exception) {
                ensureActive()
                if (error is CancellationException) throw error
                mutable.update { it.copy(phase = UpdatePhase.FAILED, error = error.message ?: "检查更新失败，请重试") }
            }
        }
    }

    fun download() {
        val release = mutable.value.release ?: return
        if (mutable.value.phase == UpdatePhase.DOWNLOADING) return
        val previous = stopWork()
        mutable.update { it.copy(phase = UpdatePhase.DOWNLOADING, received = 0, error = "", visible = true) }
        work = scope.launch(Dispatchers.IO) {
            previous?.join()
            ensureActive()
            folder.mkdirs()
            val partial = File(folder, "assistant-${release.code}.part")
            try {
                if (folder.usableSpace < release.bytes + 20L * 1024 * 1024) throw IOException("存储空间不足，请清理后重试")
                response(release.url) { result ->
                    val body = result.body ?: throw IOException("更新文件为空")
                    if (body.contentLength() >= 0 && body.contentLength() != release.bytes) throw IOException("更新文件大小不匹配")
                    var received = 0L
                    body.byteStream().use { input -> partial.outputStream().use { output ->
                        val buffer = ByteArray(32768)
                        while (true) {
                            ensureActive()
                            val count = input.read(buffer)
                            if (count < 0) break
                            received += count
                            if (received > release.bytes) throw IOException("更新文件大小不匹配")
                            output.write(buffer, 0, count)
                            mutable.update { it.copy(received = received) }
                        }
                    } }
                }
                ensureActive()
                verify(partial, release)
                val completed = File(folder, "assistant-${release.code}.apk")
                if (completed.exists() && !completed.delete()) throw IOException("无法替换更新文件")
                if (!partial.renameTo(completed)) throw IOException("无法保存更新文件")
                readyFile = completed
                mutable.update { it.copy(phase = UpdatePhase.READY, received = release.bytes) }
            } catch (error: Exception) {
                ensureActive()
                if (error is CancellationException) throw error
                mutable.update { it.copy(phase = UpdatePhase.FAILED, error = error.message ?: "下载更新失败，请重试") }
            } finally { partial.delete() }
        }
    }

    fun close() { stopWork(); client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown() }

    fun cancel() {
        stopWork()
        mutable.update { it.copy(phase = if (it.release != null) UpdatePhase.AVAILABLE else UpdatePhase.IDLE, received = 0, error = "") }
    }
    private fun stopWork(): Job? { val previous = work; previous?.cancel(); activeCall?.cancel(); return previous }

    fun install() {
        val file = readyFile ?: return
        val release = mutable.value.release ?: return
        // Recheck before granting another process read access to the downloaded file.
        scope.launch(Dispatchers.IO) {
            try {
                verify(file, release)
                withContext(Dispatchers.Main) {
                    if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
                        mutable.update { it.copy(waitingPermission = true, error = "") }
                        context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } else {
                        mutable.update { it.copy(waitingPermission = false, error = "") }
                        context.startActivity(installIntent(file))
                    }
                }
            } catch (error: Exception) {
                ensureActive()
                if (error is CancellationException) throw error
                mutable.update { it.copy(error = error.message ?: "无法打开系统安装器，请重试") }
            }
        }
    }
    fun resumed() {
        if (!mutable.value.waitingPermission) return
        mutable.update { it.copy(waitingPermission = false) }
        if (Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()) install()
        else mutable.update { it.copy(error = "请开启“允许来自此来源的应用”，再安装更新") }
    }
    internal fun installIntent(file: File): Intent {
        val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
        return Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply { clipData = ClipData.newRawUri("应用更新", uri) }
    }
    private inline fun <T> response(url: String, block: (okhttp3.Response) -> T): T {
        val call = client.newCall(Request.Builder().url(url).header("User-Agent", "AI-Assistant-Android/" + BuildConfig.VERSION_NAME).header("Cache-Control", "no-cache").build())
        activeCall = call
        try { return call.execute().use { if (!it.isSuccessful) throw IOException("更新服务暂不可用（${it.code}）"); block(it) } }
        finally { if (activeCall === call) activeCall = null }
    }

    internal fun verify(file: File, release: NativeRelease) {
        if (release.code <= installedCode) throw IOException("该版本无需安装")
        if (file.length() != release.bytes) throw IOException("更新文件不完整，请重新下载")
        val hash = MessageDigest.getInstance("SHA-256").apply { file.inputStream().use { input -> val buffer = ByteArray(32768); while (true) { val count = input.read(buffer); if (count < 0) break; update(buffer, 0, count) } } }.digest().joinToString("") { "%02x".format(it) }
        if (hash != release.sha256) throw IOException("更新文件校验失败，请重新下载")
        val archive = packageInfo(file.path)
        if (archive.packageName != context.packageName || versionCode(archive) != release.code || archive.versionName != release.version) throw IOException("更新安装包与应用不匹配")
        if ((archive.applicationInfo?.minSdkVersion ?: 26) > Build.VERSION.SDK_INT) throw IOException("此版本不支持当前安卓系统")
        if (signatures(archive) != signatures(packageInfo())) throw IOException("更新安装包签名不匹配")
    }
    @Suppress("DEPRECATION")
    private fun packageInfo(path: String? = null): PackageInfo {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        return if (path == null) context.packageManager.getPackageInfo(context.packageName, flags)
            else context.packageManager.getPackageArchiveInfo(path, flags) ?: throw IOException("更新安装包无效，请重新下载")
    }
    @Suppress("DEPRECATION")
    private fun signatures(info: PackageInfo): Set<String> = (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures)?.map { signature -> MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02x".format(it) } }?.toSet()?.takeIf { it.isNotEmpty() } ?: throw IOException("无法验证安装包签名")
    @Suppress("DEPRECATION")
    private fun versionCode(info: PackageInfo) = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    companion object {
        internal fun parseRelease(json: JSONObject, manifestUrl: String, packageName: String, fixture: Boolean = false): NativeRelease {
            val origin = URI(manifestUrl)
            val url = origin.resolve(json.getString("url")).normalize()
            val local = fixture && origin.host in setOf("127.0.0.1", "10.0.2.2", "localhost")
            if ((!local && (origin.scheme != "https" || origin.host != "ai.pickandcase.com" || origin.port != -1)) || url.scheme != origin.scheme || url.host != origin.host || url.port != origin.port || url.userInfo != null || url.query != null || url.fragment != null || !Regex("/downloads/[A-Za-z0-9._-]+\\.apk").matches(url.path)) throw IOException("更新地址无效")
            val bytes = json.getLong("bytes")
            val hash = json.getString("sha256").lowercase()
            val code = json.getLong("versionCode")
            val version = json.getString("version")
            if (json.getString("package") != packageName || bytes !in 1..MAX_UPDATE_BYTES || !Regex("[0-9a-f]{64}").matches(hash) || code < 1 || version.isBlank() || !json.optBoolean("native", false)) throw IOException("更新信息无效")
            return NativeRelease(version, code, packageName, url.toASCIIString(), bytes, hash, json.optString("notes"))
        }
    }
}
