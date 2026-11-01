package com.pickandcase.assistant

/** Markwon's inline LaTeX delimiter is $$; accept the web delimiters safely. */
object NativeMathMarkdown {
    private val protected = Regex("(?s)(`+).*?\\1|https?://[^\\s<>]+|\\[[^]\\n]+]\\([^\\s)]+\\)")
    private val explicit = Regex("\\\\\\(([\\s\\S]+?)\\\\\\)|\\\\\\[([\\s\\S]+?)\\\\\\]")
    private val dollars = Regex("(?<![\\\\$])\\$(?!\\$)([^\\n$]*?\\S)\\$(?!\\$)")
    private fun plain(text: String): String {
        val pieces=mutableListOf<String>()
        fun keep(value:String):String {pieces.add(value);return "\u0000M${pieces.lastIndex}\u0000"}
        var value=explicit.replace(text) { m ->
            val source=m.groupValues[1].ifBlank { m.groupValues[2] }
            if(source.length>10000)m.value else keep(if(m.groupValues[2].isNotEmpty()) "\n$$\n$source\n$$\n" else "$$${source}$$")
        }
        value=dollars.replace(value) { m ->
            val source=m.groupValues[1]
            if(source.first().isWhitespace() || source.length>10000 || source.contains('\u0000') || source.any { it in '\u3400'..'\u9fff' } ||
                (source.first().isDigit()&&!Regex("[a-zA-Z\\\\=+^_{}<>]").containsMatchIn(source)))m.value
            else "$$${source}$$"
        }
        return Regex("\u0000M(\\d+)\u0000").replace(value) {pieces[it.groupValues[1].toInt()]}
    }
    fun normalize(text:String):String {
        val result=StringBuilder();var from=0
        protected.findAll(text).forEach {m->result.append(plain(text.substring(from,m.range.first)));result.append(m.value);from=m.range.last+1}
        result.append(plain(text.substring(from)));return result.toString()
    }
}
