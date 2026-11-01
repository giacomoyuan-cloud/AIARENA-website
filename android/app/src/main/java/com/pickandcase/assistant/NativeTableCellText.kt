package com.pickandcase.assistant

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.node.*
import org.commonmark.parser.Parser
import java.net.URI

/** Immutable inline text can be reused by both layouts; no TextView/parser per cell. */
internal class NativeTableCellText(private val linkColor: Color) {
    private val cache = object : LinkedHashMap<String, AnnotatedString?>(128, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, AnnotatedString?>) = size > 1024
    }

    fun get(value: String): AnnotatedString? {
        val text = value.ifBlank { "—" }
        if (cache.containsKey(text)) return cache[text]
        return render(text, linkColor).also { cache[text] = it }
    }

    companion object {
        private val parser = Parser.builder().extensions(listOf(StrikethroughExtension.create())).build()
        private val bareUrl = Regex("(?:https?://|www\\.)[^\\s<>]+")
        private val protected = Regex("(?s)(`+).*?\\1|https?://[^\\s<>]+|\\[[^]\\n]+]\\([^\\s)]+\\)")
        private val platformAutoLink = Regex("""(?i)[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(?<![\w:/.-])(?:[a-z0-9-]+\.)+[a-z]{2,}|\+?\d[\d ()-]{5,}\d""")
        private fun safeUrl(value: String): String? {
            val url = if (value.startsWith("www.")) "https://$value" else value
            if (url.any { it.isWhitespace() || it.isISOControl() }) return null
            return runCatching { URI(url).scheme?.lowercase() }.getOrNull()
                ?.takeIf { it in setOf("https", "http", "mailto", "tel") }?.let { url }
        }

        fun render(text: String, linkColor: Color): AnnotatedString? {
            // Formula cells retain the existing asynchronous native formula renderer.
            val normalized = NativeMathMarkdown.normalize(text)
            if (normalized != text || text.contains("$$")) return null
            // Preserve Android Linkify's email, telephone and schemeless-domain behavior.
            if (platformAutoLink.containsMatchIn(protected.replace(text, ""))) return null
            val document = parser.parse(text)
            if (document.firstChild !is Paragraph || document.firstChild.next != null) return null
            val builder = AnnotatedString.Builder()
            var linkDepth = 0
            fun linked(label: String, target: String) {
                val safe = safeUrl(target)
                if (safe == null) builder.append(label)
                else {
                    builder.pushLink(LinkAnnotation.Url(safe, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))))
                    builder.append(label)
                    builder.pop()
                }
            }
            fun plain(value: String) {
                var from = 0
                bareUrl.findAll(value).forEach { match ->
                    var url = match.value.trimEnd('.', ',', ';', ':', '!', '?', '。', '，', '；', '！', '？')
                    for ((open, close) in listOf('(' to ')', '[' to ']', '{' to '}')) {
                        while (url.endsWith(close) && url.count { it == close } > url.count { it == open }) url = url.dropLast(1)
                    }
                    builder.append(value.substring(from, match.range.first))
                    linked(url, url)
                    from = match.range.first + url.length
                }
                builder.append(value.substring(from))
            }
            fun children(node: Node, visit: (Node) -> Unit) {
                var child = node.firstChild
                while (child != null) { visit(child); child = child.next }
            }
            fun visit(node: Node) {
                when (node) {
                    is Text -> if (linkDepth > 0) builder.append(node.literal) else plain(node.literal)
                    is Code -> {
                        builder.pushStyle(SpanStyle(fontFamily = FontFamily.Monospace))
                        builder.append(node.literal); builder.pop()
                    }
                    is StrongEmphasis, is Emphasis, is Strikethrough -> {
                        builder.pushStyle(when (node) {
                            is StrongEmphasis -> SpanStyle(fontWeight = FontWeight.Bold)
                            is Emphasis -> SpanStyle(fontStyle = FontStyle.Italic)
                            else -> SpanStyle(textDecoration = TextDecoration.LineThrough)
                        })
                        children(node, ::visit); builder.pop()
                    }
                    is Link -> {
                        val target = safeUrl(node.destination)
                        if (target != null) builder.pushLink(LinkAnnotation.Url(target, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))))
                        linkDepth++
                        children(node, ::visit)
                        linkDepth--
                        if (target != null) builder.pop()
                    }
                    is SoftLineBreak, is HardLineBreak -> builder.append('\n')
                    is HtmlInline -> if (node.literal.matches(Regex("(?i)<br\\s*/?>"))) builder.append('\n')
                    else -> children(node, ::visit)
                }
            }
            visit(document)
            return builder.toAnnotatedString()
        }
    }
}
