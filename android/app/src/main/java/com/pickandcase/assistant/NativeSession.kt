package com.pickandcase.assistant

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

data class SavedSession(val token: String, val profile: JSONObject, val canManage: Boolean) {
    val accountId: String
        get() = profile.optString("accountId")

    fun json() = json("token" to token, "profile" to profile, "canManage" to canManage)
}

/** App-private Keystore encryption; no expiry, biometric timeout or browser storage. */
class NativeSession(context: Context) {
    private val preferences =
        context.getSharedPreferences("native_session_v2", Context.MODE_PRIVATE)
    private val alias = context.packageName + ".native-session.v2"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let {
            return it
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                            alias,
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setUserAuthenticationRequired(false)
                        .build()
                )
            }
            .generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) +
            "." +
            Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val parts = value.split('.', limit = 2)
        val cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(
                    Cipher.DECRYPT_MODE,
                    key(),
                    GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)),
                )
            }
        return String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
    }

    fun load(): SavedSession? =
        preferences.getString("active", null)?.let { encrypted ->
            val value = JSONObject(decrypt(encrypted))
            SavedSession(
                value.getString("token"),
                value.getJSONObject("profile"),
                value.optBoolean("canManage"),
            )
        }

    fun save(session: SavedSession) {
        check(preferences.edit().putString("active", encrypt(session.json().toString())).commit()) {
            "登录资料未保存，请检查可用空间"
        }
    }

    fun logout(): SavedSession? {
        val session = load()
        val edit = preferences.edit().remove("active")
        if (session != null)
            edit.putString("revoke_" + System.currentTimeMillis(), encrypt(session.token))
        check(edit.commit()) { "退出登录未完成，请重试" }
        return session
    }

    fun revocations(): Map<String, String> =
        preferences.all
            .filterKeys { it.startsWith("revoke_") }
            .mapValues { decrypt(it.value as String) }

    fun revoked(key: String) {
        preferences.edit().remove(key).apply()
    }
}
