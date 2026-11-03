package com.pickandcase.assistant

import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

/** Same source contract as ArenaContext.fullHistory, including pasted documents. */
fun contextHistory(messages: List<JSONObject>): JSONArray = JSONArray(
    messages.filter { !it.optBoolean("isError") || it.optBoolean("contextPartial") || it.optBoolean("partial") }.map { message ->
        val user = message.optBoolean("isUser") || message.str("role") == "user"
        val hasOwnText = message.opt("topicText") is String
        val own = if (hasOwnText) message.str("topicText") else message.str("userText", message.str("text"))
        var text = if (user && hasOwnText) own else message.str("original", message.str("text"))
        message.optJSONObject("_quote")?.let { quote ->
            text = "引用" + (if (quote.str("author").isNotBlank()) "（${quote.str("author")}）" else "") + "：" + quote.str("text") + "\n" + text
        }
        if (message.arr("pastedTexts").length() > 0) text += "\n" + message.arr("pastedTexts").strings().joinToString("\n")
        val citations = message.arr("citations").objects().mapNotNull { source ->
            runCatching {
                val url = URI(source.str("url"))
                if (url.scheme in listOf("http", "https") && url.userInfo == null)
                    source.str("title", "参考来源") + " " + url.toASCIIString()
                else null
            }.getOrNull()
        }
        if (citations.isNotEmpty()) text += "\n参考来源：\n" + citations.joinToString("\n")
        text = text.replace(Regex("\\[\\[aa-citation:\\d+\\]\\]"), "").replace(" [img]", " [图片]")
        if (!user && (message.optBoolean("contextPartial") || message.optBoolean("partial"))) {
            val marker = "[以下是已收到但尚未完成的回复；可在此基础上接续，不代表任务已完成]"
            val suffix = "\n\n[" + message.str("generationError") + "]"
            if (text.endsWith(suffix)) text = text.removeSuffix(suffix)
            if (!text.startsWith(marker)) text = marker + "\n" + text
        }
        json("uid" to message.opt("uid"), "role" to if (user) "user" else "assistant", "text" to text, "clipped" to false).apply {
            if (user) put("userText", own)
            else { put("files", message.obj("context").arr("files")); if (message.optBoolean("contextPartial") || message.optBoolean("partial")) put("partial",true) }
        }
    }
)

fun contextImages(messages: List<JSONObject>): JSONArray {
    val source = messages.asReversed().firstOrNull {
        (it.optBoolean("isUser") || it.str("role") == "user") && (it.arr("imgSrcs").length() > 0 || it.str("imgSrc").isNotBlank())
    } ?: return JSONArray()
    val values = source.arr("imgSrcs").strings().ifEmpty { listOf(source.str("imgSrc")) }
    var bytes = 0
    return JSONArray(values.mapNotNull { value ->
        val match = Regex("^data:(image/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$").matchEntire(value)
        if (match == null || bytes + match.groupValues[2].length > 14 * 1024 * 1024) null
        else { bytes += match.groupValues[2].length; json("mime" to match.groupValues[1], "data" to match.groupValues[2]) }
    }.take(4))
}

fun contextDescription(info: JSONObject): String {
    val summarized = info.str("historyPolicy") in listOf("summarized", "compacted")
    return buildList {
        add(if (summarized) "近期原文 ${info.optInt("historyCount")} 条，较早 ${info.optInt("summaryMessages")} 条保留任务摘要与相关原文。" else "携带本分支完整文字历史 ${info.optInt("historyCount")} 条。")
        if (info.optInt("commitmentCount") > 0) add("保留 ${info.optInt("commitmentCount")} 条用户原文约定与更正。")
        if (info.optInt("memoryCount") > 0) add("参考当前范围 ${info.optInt("memoryCount")} 条记忆，较新更正优先。")
        if (info.optInt("fileFragments") > 0) add(if (info.str("readingMode") == "full") "已按全文阅读方式提供资料。" else "提供本轮相关资料片段；追问会结合近期问题检索。")
        for (key in listOf("contextWarning", "memoryWarning")) if (info.str(key).isNotBlank()) add(info.str(key))
        add("原聊天记录完整保留。任务摘要可能省略细节，用户当前要求优先。")
    }.joinToString("\n\n")
}
