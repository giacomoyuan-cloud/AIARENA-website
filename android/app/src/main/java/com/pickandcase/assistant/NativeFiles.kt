package com.pickandcase.assistant

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.UUID
import java.util.zip.ZipFile
import org.apache.poi.hssf.usermodel.HSSFWorkbook
import org.apache.poi.ss.usermodel.DataFormatter
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory

data class NativeAttachment(
    val id: String,
    val name: String,
    val mime: String,
    val path: String,
    val size: Long,
    val text: String = "",
    val relativePath: String = name,
    val units: Int = 1,
    val emptyUnits: Int = 0,
    val parseError: String = "",
    val indexedId: String? = null,
) {
    val image
        get() = mime in setOf("image/png", "image/jpeg", "image/webp", "image/gif")

    fun bytes() = File(path).readBytes()

    fun reference() = json("data" to Base64.encodeToString(bytes(), Base64.NO_WRAP), "mime" to mime)

    fun skillFile() =
        json(
            "name" to name,
            "data" to Base64.encodeToString(bytes(), Base64.NO_WRAP),
            "mime" to mime,
            "size" to size,
        )
}

class NativeFiles(private val context: Context) {
    private val folder = File(context.filesDir, "attachments").apply { mkdirs() }
    private val types =
        mapOf(
            "png" to "image/png",
            "jpg" to "image/jpeg",
            "jpeg" to "image/jpeg",
            "webp" to "image/webp",
            "gif" to "image/gif",
            "pdf" to "application/pdf",
            "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xls" to "application/vnd.ms-excel",
            "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "zip" to "application/zip",
        )
    private val textTypes =
        "makefile gemfile rakefile license readme txt md markdown mdx csv tsv json jsonl ndjson yaml yml xml html htm svg css scss sass less js mjs cjs jsx ts tsx vue svelte py pyi ipynb sql sh bash zsh java kt kts c h cc cpp cxx hpp cs go rs rb php swift r tex toml ini cfg conf properties log env gitignore dockerignore dockerfile"
            .split(" ")
            .toSet()

    fun import(uri: Uri): List<NativeAttachment> = readImport(uri, false)

    fun projectImport(uri: Uri): List<NativeAttachment> = readImport(uri, true)

    private fun readImport(uri: Uri, project: Boolean): List<NativeAttachment> {
        val name =
            context.contentResolver
                .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "attachment"
        val mime =
            context.contentResolver.getType(uri)
                ?: types[name.substringAfterLast('.').lowercase()]
                ?: "text/plain"
        val file =
            File(
                folder,
                UUID.randomUUID().toString() +
                    "-" +
                    name.replace(Regex("[^\\p{L}\\p{N}._-]"), "_").takeLast(100),
            )
        context.contentResolver.openInputStream(uri)?.use { input ->
            file.outputStream().use { output ->
                val buffer = ByteArray(16384)
                var total = 0L
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    total += n
                    require(context.cacheDir.usableSpace > 32L * 1024 * 1024) { "设备空间不足，原始文件未改动" }
                    output.write(buffer, 0, n)
                }
            }
        } ?: error("无法读取这个文件，请重新选择")
        return if (name.endsWith(".zip", true)) expand(file, project)
        else listOf(describeSafely(name, mime, file, name, project))
    }

    fun describeSaved(file: File,name: String,mime: String): NativeAttachment = describeSafely(name,mime,file,name,true)

    private fun describeSafely(
        name: String,
        mime: String,
        file: File,
        relative: String,
        project: Boolean,
    ): NativeAttachment {
        return try {
            describe(name, mime, file, relative)
        } catch (error: Exception) {
            if (!project) throw error
            NativeAttachment(
                UUID.randomUUID().toString(),
                name,
                mime,
                file.path,
                file.length(),
                relativePath = relative,
                parseError = error.message ?: "资料解析失败",
            )
        }
    }

    private fun describe(
        name: String,
        mime: String,
        file: File,
        relative: String,
    ): NativeAttachment {
        val ext = name.substringAfterLast('.', "").lowercase()
        var units = 1
        var emptyUnits = 0
        val text =
            when {
                mime in setOf("image/png", "image/jpeg", "image/webp", "image/gif") -> ""
                ext == "xls" ->
                    file.inputStream().use { input ->
                        HSSFWorkbook(input).use { book ->
                            val formatter = DataFormatter()
                            buildString {
                                for (sheet in book) {
                                    append("\n[" + sheet.sheetName + "]\n")
                                    for (row in sheet) {
                                        for (index in 0 until row.lastCellNum.coerceAtLeast(0)) {
                                            append(formatter.formatCellValue(row.getCell(index)))
                                            append('\t')
                                        }
                                        append('\n')
                                        require(length <= 20 * 1024 * 1024) { "表格文字超过限制" }
                                    }
                                }
                            }
                        }
                    }
                ext == "pdf" -> {
                    PDFBoxResourceLoader.init(context)
                    PDDocument.load(file).use { document ->
                        require(document.numberOfPages <= 2000) { "PDF 页数较多，请拆分资料" }
                        units = document.numberOfPages
                        val stripper = PDFTextStripper()
                        buildString {
                            for (page in 1..document.numberOfPages) {
                                stripper.startPage = page
                                stripper.endPage = page
                                val part = stripper.getText(document)
                                if (part.isBlank()) emptyUnits++
                                append("\n[第 $page 页]\n")
                                append(part)
                                require(length <= 20 * 1024 * 1024) { "PDF 文字过多，请拆分文件" }
                            }
                        }
                    }
                }
                ext in setOf("xlsx", "xlsm") -> office(file, "xlsx")
                ext == "xlsb" -> binaryWorkbook(file)
                ext in setOf("docx", "pptx") -> office(file, ext)
                ext in setOf("odt", "odp", "ods") -> openDocument(file)
                ext in textTypes || !name.contains('.') || mime.startsWith("text/") ->
                    decode(file.readBytes())
                else -> error("暂不支持这个附件格式：$name")
            }
        require(text.length <= 20 * 1024 * 1024) { "文件文字过长，请拆分资料后上传" }
        return NativeAttachment(
            UUID.randomUUID().toString(),
            name,
            mime,
            file.absolutePath,
            file.length(),
            text,
            relative,
            units = units,
            emptyUnits = emptyUnits,
        )
    }

    private fun expand(file: File, project: Boolean = false): List<NativeAttachment> {
        val zip =
            runCatching { ZipFile(file, Charsets.UTF_8) }
                .getOrElse { ZipFile(file, charset("GB18030")) }
        return zip.use { archive ->
            val entries =
                archive
                    .entries()
                    .asSequence()
                    .filterNot {
                        it.isDirectory ||
                            it.name.startsWith("__MACOSX/") ||
                            it.name.substringAfterLast('/').startsWith('.')
                    }
                    .toList()
            require(entries.size <= 100) { "ZIP 最多包含 100 个文件" }
            var total = 0L
            entries.map { entry ->
                val path = entry.name.replace('\\', '/')
                require(
                    !path.startsWith('/') &&
                        !path.split('/').contains("..") &&
                        !Regex("^[A-Za-z]:").containsMatchIn(path)
                ) {
                    "ZIP 包含无效路径"
                }
                require(!path.endsWith(".zip", true)) { "请先展开嵌套 ZIP 后上传" }
                val name = path.substringAfterLast('/')
                val target =
                    File(
                        folder,
                        UUID.randomUUID().toString() +
                            "-" +
                            name.replace(Regex("[^\\p{L}\\p{N}._-]"), "_").takeLast(100),
                    )
                archive.getInputStream(entry).use { input ->
                    target.outputStream().use { output ->
                        val buffer = ByteArray(16384)
                        var single = 0L
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            single += n
                            total += n
                            require(single <= 20 * 1024 * 1024 && total <= 100 * 1024 * 1024) {
                                "ZIP 展开大小超过限制"
                            }
                            output.write(buffer, 0, n)
                        }
                    }
                }
                describeSafely(
                    name,
                    types[name.substringAfterLast('.').lowercase()] ?: "text/plain",
                    target,
                    path,
                    project,
                )
            }
        }
    }

    private fun decode(bytes: ByteArray): String {
        val result =
            when {
                bytes.size >= 2 && bytes[0] == 0xff.toByte() && bytes[1] == 0xfe.toByte() ->
                    String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
                bytes.size >= 2 && bytes[0] == 0xfe.toByte() && bytes[1] == 0xff.toByte() ->
                    String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
                else ->
                    try {
                        Charsets.UTF_8.newDecoder()
                            .onMalformedInput(CodingErrorAction.REPORT)
                            .decode(ByteBuffer.wrap(bytes))
                            .toString()
                            .removePrefix("\uFEFF")
                    } catch (_: CharacterCodingException) {
                        String(bytes, charset("GB18030"))
                    }
            }
        require(
            !result.contains('\u0000') &&
                result.count { it.code < 32 && it !in "\r\n\t" } < maxOf(1, result.length / 100)
        ) {
            "这个文件不是可读取的文字资料"
        }
        return result
    }

    fun projectFolder(uri: Uri): List<NativeAttachment> {
        val root =
            androidx.documentfile.provider.DocumentFile.fromTreeUri(context, uri)
                ?: error("无法读取文件夹")
        val output = mutableListOf<NativeAttachment>()
        var total = 0L
        fun walk(directory: androidx.documentfile.provider.DocumentFile, prefix: String) {
            directory.listFiles().forEach { entry ->
                val name = entry.name ?: return@forEach
                if (name.startsWith('.')) return@forEach
                val relative = "$prefix/$name"
                if (entry.isDirectory) walk(entry, relative)
                else {
                    val ext = name.substringAfterLast('.').lowercase()
                    if (
                        ext !in textTypes &&
                            ext !in
                                setOf(
                                    "pdf",
                                    "docx",
                                    "xlsx",
                                    "xlsm",
                                    "xlsb",
                                    "xls",
                                    "pptx",
                                    "odt",
                                    "ods",
                                    "odp",
                                )
                    )
                        return@forEach
                    require(output.size < 100) { "一次最多导入 100 份资料" }
                    total += entry.length()
                    require(total <= 100L * 1024 * 1024) { "文件夹资料总计超过 100MB" }
                    output += projectImport(entry.uri).map { it.copy(relativePath = relative) }
                }
            }
        }
        walk(root, root.name ?: "资料")
        require(output.isNotEmpty()) { "文件夹中没有可导入的资料" }
        return output
    }

    private fun binaryWorkbook(file: File): String {
        org.apache.poi.openxml4j.opc.OPCPackage.open(
                file,
                org.apache.poi.openxml4j.opc.PackageAccess.READ,
            )
            .use { pkg ->
                val reader = org.apache.poi.xssf.eventusermodel.XSSFBReader(pkg)
                val strings = org.apache.poi.xssf.binary.XSSFBSharedStringsTable(pkg)
                val output = StringBuilder()
                val formatter = DataFormatter()
                val sheets = reader.sheetsData
                while (sheets.hasNext()) {
                    sheets.next().use { input ->
                        output.append("\n[工作表]\n")
                        val handler =
                            object :
                                org.apache.poi.xssf.eventusermodel.XSSFSheetXMLHandler.SheetContentsHandler {
                                override fun startRow(rowNum: Int) {}

                                override fun endRow(rowNum: Int) {
                                    output.append('\n')
                                }

                                override fun cell(
                                    reference: String?,
                                    value: String?,
                                    comment: org.apache.poi.xssf.usermodel.XSSFComment?,
                                ) {
                                    output
                                        .append(reference.orEmpty())
                                        .append('=')
                                        .append(value.orEmpty())
                                        .append('\t')
                                    require(output.length <= 20 * 1024 * 1024) { "表格文字过多，请拆分文件" }
                                }

                                override fun headerFooter(
                                    text: String?,
                                    isHeader: Boolean,
                                    tagName: String?,
                                ) {}
                            }
                        org.apache.poi.xssf.binary
                            .XSSFBSheetHandler(
                                input,
                                reader.getXSSFBStylesTable(),
                                null,
                                strings,
                                handler,
                                formatter,
                                false,
                            )
                            .parse()
                    }
                }
                return output.toString()
            }
    }

    private fun openDocument(file: File): String =
        ZipFile(file).use { zip ->
            val entry = zip.getEntry("content.xml") ?: error("不是有效的 OpenDocument 文件")
            require(entry.size <= 20 * 1024 * 1024) { "文档文字过多，请拆分文件" }
            zip.getInputStream(entry).use { input ->
                val parser =
                    XmlPullParserFactory.newInstance()
                        .apply { isNamespaceAware = true }
                        .newPullParser()
                        .apply { setInput(input, "UTF-8") }
                buildString {
                    while (parser.eventType != XmlPullParser.END_DOCUMENT) {
                        if (parser.eventType == XmlPullParser.TEXT) append(parser.text)
                        if (parser.eventType == XmlPullParser.START_TAG && parser.name == "tab")
                            append('\t')
                        if (
                            parser.eventType == XmlPullParser.END_TAG &&
                                parser.name in setOf("p", "h", "table-row")
                        )
                            append('\n')
                        require(length <= 20 * 1024 * 1024) { "文档文字过多，请拆分文件" }
                        parser.next()
                    }
                }
            }
        }

    private fun office(file: File, ext: String): String =
        ZipFile(file).use { zip ->
            if (ext == "xlsx") return@use xlsx(zip)
            val shared = mutableListOf<String>()
            if (ext == "xlsx")
                zip.getEntry("xl/sharedStrings.xml")?.let { entry ->
                    zip.getInputStream(entry).use { input ->
                        val parser =
                            XmlPullParserFactory.newInstance().newPullParser().apply {
                                setInput(input, "UTF-8")
                            }
                        var current = StringBuilder()
                        while (parser.eventType != XmlPullParser.END_DOCUMENT) {
                            if (parser.eventType == XmlPullParser.START_TAG && parser.name == "si")
                                current = StringBuilder()
                            if (parser.eventType == XmlPullParser.TEXT) current.append(parser.text)
                            if (parser.eventType == XmlPullParser.END_TAG && parser.name == "si")
                                shared.add(current.toString())
                            parser.next()
                        }
                    }
                }
            val entries =
                zip.entries()
                    .asSequence()
                    .filter {
                        when (ext) {
                            "docx" -> it.name == "word/document.xml"
                            "pptx" -> Regex("ppt/slides/slide\\d+\\.xml").matches(it.name)
                            else -> Regex("xl/worksheets/sheet\\d+\\.xml").matches(it.name)
                        }
                    }
                    .sortedBy { it.name.filter(Char::isDigit).toIntOrNull() ?: 0 }
                    .toList()
            val out = StringBuilder()
            entries.forEach { entry ->
                zip.getInputStream(entry).use { input ->
                    out.append('\n')
                    val parser =
                        XmlPullParserFactory.newInstance().newPullParser().apply {
                            setInput(input, "UTF-8")
                        }
                    var type = ""
                    var valueTag = false
                    while (parser.eventType != XmlPullParser.END_DOCUMENT) {
                        if (parser.eventType == XmlPullParser.START_TAG) {
                            val n = parser.name.substringAfter(':')
                            if (n == "c") type = parser.getAttributeValue(null, "t") ?: ""
                            valueTag = n == "t" || n == "v"
                        }
                        if (parser.eventType == XmlPullParser.TEXT && valueTag) {
                            val text = parser.text
                            out.append(
                                if (type == "s" && ext == "xlsx")
                                    shared.getOrNull(text.toIntOrNull() ?: -1) ?: text
                                else text
                            )
                        }
                        if (parser.eventType == XmlPullParser.END_TAG) {
                            val n = parser.name.substringAfter(':')
                            if (n == "c") out.append('\t')
                            if (n in setOf("p", "row")) out.append('\n')
                            valueTag = false
                        }
                        parser.next()
                        require(out.length <= 20 * 1024 * 1024) { "文档文字超过限制" }
                    }
                }
            }
            out.toString()
        }

    fun image(data: String, mime: String): File =
        File(
                folder,
                UUID.randomUUID().toString() +
                    "." +
                    when (mime) {
                        "image/jpeg" -> "jpg"
                        "image/webp" -> "webp"
                        else -> "png"
                    },
            )
            .apply { writeBytes(Base64.decode(data, Base64.DEFAULT)) }

    fun replayText(value: String): NativeAttachment {
        val indexed=Regex("^\\[文件: ([^\\n]+)]\\n\\[对话文件 ([a-zA-Z0-9_-]{6,80})；正文按阅读方式查阅]$").matchEntire(value)
        if(indexed!=null)return NativeAttachment(UUID.randomUUID().toString(),indexed.groupValues[1],"text/plain",File(folder,"indexed-reference").path,0,indexedId=indexed.groupValues[2])
        val header = value.substringBefore('\n')
        val text = if (header.startsWith("[文件: ")) value.substringAfter('\n', "") else value
        val name =
            if (header.startsWith("[文件: ")) header.removePrefix("[文件: ").removeSuffix("]")
            else "参考资料.txt"
        val file = File(folder, UUID.randomUUID().toString() + ".txt").apply { writeText(text) }
        return NativeAttachment(
            UUID.randomUUID().toString(),
            name,
            "text/plain",
            file.path,
            file.length(),
            text,
        )
    }

    private fun xlsx(zip: ZipFile): String {
        val shared = mutableListOf<String>()
        val formats = mutableMapOf<Int, String>()
        val styles = mutableListOf<Int>()
        fun parse(name: String, read: (org.xmlpull.v1.XmlPullParser) -> Unit) {
            val entry = zip.getEntry(name) ?: return
            require(entry.size <= 16 * 1024 * 1024) { "表格 XML 过大，请拆分文件" }
            zip.getInputStream(entry).use { input ->
                val parser =
                    XmlPullParserFactory.newInstance()
                        .apply { isNamespaceAware = true }
                        .newPullParser()
                        .apply { setInput(input, "UTF-8") }
                read(parser)
            }
        }
        parse("xl/sharedStrings.xml") { p ->
            var current = StringBuilder()
            var text = false
            var total = 0
            while (p.eventType != XmlPullParser.END_DOCUMENT) {
                val n = p.name
                if (p.eventType == XmlPullParser.START_TAG) {
                    if (n == "si") current = StringBuilder()
                    text = n == "t"
                }
                if (p.eventType == XmlPullParser.TEXT && text) {
                    current.append(p.text)
                    total += p.text.length
                    require(total <= 1000000) { "表格共享文字过多，请拆分文件" }
                }
                if (p.eventType == XmlPullParser.END_TAG) {
                    if (n == "si") shared.add(current.toString())
                    text = false
                }
                p.next()
            }
        }
        parse("xl/styles.xml") { p ->
            var inCells = false
            while (p.eventType != XmlPullParser.END_DOCUMENT) {
                if (p.eventType == XmlPullParser.START_TAG) {
                    when (p.name) {
                        "numFmt" -> {
                            val id = p.getAttributeValue(null, "numFmtId").toInt()
                            formats[id] = p.getAttributeValue(null, "formatCode")
                        }
                        "cellXfs" -> inCells = true
                        "xf" ->
                            if (inCells)
                                styles.add(
                                    p.getAttributeValue(null, "numFmtId")?.toIntOrNull() ?: 0
                                )
                    }
                }
                if (p.eventType == XmlPullParser.END_TAG && p.name == "cellXfs") inCells = false
                p.next()
            }
        }
        val formatter = DataFormatter()
        val output = StringBuilder()
        zip.entries()
            .asSequence()
            .filter { Regex("xl/worksheets/sheet\\d+\\.xml").matches(it.name) }
            .sortedBy { it.name.filter(Char::isDigit).toIntOrNull() ?: 0 }
            .forEach { entry ->
                output.append("\n[" + entry.name.substringAfterLast('/') + "]\n")
                parse(entry.name) { p ->
                    var cellRef = ""
                    var type = ""
                    var style = 0
                    var value = StringBuilder()
                    var formula = StringBuilder()
                    var tag = ""
                    while (p.eventType != XmlPullParser.END_DOCUMENT) {
                        if (p.eventType == XmlPullParser.START_TAG) {
                            tag = p.name
                            if (tag == "c") {
                                cellRef = p.getAttributeValue(null,"r") ?: ""
                                type = p.getAttributeValue(null, "t") ?: ""
                                style = p.getAttributeValue(null, "s")?.toIntOrNull() ?: 0
                                value = StringBuilder()
                                formula = StringBuilder()
                            }
                        }
                        if (p.eventType == XmlPullParser.TEXT) {
                            if (tag in setOf("t", "v")) value.append(p.text)
                            if (tag == "f") formula.append(p.text)
                        }
                        if (p.eventType == XmlPullParser.END_TAG) {
                            when (p.name) {
                                "c" -> {
                                    val raw = value.toString()
                                    val number = raw.toDoubleOrNull()
                                    val format = styles.getOrNull(style) ?: 0
                                    if(cellRef.isNotEmpty())output.append("["+cellRef+"] ")
                                    output.append(
                                        when {
                                            type == "s" ->
                                                shared.getOrNull(raw.toIntOrNull() ?: -1) ?: raw
                                            type == "b" -> if (raw == "1") "TRUE" else "FALSE"
                                            raw.isEmpty() && formula.isNotEmpty() -> "=" + formula
                                            number != null && type in setOf("", "n") ->
                                                formatter.formatRawCellContents(
                                                    number,
                                                    format,
                                                    formats[format]
                                                        ?: org.apache.poi.ss.usermodel
                                                            .BuiltinFormats
                                                            .getBuiltinFormat(format)
                                                        ?: "General",
                                                )
                                            else -> raw
                                        }
                                    )
                                    if(raw.isNotEmpty()&&formula.isNotEmpty())output.append(" {公式 ="+formula+"}")
                                    output.append('\t')
                                }
                                "row" -> output.append('\n')
                            }
                            tag = ""
                        }
                        require(output.length <= 20 * 1024 * 1024) { "表格文字超过限制" }
                        p.next()
                    }
                }
            }
        return output.toString()
    }

    fun owns(file: File): Boolean =
        runCatching { file.exists() && file.canonicalFile.parentFile == folder.canonicalFile }
            .getOrDefault(false)

    fun removePreview(path: String) {
        val file = File(path)
        if (owns(file)) file.delete()
    }

    fun preview(file: File): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        val options =
            BitmapFactory.Options().apply {
                inSampleSize = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / 1400)
            }
        return decodeNativeImage(file.path, options)
    }

    fun share(file: File, mime: String) {
        val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
        context.startActivity(
            Intent.createChooser(
                    Intent(Intent.ACTION_SEND)
                        .setType(mime)
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                    "分享文件",
                )
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    fun saveGallery(file: File, mime: String): Uri? {
        if (Build.VERSION.SDK_INT < 29) return null
        val values =
            ContentValues().apply {
                put(
                    MediaStore.Images.Media.DISPLAY_NAME,
                    "AI-" + System.currentTimeMillis() + "." + file.extension,
                )
                put(MediaStore.Images.Media.MIME_TYPE, mime)
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/AI助手")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        val uri =
            context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: error("无法创建相册文件")
        try {
            context.contentResolver.openOutputStream(uri)?.use { output ->
                file.inputStream().use { it.copyTo(output) }
            } ?: error("无法写入相册")
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            context.contentResolver.update(uri, values, null, null)
            return uri
        } catch (error: Exception) {
            context.contentResolver.delete(uri, null, null)
            throw error
        }
    }
}

/** JPEG orientation is applied once before display and PNG/mask conversion. */
fun decodeNativeImage(
    path: String,
    options: BitmapFactory.Options = BitmapFactory.Options(),
): Bitmap? {
    val bitmap = BitmapFactory.decodeFile(path, options) ?: return null
    val orientation =
        runCatching {
                ExifInterface(path)
                    .getAttributeInt(
                        ExifInterface.TAG_ORIENTATION,
                        ExifInterface.ORIENTATION_NORMAL,
                    )
            }
            .getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val matrix = Matrix()
    when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> {
            matrix.setRotate(90f)
            matrix.postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> {
            matrix.setRotate(-90f)
            matrix.postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
        else -> return bitmap
    }
    val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (oriented !== bitmap) bitmap.recycle()
    return oriented
}
