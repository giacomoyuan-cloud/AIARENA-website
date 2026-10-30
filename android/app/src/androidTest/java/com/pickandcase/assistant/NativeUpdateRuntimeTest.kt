package com.pickandcase.assistant

import android.content.Intent
import androidx.compose.ui.test.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

/** Real Android package/signature checks, synthetic update HTTP only, zero inference requests. */
@RunWith(AndroidJUnit4::class)
class NativeUpdateRuntimeTest : NativeHarness() {
    private lateinit var server: MockWebServer
    private lateinit var updates: NativeUpdates
    private val candidateCode get() = BuildConfig.VERSION_CODE + 1
    private val candidateVersion get() = BuildConfig.VERSION_NAME.substringBefore("-").split(".").let { p -> p.dropLast(1).joinToString(".") + "." + (p.last().toInt() + 1) + "-qa-debug" }
    private val packageName get() = app.packageName
    private val folder get() = File(app.filesDir, "updates")
    @Before fun startUpdates() {
        server = MockWebServer().apply { start() }
        NativeTestHooks.updateManifestUrl = server.url("/downloads/app-release.json").toString()
        model { updates = it.updates }
        folder.listFiles()?.forEach { it.delete() }
    }
    @After fun finishUpdates() { updates.cancel(); server.shutdown() }
    private fun await(phase: UpdatePhase) { ui.waitUntil(25000) { updates.state.value.phase == phase } }
    private fun bytes(name: String) = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().context.assets.open(name).use { it.readBytes() }
    private fun sha(data: ByteArray) = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }
    private fun manifest(data: ByteArray, code: Int = candidateCode, version: String = candidateVersion) = json("version" to version, "versionCode" to code, "package" to packageName, "url" to "/downloads/AI-Assistant-local.apk", "bytes" to data.size, "sha256" to sha(data), "native" to true, "notes" to "本地更新流程验收")
    private fun metadata(value: JSONObject) { server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(value.toString())) }
    private fun offer(data: ByteArray, value: JSONObject = manifest(data)) { metadata(value); updates.check(); await(UpdatePhase.AVAILABLE) }
    private fun apk(data: ByteArray): MockResponse = MockResponse().setBody(Buffer().write(data))

    @Test fun metadata_rejects_untrusted_urls_packages_sizes_and_hashes() {
        val valid = manifest(byteArrayOf(1))
        for (patch in listOf(json("url" to "https://other.example/evil.apk"), json("url" to "http://ai.pickandcase.com/downloads/file.apk"), json("url" to "/../../evil.apk"), json("package" to "other.app"), json("bytes" to 0), json("bytes" to MAX_UPDATE_BYTES + 1), json("sha256" to "wrong"), json("versionCode" to 0), json("native" to false))) {
            val modified = valid.copyJson().apply { patch.keys().forEach { put(it, patch.get(it)) } }
            assertTrue(runCatching { NativeUpdates.parseRelease(modified, "https://ai.pickandcase.com/downloads/app-release.json", packageName) }.isFailure)
        }
        assertTrue(runCatching { NativeUpdates.parseRelease(valid, "http://ai.pickandcase.com/downloads/app-release.json", packageName) }.isFailure)
    }

    @Test fun current_or_older_versions_never_trigger_a_download() {
        for (code in listOf(BuildConfig.VERSION_CODE, BuildConfig.VERSION_CODE - 1)) {
            metadata(manifest(byteArrayOf(1), code, "old")); updates.check(); await(UpdatePhase.CURRENT)
            assertNull(updates.state.value.release)
        }
        assertEquals(2, server.requestCount)
    }

    @Test fun update_check_failure_can_be_retried() {
        server.enqueue(MockResponse().setResponseCode(503)); updates.check(); await(UpdatePhase.FAILED)
        metadata(manifest(byteArrayOf(1))); updates.check(); await(UpdatePhase.AVAILABLE)
        assertTrue(updates.state.value.error.isEmpty())
    }

    @Test fun corrupt_download_is_rejected_and_removed() {
        val data = "corrupt".toByteArray()
        offer(data, manifest(data).put("sha256", "0".repeat(64)))
        server.enqueue(apk(data)); updates.download(); await(UpdatePhase.FAILED)
        assertTrue(updates.state.value.error.contains("校验失败"))
        ui.waitUntil(5000) { folder.listFiles().orEmpty().isEmpty() }
        ui.onNodeWithTag("update-install").assertDoesNotExist()
    }

    @Test fun truncated_download_is_rejected() {
        val data = "expected data".toByteArray()
        offer(data)
        server.enqueue(apk(byteArrayOf(1))); updates.download(); await(UpdatePhase.FAILED)
        assertTrue(updates.state.value.error.contains("大小不匹配"))
    }

    @Test fun non_apk_with_a_matching_hash_still_cannot_be_installed() {
        val data = "not an Android package".toByteArray()
        offer(data); server.enqueue(apk(data)); updates.download(); await(UpdatePhase.FAILED)
        assertTrue(updates.state.value.error.contains("安装包无效"))
    }

    @Test fun apk_signed_by_another_key_is_rejected() {
        val data = bytes("candidate-foreign.apk")
        offer(data); server.enqueue(apk(data)); updates.download(); await(UpdatePhase.FAILED)
        assertTrue(updates.state.value.error.contains("签名不匹配"))
    }

    @Test fun real_apk_download_can_cancel_retry_and_preserves_login() {
        login()
        val token = NativeSession(app).load()!!.token
        val data = bytes("candidate-update.apk")
        offer(data)
        server.enqueue(apk(data).throttleBody(32768, 100, TimeUnit.MILLISECONDS))
        updates.download(); ui.waitUntil(10000) { updates.state.value.received > 0 }
        assertTrue(updates.state.value.received < data.size)
        ui.onNodeWithTag("update-progress").assertIsDisplayed()
        updates.cancel(); await(UpdatePhase.AVAILABLE)
        server.enqueue(apk(data)); updates.download(); await(UpdatePhase.READY)
        assertEquals(token, NativeSession(app).load()!!.token)
        assertEquals(data.size.toLong(), updates.state.value.received)
        val file = File(folder, "assistant-${candidateCode}.apk")
        assertTrue(file.isFile)
        val intent = updates.installIntent(file)
        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertEquals("application/vnd.android.package-archive", intent.type)
        assertEquals("content", intent.data!!.scheme)
        assertEquals(packageName + ".files", intent.data!!.authority)
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        ui.onNodeWithTag("update-install").assertIsDisplayed()
        screenshot("native-in-app-update-ready")
    }

    @Test fun finishing_the_app_cancels_download_and_keeps_login() {
        login()
        val token = NativeSession(app).load()!!.token
        val data = bytes("candidate-update.apk")
        offer(data)
        server.enqueue(apk(data).throttleBody(32768, 100, TimeUnit.MILLISECONDS))
        updates.download()
        ui.waitUntil(10000) { updates.state.value.received > 0 }
        scene.close()
        ui.waitUntil(5000) { folder.listFiles().orEmpty().none { it.extension == "part" } }
        assertEquals(token, NativeSession(app).load()!!.token)
        scene = androidx.test.core.app.ActivityScenario.launch(MainActivity::class.java)
        ui.waitForIdle()
        ui.onNodeWithTag("login-submit").assertDoesNotExist()
    }

    @Test fun settings_exposes_update_check_and_preserves_the_session() {
        login()
        val token = NativeSession(app).load()!!.token
        metadata(manifest(byteArrayOf(1), BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME))
        model { it.navigate(Page.SETTINGS) }
        ui.onNodeWithTag("settings-update").performScrollTo().performClick()
        await(UpdatePhase.CURRENT)
        ui.onNodeWithTag("update-current").assertIsDisplayed()
        assertEquals(token, NativeSession(app).load()!!.token)
        screenshot("native-update-settings")
    }
}
