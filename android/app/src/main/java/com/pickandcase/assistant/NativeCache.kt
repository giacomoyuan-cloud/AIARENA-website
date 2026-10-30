package com.pickandcase.assistant

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.AtomicFile
import java.io.File
import org.json.JSONObject

/** Local copies never cross account/scope boundaries; incognito content is never written. */
class NativeCache(context: Context) : SQLiteOpenHelper(context, "native-content-v2.db", null, 1) {
    private val payloads = File(context.filesDir, "native-snapshots").apply { mkdirs() }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE snapshots (account TEXT NOT NULL, scope TEXT NOT NULL, item TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(account,scope,item))"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    fun put(account: String, scope: String, item: String, value: JSONObject) {
        // Large generated images exceed Android's SQLite CursorWindow. Keep only a small pointer in
        // SQLite.
        val name = sha256(listOf(account, scope, item).joinToString("\u0000")) + ".json"
        val atomic = AtomicFile(File(payloads, name))
        val output = atomic.startWrite()
        try {
            output.writer(Charsets.UTF_8).apply {
                write(value.toString())
                flush()
            }
            atomic.finishWrite(output)
        } catch (error: Throwable) {
            atomic.failWrite(output)
            throw error
        }
        writableDatabase.insertWithOnConflict(
            "snapshots",
            null,
            ContentValues().apply {
                put("account", account)
                put("scope", scope)
                put("item", item)
                put("value", "@" + name)
                put("updated", System.currentTimeMillis())
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
        val files =
            payloads
                .listFiles()
                ?.filter { it.name.matches(Regex("[a-f0-9]{64}\\.json")) }
                ?.sortedBy { it.lastModified() } ?: emptyList()
        var bytes = files.sumOf { it.length() }
        var count = files.size
        files.forEach { file ->
            if ((bytes > 128L * 1024 * 1024 || count > 64) && file.name != name) {
                bytes -= file.length()
                count--
                if (file.delete())
                    writableDatabase.delete("snapshots", "value=?", arrayOf("@" + file.name))
            }
        }
    }

    @Synchronized
    fun get(account: String, scope: String, item: String): JSONObject? =
        readableDatabase
            .query(
                "snapshots",
                arrayOf("value"),
                "account=? AND scope=? AND item=?",
                arrayOf(account, scope, item),
                null,
                null,
                null,
            )
            .use {
                if (!it.moveToFirst()) null
                else {
                    val value = it.getString(0)
                    if (value.startsWith("@")) {
                        val file = File(payloads, value.drop(1))
                        if (file.exists()) JSONObject(file.readText()) else null
                    } else JSONObject(value)
                }
            }

    @Synchronized
    fun clearAccount(account: String) {
        readableDatabase
            .query("snapshots", arrayOf("value"), "account=?", arrayOf(account), null, null, null)
            .use { cursor ->
                while (cursor.moveToNext()) {
                    val value = cursor.getString(0)
                    if (Regex("@[a-f0-9]{64}\\.json").matches(value))
                        AtomicFile(File(payloads, value.drop(1))).delete()
                }
            }
        writableDatabase.delete("snapshots", "account=?", arrayOf(account))
    }
}
