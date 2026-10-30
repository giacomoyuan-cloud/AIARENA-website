package com.pickandcase.assistant

/** Table parsing is shared by all native Markdown surfaces, including task replay and files. */
sealed interface NativeMarkdownPart {
    data class Text(val value: String) : NativeMarkdownPart
    data class Table(val headers: List<String>, val rows: List<List<String>>) : NativeMarkdownPart
}
object NativeMarkdownTables {
    fun cells(line: String): List<String> {
        val value = line.trim().removePrefix("|").removeSuffix("|")
        val result = mutableListOf<String>()
        val cell = StringBuilder()
        var escaped = false
        var ticks = 0
        var index = 0
        while (index < value.length) {
            val char = value[index]
            if (escaped) { cell.append(char); escaped = false; index++; continue }
            if (char == '\\') { cell.append(char); escaped = true; index++; continue }
            if (char == '`') {
                var count = 1
                while (index + count < value.length && value[index + count] == '`') count++
                if (ticks == 0) ticks = count else if (ticks == count) ticks = 0
                repeat(count) { cell.append('`') }; index += count; continue
            }
            if (char == '|' && ticks == 0) { result += cell.toString().trim(); cell.clear() }
            else cell.append(char)
            index++
        }
        result += cell.toString().trim()
        return result
    }
    fun parse(text: String): List<NativeMarkdownPart> {
        val lines = text.lines()
        val parts = mutableListOf<NativeMarkdownPart>()
        val prose = mutableListOf<String>()
        var index = 0
        var fence: Char? = null
        var fenceLength = 0
        fun flush() { if (prose.isNotEmpty()) { val value = prose.joinToString("\n"); if (value.isNotBlank()) parts += NativeMarkdownPart.Text(value); prose.clear() } }
        while (index < lines.size) {
            val line = lines[index]
            val match = Regex("^\\s{0,3}(`{3,}|~{3,}).*$").matchEntire(line)
            if (match != null) {
                val marker = match.groupValues[1]
                if (fence == null) { fence = marker[0]; fenceLength = marker.length }
                else if (marker[0] == fence && marker.length >= fenceLength && line.trim().all { it == fence }) fence = null
                prose += line; index++; continue
            }
            val head = cells(line)
            val separators = lines.getOrNull(index + 1)?.let(::cells).orEmpty()
            if (fence == null && head.size > 1 && separators.size == head.size && separators.all { Regex(":?-{3,}:?").matches(it) }) {
                flush(); index += 2
                val rows = mutableListOf<List<String>>()
                while (index < lines.size && lines[index].isNotBlank() && cells(lines[index]).size > 1) {
                    val row = cells(lines[index++]); rows += head.indices.map { row.getOrElse(it) { "" } }
                }
                parts += NativeMarkdownPart.Table(head, rows)
            } else { prose += line; index++ }
        }
        flush()
        return parts
    }
}
