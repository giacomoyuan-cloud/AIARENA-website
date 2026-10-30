@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.pickandcase.assistant

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class NativeExport(
    val path: String,
    val mime: String,
    val name: String,
    val accountId: String,
)

@Composable
fun NativeExportHost(vm: AssistantViewModel) {
    val request by vm.exports.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val coroutine = rememberCoroutineScope()
    var path by rememberSaveable { mutableStateOf("") }
    var owner by rememberSaveable { mutableStateOf("") }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result
            ->
            val source = path
            val account = owner
            path = ""
            owner = ""
            val uri = result.data?.data
            if (
                result.resultCode == Activity.RESULT_OK &&
                    uri != null &&
                    source.isNotBlank() &&
                    account == vm.state.value.session?.accountId
            )
                coroutine.launch {
                    runCatching {
                            withContext(Dispatchers.IO) {
                                val output =
                                    context.contentResolver.openOutputStream(uri)
                                        ?: error("无法写入所选位置")
                                output.use { stream ->
                                    File(source).inputStream().use { it.copyTo(stream) }
                                }
                            }
                        }
                        .onSuccess { vm.notice("文件已保存") }
                        .onFailure { vm.notice(it.message ?: "保存未完成，请重试") }
                }
        }
    LaunchedEffect(request) {
        request?.let { value ->
            path = value.path
            owner = value.accountId
            vm.exportHandled()
            runCatching {
                    picker.launch(
                        Intent(Intent.ACTION_CREATE_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE)
                            .setType(value.mime)
                            .putExtra(Intent.EXTRA_TITLE, value.name)
                    )
                }
                .onFailure {
                    path = ""
                    owner = ""
                    vm.notice("当前设备没有可用的文件保存应用")
                }
        }
    }
}

@Composable
fun VoiceButton(vm: AssistantViewModel) {
    val voice =
        rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result
            ->
            if (result.resultCode == Activity.RESULT_OK)
                result.data
                    ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                    ?.firstOrNull()
                    ?.let { text -> vm.draft((vm.state.value.draft + " " + text).trim()) }
        }
    IconButton(
        onClick = {
            runCatching {
                    voice.launch(
                        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                            .putExtra(
                                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                            )
                            .putExtra(RecognizerIntent.EXTRA_PROMPT, "说出你的问题")
                    )
                }
                .onFailure { vm.notice("当前设备未安装语音识别服务，可使用键盘语音输入") }
        }
    ) {
        Icon(Icons.Outlined.Mic, "语音输入")
    }
}

@Composable
fun NativeImageViewer(path: String, onDismiss: () -> Unit) {
    var bitmap by remember(path) { mutableStateOf<Bitmap?>(null) }
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    LaunchedEffect(path) { bitmap = withContext(Dispatchers.IO) { decodeNativeImage(path) } }
    DisposableEffect(bitmap) {
        val value = bitmap
        onDispose { value?.recycle() }
    }
    Dialog(
        onDismissRequest = onDismiss,
        properties =
            DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black).safeDrawingPadding()) {
            bitmap?.let { value ->
                Image(
                    value.asImageBitmap(),
                    "原图，双指缩放",
                    Modifier.fillMaxSize()
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            translationX = offset.x
                            translationY = offset.y
                        }
                        .transformable(
                            rememberTransformableState { zoom, pan, _ ->
                                scale = (scale * zoom).coerceIn(1f, 8f)
                                offset = if (scale == 1f) Offset.Zero else offset + pan
                            }
                        ),
                )
            }
            Row(Modifier.align(Alignment.TopEnd)) {
                TextButton(
                    onClick = {
                        scale = 1f
                        offset = Offset.Zero
                    }
                ) {
                    Text("复位", color = Color.White)
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Outlined.Close, "关闭原图", tint = Color.White)
                }
            }
        }
    }
}

private data class MaskStroke(val points: List<Offset>, val width: Float)

/** The same normalized strokes drive the native preview and original-resolution alpha mask. */
@Composable
fun NativeMaskEditor(reference: NativeAttachment, vm: AssistantViewModel, onDismiss: () -> Unit) {
    var bitmap by remember(reference.path) { mutableStateOf<Bitmap?>(null) }
    var strokes by remember { mutableStateOf<List<MaskStroke>>(emptyList()) }
    var brush by remember { mutableFloatStateOf(0.05f) }
    var saving by remember { mutableStateOf(false) }
    val coroutine = rememberCoroutineScope()
    val context = LocalContext.current
    LaunchedEffect(reference.path) {
        bitmap = withContext(Dispatchers.IO) { vm.files.preview(File(reference.path)) }
    }
    Dialog(
        onDismissRequest = { if (!saving) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            Modifier.fillMaxWidth().fillMaxHeight(0.94f),
            shape = MaterialTheme.shapes.extraLarge,
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("局部重绘", style = MaterialTheme.typography.titleLarge)
                Text("涂抹要修改的区域，未涂抹的部分保持原样。", style = MaterialTheme.typography.bodySmall)
                bitmap?.let { value ->
                    Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                        Box(
                            Modifier.fillMaxWidth()
                                .aspectRatio(value.width.toFloat() / value.height)
                        ) {
                            Image(value.asImageBitmap(), "参考图片", Modifier.fillMaxSize())
                            Canvas(
                                Modifier.fillMaxSize().testTag("mask-canvas").pointerInput(brush) {
                                    detectDragGestures(
                                        onDragStart = { point ->
                                            val p =
                                                Offset(
                                                    (point.x / size.width).coerceIn(0f, 1f),
                                                    (point.y / size.height).coerceIn(0f, 1f),
                                                )
                                            strokes = strokes + MaskStroke(listOf(p), brush)
                                        },
                                        onDrag = { change, _ ->
                                            change.consume()
                                            if (strokes.isNotEmpty()) {
                                                val p =
                                                    Offset(
                                                        (change.position.x / size.width).coerceIn(
                                                            0f,
                                                            1f,
                                                        ),
                                                        (change.position.y / size.height).coerceIn(
                                                            0f,
                                                            1f,
                                                        ),
                                                    )
                                                strokes =
                                                    strokes.dropLast(1) +
                                                        strokes
                                                            .last()
                                                            .copy(
                                                                points = strokes.last().points + p
                                                            )
                                            }
                                        },
                                    )
                                }
                            ) {
                                strokes.forEach { stroke ->
                                    val width = stroke.width * size.minDimension
                                    val p = Path()
                                    stroke.points.forEachIndexed { i, point ->
                                        if (i == 0)
                                            p.moveTo(point.x * size.width, point.y * size.height)
                                        else p.lineTo(point.x * size.width, point.y * size.height)
                                    }
                                    if (stroke.points.size == 1)
                                        drawCircle(
                                            Color(0x88DC7656),
                                            width / 2,
                                            Offset(
                                                stroke.points.first().x * size.width,
                                                stroke.points.first().y * size.height,
                                            ),
                                        )
                                    else
                                        drawPath(
                                            p,
                                            Color(0x88DC7656),
                                            style = Stroke(width, cap = StrokeCap.Round),
                                        )
                                }
                            }
                        }
                    }
                }
                Text("笔刷大小", style = MaterialTheme.typography.labelMedium)
                Slider(brush, { brush = it }, valueRange = 0.01f..0.16f)
                Row {
                    TextButton(
                        onClick = { strokes = strokes.dropLast(1) },
                        enabled = strokes.isNotEmpty() && !saving,
                    ) {
                        Text("撤销")
                    }
                    TextButton(onClick = { strokes = emptyList() }, enabled = !saving) {
                        Text("清空")
                    }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = onDismiss, enabled = !saving) { Text("取消") }
                    Button(
                        enabled = strokes.isNotEmpty() && !saving,
                        onClick = {
                            saving = true
                            coroutine.launch {
                                runCatching {
                                        withContext(Dispatchers.IO) {
                                            val original =
                                                decodeNativeImage(reference.path) ?: error("无法读取图片")
                                            val folder =
                                                File(context.filesDir, "attachments").apply {
                                                    mkdirs()
                                                }
                                            val source =
                                                File(folder, UUID.randomUUID().toString() + ".png")
                                            val mask =
                                                File(
                                                    folder,
                                                    UUID.randomUUID().toString() + "-mask.png",
                                                )
                                            try {
                                                source.outputStream().use {
                                                    check(
                                                        original.compress(
                                                            Bitmap.CompressFormat.PNG,
                                                            100,
                                                            it,
                                                        )
                                                    )
                                                }
                                                require(source.length() <= 10 * 1024 * 1024) {
                                                    "原图转为 PNG 后超过 10MB，请先缩小图片"
                                                }
                                                val alpha =
                                                    Bitmap.createBitmap(
                                                        original.width,
                                                        original.height,
                                                        Bitmap.Config.ARGB_8888,
                                                    )
                                                try {
                                                    val canvas = android.graphics.Canvas(alpha)
                                                    canvas.drawColor(android.graphics.Color.WHITE)
                                                    val paint =
                                                        android.graphics
                                                            .Paint(
                                                                android.graphics.Paint
                                                                    .ANTI_ALIAS_FLAG
                                                            )
                                                            .apply {
                                                                xfermode =
                                                                    PorterDuffXfermode(
                                                                        PorterDuff.Mode.CLEAR
                                                                    )
                                                                strokeCap =
                                                                    android.graphics.Paint.Cap.ROUND
                                                                strokeJoin =
                                                                    android.graphics.Paint.Join
                                                                        .ROUND
                                                                style =
                                                                    android.graphics.Paint.Style
                                                                        .STROKE
                                                            }
                                                    strokes.forEach { stroke ->
                                                        paint.strokeWidth =
                                                            stroke.width *
                                                                minOf(alpha.width, alpha.height)
                                                        val p = android.graphics.Path()
                                                        stroke.points.forEachIndexed { i, point ->
                                                            if (i == 0)
                                                                p.moveTo(
                                                                    point.x * alpha.width,
                                                                    point.y * alpha.height,
                                                                )
                                                            else
                                                                p.lineTo(
                                                                    point.x * alpha.width,
                                                                    point.y * alpha.height,
                                                                )
                                                        }
                                                        if (stroke.points.size == 1) {
                                                            val point = stroke.points.first()
                                                            paint.style =
                                                                android.graphics.Paint.Style.FILL
                                                            canvas.drawCircle(
                                                                point.x * alpha.width,
                                                                point.y * alpha.height,
                                                                paint.strokeWidth / 2,
                                                                paint,
                                                            )
                                                            paint.style =
                                                                android.graphics.Paint.Style.STROKE
                                                        } else canvas.drawPath(p, paint)
                                                    }
                                                    mask.outputStream().use {
                                                        check(
                                                            alpha.compress(
                                                                Bitmap.CompressFormat.PNG,
                                                                100,
                                                                it,
                                                            )
                                                        )
                                                    }
                                                } finally {
                                                    alpha.recycle()
                                                }
                                                NativeAttachment(
                                                    UUID.randomUUID().toString(),
                                                    reference.name.substringBeforeLast('.') +
                                                        ".png",
                                                    "image/png",
                                                    source.path,
                                                    source.length(),
                                                ) to
                                                    NativeAttachment(
                                                        UUID.randomUUID().toString(),
                                                        "mask.png",
                                                        "image/png",
                                                        mask.path,
                                                        mask.length(),
                                                    )
                                            } catch (error: Throwable) {
                                                source.delete()
                                                mask.delete()
                                                throw error
                                            } finally {
                                                original.recycle()
                                            }
                                        }
                                    }
                                    .onSuccess { (source, mask) ->
                                        vm.imageMask(source, mask)
                                        onDismiss()
                                    }
                                    .onFailure { vm.notice(it.message ?: "蒙版保存失败") }
                                saving = false
                            }
                        },
                    ) {
                        Text(if (saving) "保存中…" else "应用")
                    }
                }
            }
        }
    }
}

@Composable
fun NativeProgressImage(path: String) {
    var image by remember(path) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(path) {
        image =
            withContext(Dispatchers.IO) {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(path, bounds)
                decodeNativeImage(
                    path,
                    BitmapFactory.Options().apply {
                        inSampleSize = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / 1200)
                    },
                )
            }
    }
    DisposableEffect(image) {
        val value = image
        onDispose { value?.recycle() }
    }
    image?.let {
        Image(it.asImageBitmap(), "生成过程预览", Modifier.fillMaxWidth().heightIn(max = 360.dp))
        Text("生成中，最终结果完成后可保存原图", style = MaterialTheme.typography.bodySmall)
    }
}
