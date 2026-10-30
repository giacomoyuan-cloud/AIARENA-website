@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.pickandcase.assistant

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.widget.TextView
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.noties.markwon.Markwon
import io.noties.markwon.ext.latex.JLatexMathPlugin
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.linkify.LinkifyPlugin
import java.io.File
import java.util.UUID
import kotlinx.coroutines.launch
import org.json.JSONObject

val WarmAccent = Color(0xFFC47155)

@Composable
fun AssistantApp(vm: AssistantViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val dark = state.theme == "dark" || state.theme == "system" && isSystemInDarkTheme()
    val colors =
        if (dark)
            darkColorScheme(
                primary = Color(0xFFE5A18B),
                background = Color(0xFF20201D),
                surface = Color(0xFF272723),
                secondaryContainer = Color(0xFF393930),
                outlineVariant = Color(0xFF49483F),
            )
        else
            lightColorScheme(
                primary = WarmAccent,
                background = Color(0xFFFAF9F5),
                surface = Color(0xFFFFFEFB),
                secondaryContainer = Color(0xFFF0EDE4),
                outlineVariant = Color(0xFFE1DED4),
            )
    MaterialTheme(colorScheme = colors) {
        Surface(Modifier.fillMaxSize(), color = colors.background) {
            if (state.session == null) LoginScreen(state, vm) else MainShell(state, vm)
            NativeExportHost(vm)
        }
    }
}

@Composable
private fun LoginScreen(s: AssistantState, vm: AssistantViewModel) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    Box(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().padding(28.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 420.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Kitten(Modifier.size(92.dp).align(Alignment.CenterHorizontally))
            Text(
                "AI 助手",
                fontSize = 32.sp,
                fontFamily = FontFamily.Serif,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
            Text(
                "让想法更进一步。",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                username,
                { username = it },
                label = { Text("账号") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("login-username"),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            )
            OutlinedTextField(
                password,
                { password = it },
                label = { Text("密码") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("login-password"),
                visualTransformation =
                    if (show) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions =
                    KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done,
                    ),
                keyboardActions = KeyboardActions(onDone = { vm.login(username, password) }),
                trailingIcon = {
                    IconButton(onClick = { show = !show }) {
                        Icon(
                            if (show) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            if (show) "隐藏密码" else "显示密码",
                        )
                    }
                },
            )
            if (s.error.isNotBlank())
                Text(
                    s.error,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("login-error"),
                )
            Button(
                onClick = { vm.login(username, password) },
                enabled = !s.loading,
                modifier = Modifier.fillMaxWidth().height(50.dp).testTag("login-submit"),
            ) {
                if (s.loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Text("登录")
            }
            Text(
                "登录状态会安全保留。可在设置中退出登录。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun MainShell(s: AssistantState, vm: AssistantViewModel) {
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(s.page) { keyboard?.hide() }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val coroutine = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var logout by remember { mutableStateOf(false) }
    LaunchedEffect(s.notice, s.error) {
        val text = s.error.ifBlank { s.notice }
        if (text.isNotBlank()) {
            snackbar.showSnackbar(text, withDismissAction = true)
            vm.dismissError()
        }
    }
    BackHandler(enabled = s.page != Page.CHAT) {
        vm.navigate(
            if (
                s.page in
                    listOf(
                        Page.ACCOUNT,
                        Page.ADMIN,
                        Page.USAGE,
                        Page.SKILLS,
                        Page.PROMPT,
                        Page.MEMORY,
                    )
            )
                Page.SETTINGS
            else Page.CHAT
        )
    }
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet {
                Column(Modifier.fillMaxHeight().widthIn(max = 320.dp).padding(horizontal = 12.dp)) {
                    Row(
                        Modifier.fillMaxWidth().padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Kitten(Modifier.size(40.dp))
                        Spacer(Modifier.width(12.dp))
                        Text("AI 助手", style = MaterialTheme.typography.titleLarge)
                    }
                    val entries =
                        listOf(
                            Triple("新建对话", Icons.Outlined.Add, Page.CHAT),
                            Triple("历史记录", Icons.Outlined.History, Page.HISTORY),
                            Triple("项目", Icons.Outlined.FolderOpen, Page.PROJECTS),
                            Triple("定时任务", Icons.Outlined.Schedule, Page.TASKS),
                            Triple("Skills", Icons.Outlined.AutoAwesome, Page.SKILLS),
                        )
                    entries.forEach { (title, icon, page) ->
                        NavigationDrawerItem(
                            label = { Text(title) },
                            icon = { Icon(icon, null) },
                            selected = s.page == page,
                            modifier = Modifier.padding(vertical = 2.dp),
                            onClick = {
                                if (page == Page.CHAT) vm.newChat() else vm.navigate(page)
                                coroutine.launch { drawer.close() }
                            },
                        )
                    }
                    HorizontalDivider(Modifier.padding(vertical = 12.dp))
                    if (s.project != null)
                        TextButton(
                            onClick = {
                                vm.general()
                                coroutine.launch { drawer.close() }
                            }
                        ) {
                            Icon(Icons.Outlined.Home, null)
                            Spacer(Modifier.width(8.dp))
                            Text("返回普通聊天")
                        }
                    Text(
                        "最近对话",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp, 8.dp),
                    )
                    LazyColumn(Modifier.weight(1f)) {
                        items(
                            s.histories.sortedByDescending { it.optBoolean("pinned") }.take(15),
                            key = { it.str("id") },
                        ) { chat ->
                            Text(
                                chat.str("title", "新对话"),
                                maxLines = 2,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier =
                                    Modifier.fillMaxWidth()
                                        .clip(MaterialTheme.shapes.medium)
                                        .clickable {
                                            vm.openChat(chat.str("id"), chat.str("title"))
                                            coroutine.launch { drawer.close() }
                                        }
                                        .padding(16.dp, 12.dp),
                            )
                        }
                    }
                    NavigationDrawerItem(
                        label = { Text(s.session?.profile?.str("displayName", "我的账号").orEmpty()) },
                        icon = { Icon(Icons.Outlined.Settings, null) },
                        selected = s.page == Page.SETTINGS,
                        onClick = {
                            vm.navigate(Page.SETTINGS)
                            coroutine.launch { drawer.close() }
                        },
                        modifier = Modifier.padding(vertical = 12.dp),
                    )
                }
            }
        },
    ) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                pageTitle(s),
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1,
                            )
                            if (s.project != null)
                                Text(
                                    s.project.str("name"),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = { coroutine.launch { drawer.open() } }) {
                            Icon(Icons.Outlined.Menu, "打开导航")
                        }
                    },
                    actions = {
                        if (s.page == Page.CHAT) {
                            IconButton(onClick = { vm.incognito(!s.incognito) }) {
                                Icon(
                                    Icons.Outlined.VisibilityOff,
                                    if (s.incognito) "关闭无痕" else "开启无痕",
                                    tint =
                                        if (s.incognito) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            IconButton(onClick = { vm.newChat() }) {
                                Icon(Icons.Outlined.Add, "新对话")
                            }
                        }
                    },
                )
            },
            bottomBar = {
                if (s.page == Page.SETTINGS)
                    Surface {
                        OutlinedButton(
                            onClick = { logout = true },
                            modifier =
                                Modifier.fillMaxWidth()
                                    .navigationBarsPadding()
                                    .padding(horizontal = 20.dp, vertical = 12.dp)
                                    .testTag("settings-logout"),
                        ) {
                            Icon(Icons.Outlined.Logout, null)
                            Spacer(Modifier.width(8.dp))
                            Text("退出登录")
                        }
                    }
            },
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                when (s.page) {
                    Page.CHAT -> ChatScreen(s, vm)
                    Page.HISTORY -> HistoryScreen(s, vm)
                    Page.PROJECTS -> ProjectsScreen(s, vm)
                    Page.PROJECT -> ProjectScreen(s, vm)
                    Page.TASKS -> TasksScreen(s, vm)
                    Page.SETTINGS -> SettingsScreen(s, vm) { logout = true }
                    Page.ACCOUNT -> AccountScreen(s, vm)
                    Page.ADMIN -> AdminScreen(s, vm)
                    Page.USAGE -> UsageScreen(s, vm)
                    Page.SKILLS -> SkillsScreen(s, vm)
                    Page.PROMPT -> PromptScreen(s, vm)
                    Page.MEMORY -> MemoryScreen(s, vm)
                }
            }
        }
    }
    if (logout)
        AlertDialog(
            onDismissRequest = { logout = false },
            title = { Text("退出登录？") },
            text = { Text("云端对话会保留。此设备需要重新登录后才能查看。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        logout = false
                        vm.logout()
                    },
                    modifier = Modifier.testTag("logout-confirm"),
                ) {
                    Text("退出登录")
                }
            },
            dismissButton = { TextButton(onClick = { logout = false }) { Text("取消") } },
        )
}

private fun pageTitle(s: AssistantState) =
    when (s.page) {
        Page.CHAT -> s.title
        Page.HISTORY -> "历史记录"
        Page.PROJECTS -> "项目"
        Page.PROJECT -> s.project?.str("name") ?: "项目"
        Page.TASKS -> "定时任务"
        Page.SETTINGS -> "设置"
        Page.ACCOUNT -> "账号设置"
        Page.ADMIN -> "管理"
        Page.USAGE -> "用量与账单"
        Page.SKILLS -> "Skills"
        Page.PROMPT -> "聊天提示词"
        Page.MEMORY -> "记忆"
    }

@Composable
fun Kitten(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val bitmap = remember {
        runCatching { context.assets.open("native-kitten.png").use(BitmapFactory::decodeStream) }
            .getOrNull()
    }
    if (bitmap != null) Image(bitmap.asImageBitmap(), "袁啾啾", modifier)
    else Icon(Icons.Outlined.AutoAwesome, null, modifier, tint = WarmAccent)
}

@Composable
private fun ChatScreen(s: AssistantState, vm: AssistantViewModel) {
    var options by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val list = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(s.messages.size) {
        if (s.messages.isNotEmpty()) list.animateScrollToItem(s.messages.lastIndex)
    }
    Column(Modifier.fillMaxSize()) {
        if (s.messages.isEmpty())
            Column(
                Modifier.weight(1f).fillMaxWidth().padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Kitten(Modifier.size(88.dp))
                Spacer(Modifier.height(20.dp))
                Text(
                    when (s.mode) {
                        "debate" -> "让不同观点，展开讨论。"
                        "image" -> "把想象，变成画面。"
                        else -> "想聊点什么？"
                    },
                    fontFamily = FontFamily.Serif,
                    fontSize = 27.sp,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    s.session?.profile?.str("displayName").orEmpty(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        else
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = list,
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                items(s.messages, key = { it.optLong("uid") }) { message ->
                    MessageView(message, s, vm)
                }
            }
        if (s.run != null) DebateRecovery(s, vm)
        if (s.connection.contains("恢复"))
            Text(
                s.connection,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 2.dp,
            tonalElevation = 0.dp,
        ) {
            Column(
                Modifier.fillMaxWidth().imePadding().padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    listOf("chat" to "对话", "debate" to "辩论", "image" to "图片").forEach {
                        (mode, label) ->
                        FilterChip(
                            selected = s.mode == mode,
                            onClick = { vm.mode(mode) },
                            label = { Text(label) },
                            enabled = !s.busy,
                        )
                    }
                    Spacer(Modifier.width(2.dp))
                    TextButton(onClick = { options = true }, enabled = !s.busy) {
                        Text(
                            if (s.mode == "chat")
                                vm.modelName(s.model) + " · " + effortLabel(s.effort)
                            else if (s.mode == "image") "图像设置" else "讨论设置"
                        )
                        Icon(Icons.Outlined.ExpandMore, null, Modifier.size(18.dp))
                    }
                }
                if (s.quote != null)
                    Row(
                        Modifier.fillMaxWidth()
                            .background(
                                MaterialTheme.colorScheme.secondaryContainer,
                                MaterialTheme.shapes.small,
                            )
                            .padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "引用 " + s.quote.str("author") + "：" + s.quote.str("text").take(100),
                            Modifier.weight(1f),
                            maxLines = 2,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        IconButton(onClick = vm::clearQuote) { Icon(Icons.Outlined.Close, "移除引用") }
                    }
                if (s.attachments.isNotEmpty())
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        s.attachments.forEach { file ->
                            InputChip(
                                selected = true,
                                onClick = {},
                                label = { Text(file.name, maxLines = 1) },
                                trailingIcon = {
                                    Icon(
                                        Icons.Outlined.Close,
                                        "移除",
                                        Modifier.size(16.dp).clickable {
                                            vm.removeAttachment(file.id)
                                        },
                                    )
                                },
                            )
                        }
                    }
                OutlinedTextField(
                    s.draft,
                    vm::draft,
                    placeholder = {
                        Text(
                            when (s.mode) {
                                "image" -> "描述想生成或修改的图片…"
                                "debate" -> "输入一个值得讨论的问题…"
                                else -> "输入消息…"
                            }
                        )
                    },
                    minLines = 1,
                    maxLines = 6,
                    modifier = Modifier.fillMaxWidth().testTag("composer"),
                    shape = MaterialTheme.shapes.large,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { vm.send() }),
                )
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    AttachmentButton(vm)
                    VoiceButton(vm)
                    FilterChip(
                        selected = s.search,
                        onClick = { vm.search(!s.search) },
                        label = { Text("联网") },
                        leadingIcon = { Icon(Icons.Outlined.Language, null, Modifier.size(16.dp)) },
                    )
                    Spacer(Modifier.weight(1f))
                    if (s.incognito)
                        Text(
                            "无痕",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    IconButton(
                        onClick = { if (s.busy) vm.stop() else vm.send() },
                        enabled = s.busy || s.draft.isNotBlank(),
                        modifier =
                            Modifier.background(
                                    MaterialTheme.colorScheme.primaryContainer,
                                    CircleShape,
                                )
                                .testTag("send"),
                    ) {
                        Icon(
                            if (s.busy) Icons.Outlined.Stop else Icons.Outlined.ArrowUpward,
                            if (s.busy) "停止生成" else "发送",
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                }
            }
        }
    }
    if (options)
        when (s.mode) {
            "chat" -> ModelSheet(s, vm) { options = false }
            "image" -> ImageSettingsSheet(s, vm) { options = false }
            else -> DebateSettingsSheet(s, vm) { options = false }
        }
}

@Composable
private fun AttachmentButton(vm: AssistantViewModel) {
    var menu by remember { mutableStateOf(false) }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val context = LocalContext.current
    val files =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) {
            vm.addFiles(it)
        }
    val camera =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
            if (success) cameraUri?.let { vm.addFiles(listOf(it)) }
        }
    Box {
        IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.Add, "添加附件") }
        DropdownMenu(menu, { menu = false }) {
            DropdownMenuItem(
                text = { Text("照片") },
                onClick = {
                    menu = false
                    files.launch(arrayOf("image/png", "image/jpeg", "image/webp"))
                },
                leadingIcon = { Icon(Icons.Outlined.PhotoLibrary, null) },
            )
            DropdownMenuItem(
                text = { Text("拍照") },
                onClick = {
                    menu = false
                    val folder = File(context.cacheDir, "shared-images").apply { mkdirs() }
                    val file = File(folder, UUID.randomUUID().toString() + ".jpg")
                    cameraUri =
                        FileProvider.getUriForFile(context, context.packageName + ".files", file)
                    camera.launch(cameraUri!!)
                },
                leadingIcon = { Icon(Icons.Outlined.CameraAlt, null) },
            )
            DropdownMenuItem(
                text = { Text("文件或 ZIP") },
                onClick = {
                    menu = false
                    files.launch(arrayOf("*/*"))
                },
                leadingIcon = { Icon(Icons.Outlined.AttachFile, null) },
            )
        }
    }
}

@Composable
private fun MessageView(message: JSONObject, s: AssistantState, vm: AssistantViewModel) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var edit by remember { mutableStateOf(false) }
    var comment by remember { mutableStateOf(false) }
    var zoom by remember { mutableStateOf<String?>(null) }
    var imageIndex by rememberSaveable(message.optLong("uid")) { mutableIntStateOf(0) }
    var artifactDelete by remember { mutableStateOf<JSONObject?>(null) }
    Column(
        Modifier.fillMaxWidth()
            .then(
                if (message.optBoolean("isUser"))
                    Modifier.background(
                            MaterialTheme.colorScheme.secondaryContainer,
                            MaterialTheme.shapes.large,
                        )
                        .padding(16.dp)
                else Modifier
            )
    ) {
        if (!message.optBoolean("isUser"))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    message.str("name", "AI"),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                if (message.str("debateStage").isNotBlank())
                    Text(
                        " · " + message.str("debateStage"),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
            }
        val reasoning = message.str("reasoning")
        if (reasoning.isNotBlank()) {
            var expanded by remember { mutableStateOf(false) }
            TextButton(onClick = { expanded = !expanded }) {
                Text(if (expanded) "收起思考过程" else "查看思考过程")
                Icon(
                    if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    null,
                    Modifier.size(16.dp),
                )
            }
            if (expanded)
                Text(
                    reasoning,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
        }
        if (message.str("text").isNotBlank()) Markdown(message.str("text"))
        else if (
            s.busy && message.optBoolean("isUser").not() && message.str("turnStatus") != "pending"
        )
            Row(
                Modifier.padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 1.5.dp)
                Spacer(Modifier.width(10.dp))
                Text("思考中…", style = MaterialTheme.typography.bodySmall)
            }
        val images =
            message.arr("imgItems").objects().ifEmpty {
                if (message.str("imgData").isNotBlank())
                    listOf(
                        json(
                            "data" to message.str("imgData"),
                            "mime" to message.str("imgMime", "image/png"),
                        )
                    )
                else emptyList()
            }
        if (images.isEmpty() && message.str("localPreview").isNotBlank())
            NativeProgressImage(message.str("localPreview"))
        if (images.size > 1)
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                IconButton(enabled = imageIndex > 0, onClick = { imageIndex-- }) {
                    Icon(Icons.Outlined.ChevronLeft, "上一张图片")
                }
                Text(
                    "${imageIndex+1} / ${images.size}",
                    style = MaterialTheme.typography.labelMedium,
                )
                IconButton(enabled = imageIndex < images.lastIndex, onClick = { imageIndex++ }) {
                    Icon(Icons.Outlined.ChevronRight, "下一张图片")
                }
            }
        images
            .withIndex()
            .filter { it.index == imageIndex.coerceIn(0, maxOf(images.lastIndex, 0)) }
            .forEach { (index, item) ->
                var bitmap by
                    remember(item.str("data").hashCode()) {
                        mutableStateOf<android.graphics.Bitmap?>(null)
                    }
                LaunchedEffect(item.str("data").hashCode()) {
                    vm.imageFile(message, index) { file, _ -> bitmap = vm.files.preview(file) }
                }
                bitmap?.let {
                    Image(
                        it.asImageBitmap(),
                        "生成图片 ${index+1}",
                        Modifier.fillMaxWidth()
                            .heightIn(max = 480.dp)
                            .padding(top = 10.dp)
                            .clip(MaterialTheme.shapes.medium)
                            .clickable {
                                vm.imageFile(message, index) { file, _ -> zoom = file.path }
                            },
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { vm.editImage(message, index) }) { Text("编辑这张") }
                    TextButton(
                        onClick = {
                            vm.imageFile(message, index) { file, mime ->
                                if (Build.VERSION.SDK_INT >= 29) vm.saveGallery(file, mime)
                                else
                                    vm.export(
                                        file,
                                        mime,
                                        "AI-" + System.currentTimeMillis() + "." + file.extension,
                                    )
                            }
                        }
                    ) {
                        Text("保存原图")
                    }
                    TextButton(
                        onClick = {
                            vm.imageFile(message, index) { file, mime ->
                                vm.files.share(file, mime)
                            }
                        }
                    ) {
                        Text("分享")
                    }
                }
            }
        message.arr("artifacts").objects().forEach { file ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Description, null)
                Text(
                    file.str("name"),
                    Modifier.weight(1f).padding(horizontal = 10.dp),
                    maxLines = 2,
                    style = MaterialTheme.typography.bodyMedium,
                )
                TextButton(
                    enabled = !file.optBoolean("deleted"),
                    onClick = {
                        vm.artifact(message, file) { output, mime -> vm.files.share(output, mime) }
                    },
                ) {
                    Text(if (file.optBoolean("deleted")) "已删除" else "打开")
                }
                TextButton(
                    enabled = !file.optBoolean("deleted"),
                    onClick = {
                        vm.artifact(message, file) { output, mime ->
                            vm.export(output, mime, file.str("name", output.name))
                        }
                    },
                ) {
                    Text("保存")
                }
                IconButton(
                    enabled = !file.optBoolean("deleted"),
                    onClick = { artifactDelete = file },
                ) {
                    Icon(Icons.Outlined.DeleteOutline, "删除生成文件")
                }
            }
        }
        message.arr("citations").objects().forEach { citation ->
            TextButton(
                onClick = {
                    runCatching {
                        val uri = Uri.parse(citation.str("url"))
                        if (uri.scheme in listOf("http", "https"))
                            context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                    }
                }
            ) {
                Icon(Icons.Outlined.Link, null, Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(citation.str("title", citation.str("url")), maxLines = 2)
            }
        }
        if (message.str("generationError").isNotBlank())
            Text(
                message.str("generationError"),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            IconButton(
                onClick = {
                    clipboard.setText(AnnotatedString(message.str("text")))
                    vm.notice("已复制")
                }
            ) {
                Icon(Icons.Outlined.ContentCopy, "复制", Modifier.size(18.dp))
            }
            IconButton(onClick = { vm.quote(message) }) {
                Icon(Icons.Outlined.FormatQuote, "引用", Modifier.size(18.dp))
            }
            IconButton(
                onClick = { if (message.optBoolean("isUser")) edit = true else vm.fork(message) }
            ) {
                Icon(
                    if (message.optBoolean("isUser")) Icons.Outlined.Edit
                    else Icons.Outlined.Refresh,
                    if (message.optBoolean("isUser")) "编辑并另开分支" else "重新回答，保留原回复",
                    Modifier.size(18.dp),
                )
            }
            if (!message.optBoolean("isUser")) {
                IconButton(
                    onClick = {
                        vm.messageFlag(
                            message.optLong("uid"),
                            "_liked",
                            !message.optBoolean("_liked"),
                        )
                    }
                ) {
                    Icon(
                        Icons.Outlined.ThumbUp,
                        "赞",
                        Modifier.size(18.dp),
                        tint =
                            if (message.optBoolean("_liked")) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = { comment = true }) {
                    Icon(Icons.Outlined.Comment, "备注", Modifier.size(18.dp))
                }
            }
        }
        if (message.str("_comment").isNotBlank())
            Text(
                "备注：" + message.str("_comment"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
    }
    zoom?.let { path -> NativeImageViewer(path) { zoom = null } }
    artifactDelete?.let { file ->
        AlertDialog(
            onDismissRequest = { artifactDelete = null },
            title = { Text("删除生成文件？") },
            text = { Text(file.str("name")) },
            confirmButton = {
                TextButton(
                    onClick = {
                        artifactDelete = null
                        vm.artifact(message, file, true)
                    }
                ) {
                    Text("删除")
                }
            },
            dismissButton = { TextButton(onClick = { artifactDelete = null }) { Text("取消") } },
        )
    }
    if (edit)
        TextEditorDialog(
            "修改后另开分支",
            message.str("topicText", message.str("text")),
            { edit = false },
        ) {
            vm.fork(message, it)
            edit = false
        }
    if (comment)
        TextEditorDialog("我的备注", message.str("_comment"), { comment = false }) {
            vm.messageFlag(message.optLong("uid"), "_comment", it)
            comment = false
        }
}

@Composable
fun Markdown(text: String) {
    val context = LocalContext.current
    val color = MaterialTheme.colorScheme.onSurface.toArgb()
    val markwon = remember {
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(context))
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(
                JLatexMathPlugin.create(16f * context.resources.displayMetrics.scaledDensity)
            )
            .build()
    }
    AndroidView(
        factory = {
            TextView(it).apply {
                textSize = 16f
                setTextIsSelectable(true)
                setLineSpacing(4f, 1.15f)
            }
        },
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        update = { view ->
            view.setTextColor(color)
            if (view.tag != text) {
                markwon.setMarkdown(view, text)
                view.tag = text
            }
        },
    )
}

fun effortLabel(value: String) =
    mapOf(
        "minimal" to "快速",
        "low" to "Low",
        "medium" to "Medium",
        "high" to "High",
        "xhigh" to "Extra high",
        "max" to "Max",
    )[value] ?: value

@Composable
fun TextEditorDialog(
    title: String,
    value: String,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    var text by rememberSaveable { mutableStateOf(value) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                text,
                { text = it },
                modifier = Modifier.fillMaxWidth().heightIn(min = 100.dp, max = 320.dp),
                minLines = 3,
                maxLines = 10,
            )
        },
        confirmButton = { TextButton(onClick = { onSave(text) }) { Text("保存") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
