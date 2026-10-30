@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.pickandcase.assistant

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun NativeUsageReceipt(receipt: JSONObject, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("请求明细") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(receipt.str("model"))
                Text(dateLabel(receipt.opt("at")))
                val counters = receipt.optJSONObject("execution") ?: receipt
                fun count(key: String) = if (counters.isNull(key)) "官方未提供" else counters.str(key)
                Text("输入 token（含缓存）：" + count("input"))
                Text("输出 token（含思考）：" + count("output"))
                val details = counters.obj("details")
                listOf(
                        "cachedInput" to "其中缓存命中",
                        "outputReasoning" to "其中思考 token（不重复加算）",
                        "outputImage" to "其中图片输出 token",
                        "toolInput" to "其中工具输入 token",
                    )
                    .forEach { (key, name) ->
                        if (details.optLong(key) > 0) Text(name + "：" + details.str(key))
                    }
                Text(
                    if (receipt.optBoolean("billingComplete")) "完整核算金额：$" + receipt.str("costUsd")
                    else "已核算部分：$" + receipt.str("knownCostUsd", "待核实")
                )
                if (!receipt.optBoolean("billingComplete")) Text("部分费用尚未核实，未知部分未计为 0。")
                receipt.arr("items").objects().forEach { item ->
                    val name =
                        mapOf(
                            "input" to "输入",
                            "uncachedInput" to "未缓存输入",
                            "cachedInput" to "缓存输入",
                            "output" to "输出",
                            "imageOutput" to "图片输出",
                            "webSearch" to "联网搜索",
                        )[item.str("kind")] ?: item.str("kind")
                    Text(
                        "${name} · ${item.str("count", "待核实")} · $${item.str("amountUsd", "待核实")}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                receipt.arr("auxiliary").objects().forEach { child ->
                    Text(
                        "附加调用：${child.str("model")} · $${child.str("costUsd", child.str("knownCostUsd", "待核实"))}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("关闭") } },
    )
}

@Composable
fun ChoiceField(
    label: String,
    current: String,
    options: List<Pair<String, String>>,
    onPick: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(7.dp))
        OutlinedCard(Modifier.fillMaxWidth().clickable { open = true }) {
            Row(
                Modifier.padding(14.dp).fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    options.find { it.first == current }?.second ?: current,
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Icon(Icons.Outlined.ExpandMore, null)
            }
        }
    }
    if (open)
        ModalBottomSheet(onDismissRequest = { open = false }) {
            Text(label, Modifier.padding(20.dp), style = MaterialTheme.typography.titleLarge)
            LazyColumn(Modifier.heightIn(max = 480.dp).navigationBarsPadding()) {
                items(options, key = { it.first }) { (id, title) ->
                    ListItem(
                        headlineContent = { Text(title) },
                        trailingContent = {
                            if (id == current)
                                Icon(
                                    Icons.Outlined.Check,
                                    null,
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                        },
                        modifier =
                            Modifier.clickable {
                                onPick(id)
                                open = false
                            },
                    )
                }
            }
        }
}

@Composable
fun OrderedSlider(
    title: String,
    options: List<Pair<String, String>>,
    value: String,
    automatic: Boolean = false,
    onPick: (String) -> Unit,
) {
    if (options.isEmpty()) return
    val auto = automatic && value == "auto"
    val index =
        options
            .indexOfFirst { it.first == value }
            .let { if (it < 0) minOf(1, options.lastIndex) else it }
    val accent = MaterialTheme.colorScheme.primary
    val gray = MaterialTheme.colorScheme.outlineVariant
    val surface = MaterialTheme.colorScheme.surface
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                title,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.weight(1f),
            )
            if (!auto) Text(options[index].second, style = MaterialTheme.typography.labelLarge)
            if (automatic)
                TextButton(
                    onClick = { onPick("auto") },
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                ) {
                    Text(
                        "自动",
                        color = if (auto) accent else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
        }
        Slider(
            value = index.toFloat(),
            onValueChange = {
                onPick(options[it.roundToInt().coerceIn(0, options.lastIndex)].first)
            },
            onValueChangeFinished = { if (auto) onPick(options[index].first) },
            valueRange = 0f..maxOf(1, options.lastIndex).toFloat(),
            steps = maxOf(0, options.size - 2),
            modifier = Modifier.fillMaxWidth().height(34.dp),
            thumb = {
                Surface(
                    Modifier.size(18.dp).alpha(if (auto) 0f else 1f),
                    shape = CircleShape,
                    color = surface,
                    border = BorderStroke(2.dp, accent),
                    shadowElevation = 2.dp,
                ) {}
            },
            track = { state ->
                Canvas(Modifier.fillMaxWidth().height(4.dp)) {
                    val y = size.height / 2
                    val progress = if (auto) 0f else state.value / maxOf(1, options.lastIndex)
                    drawLine(
                        gray,
                        Offset(0f, y),
                        Offset(size.width, y),
                        4.dp.toPx(),
                        StrokeCap.Round,
                    )
                    if (progress > 0)
                        drawLine(
                            accent,
                            Offset(0f, y),
                            Offset(size.width * progress, y),
                            4.dp.toPx(),
                            StrokeCap.Round,
                        )
                    val ticks = if (options.size <= 11) maxOf(1, options.lastIndex) else 4
                    for (i in 0..ticks) drawCircle(
                        if (i.toFloat() / ticks <= progress && !auto) surface.copy(alpha = .45f)
                        else gray,
                        1.6.dp.toPx(),
                        Offset(size.width * i / ticks, y),
                    )
                }
            },
        )
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                options.first().second,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                options.last().second,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun ModelSheet(s: AssistantState, vm: AssistantViewModel, onDismiss: () -> Unit) {
    val restricted =
        s.skills.str("mode") == "manual" &&
            s.skills.arr("ids").strings().any { id ->
                s.catalog.arr("skills").objects().any {
                    it.str("id") == id && (it.optBoolean("official") || it.str("kind") == "compute")
                }
            }
    val models =
        s.catalog
            .arr("models")
            .objects()
            .filterNot { it.optBoolean("image") }
            .filter { !restricted || s.catalog.obj("skillModels").has(it.str("id")) }
            .ifEmpty {
                listOf(
                    json(
                        "id" to "gpt-6.1-sol",
                        "name" to "GPT-6.1 Sol",
                        "levels" to JSONArray(listOf("low", "medium", "high", "xhigh", "max")),
                    )
                )
            }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 20.dp).navigationBarsPadding()) {
            Text("模型与思考深度", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(16.dp))
            val levels = models.find { it.str("id") == s.model }?.arr("levels")?.strings().orEmpty()
            if (levels.isNotEmpty()) {
                OrderedSlider("思考深度", levels.map { it to effortLabel(it) }, s.effort) {
                    vm.model(s.model, it)
                }
                Spacer(Modifier.height(18.dp))
            }
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(models, key = { it.str("id") }) { model ->
                    ListItem(
                        headlineContent = { Text(model.str("name")) },
                        supportingContent = { Text(model.str("provider")) },
                        trailingContent = {
                            if (model.str("id") == s.model)
                                Icon(
                                    Icons.Outlined.Check,
                                    null,
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                        },
                        modifier =
                            Modifier.clickable {
                                val levels = model.arr("levels").strings()
                                vm.model(
                                    model.str("id"),
                                    vm.savedEffort(model.str("id")).takeIf { it in levels }
                                        ?: levels.firstOrNull().orEmpty(),
                                )
                            },
                    )
                }
            }
        }
    }
}

@Composable
fun ImageSettingsSheet(s: AssistantState, vm: AssistantViewModel, onDismiss: () -> Unit) {
    val caps = s.catalog.obj("imageCapabilities")
    val model = s.imageModel
    val cap = caps.obj(model)
    val openai = cap.optBoolean("openai") || model.startsWith("gpt-image")
    val settings = s.imageSettings
    var showMask by remember { mutableStateOf(false) }
    if (showMask)
        s.attachments
            .firstOrNull { it.image }
            ?.let { reference -> NativeMaskEditor(reference, vm) { showMask = false } }
    fun set(key: String, value: Any) {
        val next = settings.copyJson().put(key, value)
        if (key == "background" && value == "transparent" && next.str("format") == "jpeg")
            next.put("format", "png")
        if (key == "format" && value == "jpeg" && next.str("background") == "transparent")
            next.put("background", "auto")
        vm.imageConfig(model, s.imageTask, next)
    }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = 20.dp)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            Text("图像设置", style = MaterialTheme.typography.titleLarge)
            ChoiceField(
                "模型",
                model,
                s.catalog
                    .arr("models")
                    .objects()
                    .filter { it.optBoolean("image") && caps.has(it.str("id")) }
                    .map { it.str("id") to it.str("name") },
            ) {
                vm.selectImageModel(it)
            }
            ChoiceField(
                "创作方式",
                s.imageTask,
                listOf("generation" to "生成图片", "edit" to "编辑单张图片", "multi-edit" to "多图编辑"),
            ) {
                vm.imageConfig(model, it, settings)
            }
            if (openai) {
                val sizes =
                    cap.arr("sizes").strings().ifEmpty {
                        listOf(
                            "auto",
                            "1024x1024",
                            "1536x1024",
                            "1024x1536",
                            "2048x2048",
                            "3840x2160",
                            "custom",
                        )
                    }
                ChoiceField(
                    "画面尺寸",
                    settings.str("size", "auto"),
                    sizes.map {
                        it to
                            when (it) {
                                "auto" -> "自动尺寸"
                                "custom" -> "自定义尺寸"
                                else -> it.replace("x", " × ")
                            }
                    },
                ) {
                    set("size", it)
                }
                if (settings.str("size") == "custom")
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedTextField(
                            settings.optInt("customWidth", 1536).toString(),
                            { it.toIntOrNull()?.let { n -> set("customWidth", n) } },
                            label = { Text("宽度 px") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedTextField(
                            settings.optInt("customHeight", 864).toString(),
                            { it.toIntOrNull()?.let { n -> set("customHeight", n) } },
                            label = { Text("高度 px") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
                        )
                    }
                if (s.attachments.count { it.image } == 1)
                    TextButton(onClick = { showMask = true }) {
                        Icon(Icons.Outlined.Brush, null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (s.imageMask != null) "重新涂抹修改区域" else "涂抹修改区域")
                    }
                OrderedSlider(
                    "画质",
                    listOf(
                        "low" to "草稿",
                        "medium" to "标准",
                        "high" to "精细",
                        "xhigh" to "超精细",
                        "max" to "最高",
                    ),
                    settings.str("quality", "auto"),
                    automatic = true,
                ) {
                    set("quality", it)
                }
                ChoiceField(
                    "文件格式",
                    settings.str("format", "png"),
                    listOf("png" to "PNG", "jpeg" to "JPEG", "webp" to "WebP"),
                ) {
                    set("format", it)
                }
                ChoiceField(
                    "背景",
                    settings.str("background", "auto"),
                    listOf("auto" to "自动", "opaque" to "不透明", "transparent" to "透明"),
                ) {
                    set("background", it)
                }
                OrderedSlider(
                    if (s.imageTask == "generation") "生成数量" else "编辑版本数",
                    (1..10).map { it.toString() to "$it 张" },
                    settings.optInt("count", 1).toString(),
                ) {
                    set("count", it.toInt())
                }
                if (settings.str("format", "png") != "png")
                    OrderedSlider(
                        "保存质量",
                        (0..100).map {
                            it.toString() to
                                if (it == 0) "0% · 更小文件"
                                else if (it == 100) "100% · 更高保真" else "$it%"
                        },
                        settings.optInt("compression", 100).toString(),
                    ) {
                        set("compression", it.toInt())
                    }
                var advanced by remember { mutableStateOf(false) }
                TextButton(onClick = { advanced = !advanced }) {
                    Text("高级选项")
                    Icon(
                        if (advanced) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                        null,
                    )
                }
                if (advanced) {
                    OrderedSlider(
                        "生成过程预览",
                        (0..3).map { it.toString() to if (it == 0) "关闭" else "$it 次" },
                        settings.optInt("partial", 2).toString(),
                    ) {
                        set("partial", it.toInt())
                    }
                    ChoiceField(
                        "内容过滤",
                        settings.str("moderation", "auto"),
                        listOf("auto" to "标准", "low" to "较宽松"),
                    ) {
                        set("moderation", it)
                    }
                }
            } else {
                ChoiceField(
                    "画面比例",
                    settings.str("ratio", "1:1"),
                    cap.arr("ratios").strings().map { it to if (it == "auto") "自动" else it },
                ) {
                    set("ratio", it)
                }
                OrderedSlider(
                    "分辨率",
                    cap.arr("sizes").strings().map { it to it.uppercase() },
                    settings.str("size", if (model.startsWith("gemini")) "1K" else "1k"),
                ) {
                    set("size", it)
                }
                if (model.startsWith("gemini")) {
                    OrderedSlider(
                        "思考强度",
                        listOf("minimal" to "快速", "medium" to "均衡", "high" to "深入"),
                        settings.str("thinking", "medium"),
                    ) {
                        set("thinking", it)
                    }
                    ChoiceField(
                        "联网参考",
                        settings.str("grounding", "off"),
                        listOf(
                            "off" to "不搜索",
                            "web" to "网页资料",
                            "image" to "图片参考",
                            "web-image" to "网页和图片",
                        ),
                    ) {
                        set("grounding", it)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("仅返回图片", Modifier.weight(1f))
                        Switch(settings.optBoolean("imageOnly"), { set("imageOnly", it) })
                    }
                    ChoiceField(
                        "风格预设",
                        settings.str("style", "none"),
                        listOf(
                            "none" to "无预设",
                            "photo" to "写实摄影",
                            "illustration" to "插画",
                            "watercolor" to "水彩",
                            "cinematic" to "电影质感",
                            "anime" to "动漫",
                            "3d" to "3D 立体",
                            "pixel" to "像素风",
                        ),
                    ) {
                        set("style", it)
                    }
                    OutlinedTextField(
                        settings.str("overlayText"),
                        { set("overlayText", it) },
                        label = { Text("画面内的文字") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 3,
                    )
                } else {
                    OrderedSlider(
                        "生成质量",
                        listOf("low" to "标准", "medium" to "精细"),
                        settings.str("quality", "auto"),
                        automatic = true,
                    ) {
                        set("quality", it)
                    }
                    if (s.imageTask == "generation")
                        OrderedSlider(
                            "生成数量",
                            (1..4).map { it.toString() to "$it 张" },
                            settings.optInt("count", 1).toString(),
                        ) {
                            set("count", it.toInt())
                        }
                }
            }
            Text(
                "最多 ${cap.optInt("references",16)} 张参考图。每张独立生成并计费。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(18.dp))
        }
    }
}

@Composable
fun DebateSettingsSheet(s: AssistantState, vm: AssistantViewModel, onDismiss: () -> Unit) {
    val config = s.debate
    val models = s.catalog.arr("models").objects().filterNot { it.optBoolean("image") }
    val options = models.map { it.str("id") to it.str("name") }
    fun set(key: String, value: Any) {
        vm.debateConfig(config.copyJson().put(key, value))
    }
    fun member(index: Int, key: String, value: String) {
        val list = config.arr("members").objects().map { it.copyJson() }
        list[index].put(key, value)
        if (key == "model") {
            val levels = models.find { it.str("id") == value }?.arr("levels")?.strings().orEmpty()
            if (levels.isEmpty()) list[index].remove("effort")
            else list[index].put("effort", levels.first())
        }
        set("members", JSONArray(list))
    }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = 20.dp)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text("讨论设置", style = MaterialTheme.typography.titleLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("free" to "自由讨论", "persona" to "角色讨论", "2v2" to "2v2").forEach { (id, label)
                    ->
                    FilterChip(
                        selected = config.str("mode", "free") == id,
                        onClick = {
                            val count = if (id == "2v2") 4 else 2
                            val list =
                                (0 until count).map { n ->
                                    json(
                                            "id" to "seat-${n+1}",
                                            "label" to
                                                if (id == "2v2")
                                                    (if (n < 2) "正方 " else "反方 ") + ((n % 2) + 1)
                                                else "席位 ${n+1}",
                                            "model" to "gpt-6.1-sol",
                                            "effort" to "low",
                                        )
                                        .apply {
                                            if (id == "2v2")
                                                put("team", if (n < 2) "pro" else "con")
                                        }
                                }
                            vm.debateConfig(
                                config.copyJson().put("mode", id).put("members", JSONArray(list))
                            )
                        },
                        label = { Text(label) },
                    )
                }
            }
            config.arr("members").objects().forEachIndexed { index, seat ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                seat.str("label", "席位 ${index+1}"),
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.titleSmall,
                            )
                            if (config.str("mode") != "2v2" && config.arr("members").length() > 2)
                                IconButton(
                                    onClick = {
                                        set(
                                            "members",
                                            JSONArray(
                                                config.arr("members").objects().filterIndexed { i, _
                                                    ->
                                                    i != index
                                                }
                                            ),
                                        )
                                    }
                                ) {
                                    Icon(Icons.Outlined.Close, "移除席位")
                                }
                        }
                        ChoiceField("模型", seat.str("model"), options) { member(index, "model", it) }
                        val levels =
                            models
                                .find { it.str("id") == seat.str("model") }
                                ?.arr("levels")
                                ?.strings()
                                .orEmpty()
                        if (levels.isNotEmpty())
                            OrderedSlider(
                                "思考深度",
                                levels.map { it to effortLabel(it) },
                                seat.str("effort", "low"),
                            ) {
                                member(index, "effort", it)
                            }
                        if (config.str("mode") == "persona") {
                            OutlinedTextField(
                                seat.str("role"),
                                { member(index, "role", it) },
                                label = { Text("角色身份") },
                                modifier = Modifier.fillMaxWidth(),
                            )
                            OutlinedTextField(
                                seat.str("desc"),
                                { member(index, "desc", it) },
                                label = { Text("补充要求") },
                                modifier = Modifier.fillMaxWidth(),
                                maxLines = 3,
                            )
                        }
                    }
                }
            }
            if (config.str("mode") != "2v2" && config.arr("members").length() < 6)
                OutlinedButton(
                    onClick = {
                        val n = config.arr("members").length() + 1
                        set(
                            "members",
                            JSONArray(
                                config.arr("members").objects() +
                                    json(
                                        "id" to "seat-" + System.currentTimeMillis(),
                                        "label" to "席位 $n",
                                        "model" to "gpt-6.1-sol",
                                        "effort" to "low",
                                    )
                            ),
                        )
                    }
                ) {
                    Icon(Icons.Outlined.Add, null)
                    Text("添加席位")
                }
            OrderedSlider(
                "轮数",
                (1..3).map { it.toString() to "$it 轮" },
                config.optInt("rounds", 1).toString(),
            ) {
                set("rounds", it.toInt())
            }
            ChoiceField(
                "讨论目标",
                config.str("objective", "explore"),
                listOf("explore" to "多角度探索", "decision" to "辅助决策", "stress-test" to "方案压力测试"),
            ) {
                set("objective", it)
            }
            OrderedSlider(
                "回答详略",
                listOf("concise" to "简洁", "balanced" to "均衡", "detailed" to "深入"),
                config.str("detail", "balanced"),
            ) {
                set("detail", it)
            }
            ChoiceField(
                "讨论总结",
                config.str("summaryModel", "none"),
                listOf("none" to "不生成总结") + options,
            ) {
                val next = config.copyJson().put("summaryModel", it)
                val levels =
                    models.find { m -> m.str("id") == it }?.arr("levels")?.strings().orEmpty()
                if (levels.isNotEmpty()) next.put("summaryEffort", levels.first())
                else next.remove("summaryEffort")
                vm.debateConfig(next)
            }
            if (config.str("summaryModel", "none") != "none") {
                val levels =
                    models
                        .find { it.str("id") == config.str("summaryModel") }
                        ?.arr("levels")
                        ?.strings()
                        .orEmpty()
                if (levels.isNotEmpty())
                    OrderedSlider(
                        "总结的思考深度",
                        levels.map { it to effortLabel(it) },
                        config.str("summaryEffort", "low"),
                    ) {
                        set("summaryEffort", it)
                    }
            }
            OutlinedTextField(
                config.str("context"),
                { set("context", it) },
                label = { Text("讨论背景（可选）") },
                modifier = Modifier.fillMaxWidth(),
                maxLines = 5,
            )
            OutlinedTextField(
                config.str("constraints"),
                { set("constraints", it) },
                label = { Text("目标与约束（可选）") },
                modifier = Modifier.fillMaxWidth(),
                maxLines = 4,
            )
            Text(
                "先独立表达观点，再交叉质询和修订。每席与总结可单独设置思考深度。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
fun DebateRecovery(s: AssistantState, vm: AssistantViewModel) {
    val run = s.run ?: return
    val context = androidx.compose.ui.platform.LocalContext.current
    val exporter =
        androidx.activity.compose.rememberLauncherForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.CreateDocument(
                "text/markdown"
            )
        ) { uri ->
            if (uri != null)
                runCatching {
                        context.contentResolver.openOutputStream(uri)?.use {
                            it.write(vm.exportedText().toByteArray())
                        }
                    }
                    .onSuccess { vm.notice("讨论记录已导出") }
        }
    Surface(color = MaterialTheme.colorScheme.secondaryContainer) {
        Column(
            Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                (if (run.str("status") == "running") "讨论进行中"
                else if (run.str("status") == "completed") "讨论已完成" else "讨论已保留") +
                    " · ${run.optInt("completed")} / ${run.optInt("total")}",
                style = MaterialTheme.typography.labelMedium,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (run.str("status") != "running") {
                    val failed =
                        run.arr("turns").objects().firstOrNull {
                            it.str("status") in listOf("failed", "interrupted", "cancelled")
                        }
                    if (failed != null) {
                        val turn =
                            json(
                                "turnIndex" to failed.optInt("index"),
                                "turnAttempt" to failed.optInt("attempt"),
                            )
                        TextButton(onClick = { vm.debateAction("retry", turn) }) { Text("重试本席") }
                        TextButton(onClick = { vm.debateAction("skip", turn) }) { Text("跳过并继续") }
                    } else if (run.arr("turns").objects().any { it.str("status") == "pending" })
                        TextButton(onClick = { vm.debateAction("resume") }) { Text("继续讨论") }
                    TextButton(onClick = { vm.followupDebate() }) { Text("基于本场追问") }
                    if (run.arr("turns").objects().any { it.str("status") == "pending" })
                        TextButton(onClick = { vm.debateAction("finish") }) { Text("结束本场") }
                }
                TextButton(onClick = { exporter.launch("讨论记录.md") }) { Text("导出记录") }
            }
        }
    }
}
