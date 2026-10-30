package com.pickandcase.assistant

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Generated from the website's selectable models, never from the legacy provider registry. */
class NativeClientContract(context: Context) {
    private val contract = JSONObject(context.assets.open("native-client-contract.json").bufferedReader().use { it.readText() })
    val chatModels = contract.arr("chatModels").objects()
    val imageModels = contract.arr("imageModels").objects()
    val defaultModel = contract.str("defaultModel")
    val defaultImageModel = contract.str("defaultImageModel")
    val searchDefault = contract.optBoolean("searchDefault", true)
    private val retired = mapOf("gpt-5.6-sol" to "gpt-6.1-sol", "claude-opus-5" to "claude-opus-5-5", "gemini-3.8-flash" to "gemini-4-argon", "gemini-3.1-pro-preview" to "gemini-4-argon")

    fun chat(id: String): String = (retired[id] ?: id).takeIf { value -> chatModels.any { it.str("id") == value } } ?: defaultModel
    fun image(id: String): String = (if (id == "gemini-3.1-flash-image" || id == "nanbanana2-official") defaultImageModel else id).takeIf { value -> imageModels.any { it.str("id") == value } } ?: defaultImageModel
    fun defaultEffort(id: String): String = chatModels.firstOrNull { it.str("id") == chat(id) }?.str("defaultEffort") ?: "medium"
    fun effort(id: String, effort: String): String = effort.takeIf { level -> chatModels.firstOrNull { it.str("id") == chat(id) }?.arr("levels")?.strings()?.contains(level) == true } ?: defaultEffort(id)

    fun catalog(server: JSONObject): JSONObject {
        val available = server.arr("models").objects().associateBy { it.str("id") }
        val models = (chatModels + imageModels).filter { available.containsKey(it.str("id")) }.map { published ->
            (available[published.str("id")] ?: JSONObject()).copyJson().apply {
                published.keys().forEach { key -> put(key, published.get(key)) }
                put("image", published.optBoolean("image", false))
            }
        }
        return server.copyJson().apply {
            put("models", JSONArray(models))
            val skills = server.obj("skillModels")
            put("skillModels", JSONObject().apply {
                skills.keys().forEach { id -> if (chatModels.any { it.str("id") == id }) put(id, skills.get(id)) }
            })
        }
    }

    fun debate(input: JSONObject): JSONObject = input.copyJson().apply {
        arr("members").objects().forEach { member ->
            val id = chat(member.str("model"))
            member.put("model", id).put("effort", effort(id, member.str("effort")))
        }
        if (str("summaryModel").isNotBlank()) {
            val id = chat(str("summaryModel"))
            put("summaryModel", id).put("summaryEffort", effort(id, str("summaryEffort")))
        }
    }
}
