@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.pickandcase.assistant

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.repeatOnLifecycle
import java.io.ByteArrayOutputStream
import java.text.DateFormat
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import org.json.JSONArray
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONObject

@Composable
fun NativePage(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp)
            .navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        content = content,
    )
}

@Composable
fun EmptyState(text: String) {
    Column(
        Modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Outlined.Forum,
            null,
            Modifier.size(38.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SettingRow(
    title: String,
    icon: ImageVector = Icons.Outlined.ChevronRight,
    subtitle: String = "",
    tag: String = "",
    onClick: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent =
            if (subtitle.isNotBlank()) {
                { Text(subtitle) }
            } else null,
        leadingContent = { Icon(icon, null) },
        trailingContent = {
            Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, Modifier.size(18.dp))
        },
        modifier = Modifier.clickable(onClick = onClick).testTag(tag),
    )
}

fun dateLabel(value: Any?): String =
    runCatching {
            val stamp =
                when (value) {
                    is Number -> value.toLong()
                    is String -> Instant.parse(value).toEpochMilli()
                    else -> 0L
                }
            if (stamp <= 0) ""
            else
                DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                    .format(java.util.Date(stamp))
        }
        .getOrDefault("")

@Composable
fun SettingsScreen(s: AssistantState, vm: AssistantViewModel, onLogout: () -> Unit) {
    val update by vm.updates.state.collectAsStateWithLifecycle()
    var licenses by remember { mutableStateOf(false) }
    val context = LocalContext.current
    if (licenses) {
        val notice = remember {
            listOf(
                    "open-source-notices.txt",
                    "licenses/Apache-2.0.txt",
                    "licenses/GPL-2.0.txt",
                    "licenses/JLaTeXMath-exception.txt",
                )
                .joinToString("\n\n") {
                    context.assets.open(it).bufferedReader().use { reader -> reader.readText() }
                }
        }
        AlertDialog(
            onDismissRequest = { licenses = false },
            title = { Text("开源许可") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text(notice, style = MaterialTheme.typography.bodySmall)
                }
            },
            confirmButton = { TextButton(onClick = { licenses = false }) { Text("关闭") } },
        )
    }
    NativePage {
        Text(
            s.session?.profile?.str("displayName", "我的账号").orEmpty(),
            style = MaterialTheme.typography.headlineMedium,
        )
        Text(
            s.session?.profile?.str("loginName").orEmpty(),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedCard {
            SettingRow("应用更新", Icons.Outlined.SystemUpdate, subtitle = if (update.release != null) "新版本 " + update.release!!.version else "当前版本 " + BuildConfig.VERSION_NAME, tag = "settings-update") { vm.updates.check() }
            SettingRow("账号设置", Icons.Outlined.Person, subtitle = "显示名、头像、登录名与密码") {
                vm.navigate(Page.ACCOUNT)
            }
            SettingRow("用量与账单", Icons.Outlined.ReceiptLong) { vm.navigate(Page.USAGE) }
        }
        OutlinedCard {
            SettingRow("Skills", Icons.Outlined.AutoAwesome) { vm.navigate(Page.SKILLS) }
            SettingRow(
                "聊天提示词",
                Icons.Outlined.Tune,
                subtitle = if (s.project == null) "用于普通聊天" else "仅用于当前项目",
            ) {
                vm.navigate(Page.PROMPT)
            }
            SettingRow(
                "记忆",
                Icons.Outlined.Memory,
                subtitle = if (s.project == null) "普通聊天记忆" else "当前项目的独立记忆",
            ) {
                vm.navigate(Page.MEMORY)
            }
        }
        ChoiceField("外观", s.theme, listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色")) {
            vm.theme(it)
        }
        OutlinedCard { SettingRow("开源许可", Icons.Outlined.Info) { licenses = true } }
        if (s.session?.canManage == true)
            OutlinedCard {
                SettingRow(
                    "管理",
                    Icons.Outlined.ManageAccounts,
                    subtitle = "为他人创建登录账号",
                    tag = "admin-menu",
                ) {
                    vm.navigate(Page.ADMIN)
                }
            }
        Text(
            "AI 助手 ${BuildConfig.VERSION_NAME}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun AccountScreen(s: AssistantState, vm: AssistantViewModel) {
    val profile = s.session?.profile ?: JSONObject()
    var display by rememberSaveable { mutableStateOf(profile.str("displayName")) }
    var login by rememberSaveable { mutableStateOf(profile.str("loginName")) }
    var password by rememberSaveable { mutableStateOf("") }
    var avatar by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            if (uri != null)
                runCatching {
                        context.contentResolver.openInputStream(uri)?.use {
                            BitmapFactory.decodeStream(it)
                        }
                    }
                    .onSuccess { original ->
                        if (original != null) {
                            val scale = minOf(1f, 256f / maxOf(original.width, original.height))
                            val resized =
                                Bitmap.createScaledBitmap(
                                    original,
                                    (original.width * scale).toInt(),
                                    (original.height * scale).toInt(),
                                    true,
                                )
                            val bytes =
                                ByteArrayOutputStream()
                                    .apply {
                                        resized.compress(Bitmap.CompressFormat.JPEG, 90, this)
                                    }
                                    .toByteArray()
                            avatar =
                                "data:image/jpeg;base64," +
                                    Base64.encodeToString(bytes, Base64.NO_WRAP)
                        }
                    }
                    .onFailure { vm.notice("头像读取失败，请重新选择") }
        }
    NativePage {
        OutlinedButton(onClick = { picker.launch("image/*") }) {
            Icon(Icons.Outlined.AddAPhoto, null)
            Spacer(Modifier.width(8.dp))
            Text(if (avatar == null) "更换头像" else "已选择新头像")
        }
        OutlinedTextField(
            display,
            { display = it },
            label = { Text("显示名") },
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            login,
            { login = it },
            label = { Text("登录名") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            password,
            { password = it },
            label = { Text("新密码（可选）") },
            supportingText = { Text("不修改密码时留空") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            enabled = !s.loading,
            onClick = {
                if (password.isNotEmpty() && password.length < 8) vm.notice("新密码至少 8 位")
                else vm.saveProfile(display, login, password, avatar)
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("保存账号设置")
        }
        Text(
            "修改显示名或登录名不会移动已有对话、项目和资料。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun AdminScreen(s: AssistantState, vm: AssistantViewModel) {
    if (s.session?.canManage != true) {
        EmptyState("此账号无管理权限")
        return
    }
    var deleting by remember { mutableStateOf<JSONObject?>(null) }
    if (deleting != null) {
        val target = deleting!!
        AlertDialog(onDismissRequest = { deleting = null }, title = { Text("删除账号 ${target.str("username")}？") }, text = { Text("该账号将无法再登录 App 和网页，已有登录也会立即失效。") }, confirmButton = { TextButton(onClick = { vm.deleteUser(target.str("accountId")); deleting = null }, modifier = Modifier.testTag("admin-delete-confirm")) { Text("确认删除", color = MaterialTheme.colorScheme.error) } }, dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } })
    }
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item { Text("创建账号", style = MaterialTheme.typography.titleLarge) }
        item {
            OutlinedTextField(
                username,
                { username = it },
                label = { Text("新账号") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("admin-username"),
            )
        }
        item {
            OutlinedTextField(
                password,
                { password = it },
                label = { Text("初始密码") },
                singleLine = true,
                visualTransformation =
                    if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { visible = !visible }) {
                        Icon(
                            if (visible) Icons.Outlined.VisibilityOff
                            else Icons.Outlined.Visibility,
                            "显示或隐藏密码",
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth().testTag("admin-password"),
            )
        }
        item {
            Button(
                enabled = !s.loading && username.isNotBlank() && password.isNotEmpty(),
                onClick = { vm.createUser(username, password) },
                modifier = Modifier.fillMaxWidth().testTag("admin-create"),
            ) {
                Text("创建账号")
            }
        }
        item {
            Text(
                "创建后，对方可使用该账号和密码登录 App 或网页。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            HorizontalDivider(Modifier.padding(vertical = 20.dp))
            Text("已有账号", style = MaterialTheme.typography.titleMedium)
        }
        items(s.data.arr("users").objects(), key = { it.str("accountId") }) { user ->
            ListItem(
                headlineContent = { Text(user.str("username")) },
                supportingContent = { Text(dateLabel(user.opt("createdAt"))) },
                trailingContent = {
                    if (user.str("accountId") == s.session.accountId)
                        Text(
                            "管理员",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    else TextButton(onClick = { deleting = user }, enabled = !s.loading, modifier = Modifier.testTag("admin-delete-" + user.str("accountId"))) { Text("删除", color = MaterialTheme.colorScheme.error) }
                },
            )
        }
        if (s.data.str("cursor").isNotBlank())
            item { TextButton(onClick = vm::moreAdmin) { Text("加载更多账号") } }
    }
}

@Composable
fun HistoryScreen(s: AssistantState, vm: AssistantViewModel) {
    var query by rememberSaveable { mutableStateOf("") }
    var group by rememberSaveable { mutableStateOf("") }
    var newGroup by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        OutlinedTextField(
            query,
            { query = it },
            placeholder = { Text("搜索对话") },
            leadingIcon = { Icon(Icons.Outlined.Search, null) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Row(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("分组", style = MaterialTheme.typography.labelMedium)
            Spacer(Modifier.width(8.dp))
            Box(Modifier.weight(1f)) {
                ChoiceField(
                    "",
                    group,
                    listOf("" to "全部对话") + s.groups.map { it.str("id") to it.str("name") },
                ) {
                    group = it
                }
            }
            IconButton(onClick = { newGroup = true }) {
                Icon(Icons.Outlined.CreateNewFolder, "新建分组")
            }
        }
        val rows =
            s.histories
                .filter {
                    it.str("title").contains(query, true) &&
                        (group.isEmpty() || it.str("groupId") == group)
                }
                .sortedWith(
                    compareByDescending<JSONObject> { it.optBoolean("pinned") }
                        .thenByDescending { it.optLong("updatedAt") }
                )
        if (rows.isEmpty()) EmptyState(if (query.isBlank()) "还没有对话" else "没有找到相关对话")
        LazyColumn(Modifier.weight(1f)) {
            items(rows, key = { it.str("id") }) { chat -> HistoryRow(chat, s, vm) }
        }
    }
    if (newGroup)
        TextEditorDialog("新建分组", "", { newGroup = false }) {
            vm.historyAction("create_group", "", json("name" to it))
            newGroup = false
        }
}

@Composable
private fun HistoryRow(chat: JSONObject, s: AssistantState, vm: AssistantViewModel) {
    var menu by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf(false) }
    var move by remember { mutableStateOf(false) }
    var grouping by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(chat.str("title", "新对话"), maxLines = 2) },
        supportingContent = { Text(dateLabel(chat.opt("updatedAt"))) },
        leadingContent = {
            Icon(
                if (chat.optBoolean("pinned")) Icons.Outlined.PushPin
                else
                    when (chat.str("mode")) {
                        "image" -> Icons.Outlined.Image
                        "debate" -> Icons.Outlined.Forum
                        else -> Icons.Outlined.ChatBubbleOutline
                    },
                null,
            )
        },
        trailingContent = {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreHoriz, "对话操作") }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(if (chat.optBoolean("pinned")) "取消置顶" else "置顶") },
                        onClick = {
                            menu = false
                            vm.historyAction(
                                "pin",
                                chat.str("id"),
                                json("pinned" to !chat.optBoolean("pinned")),
                            )
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("重命名") },
                        onClick = {
                            menu = false
                            rename = true
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("移至项目") },
                        onClick = {
                            menu = false
                            vm.loadProjects()
                            move = true
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("加入分组") },
                        onClick = {
                            menu = false
                            grouping = true
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("删除对话") },
                        onClick = {
                            menu = false
                            remove = true
                        },
                    )
                }
            }
        },
        modifier = Modifier.clickable { vm.openChat(chat.str("id"), chat.str("title")) },
    )
    if (rename)
        TextEditorDialog("重命名对话", chat.str("title"), { rename = false }) {
            vm.historyAction("rename", chat.str("id"), json("title" to it))
            rename = false
        }
    if (move)
        AlertDialog(
            onDismissRequest = { move = false },
            title = { Text("移至项目") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    TextButton(
                        onClick = {
                            vm.historyAction(
                                "move",
                                chat.str("id"),
                                json("targetProjectId" to null),
                            )
                            move = false
                        }
                    ) {
                        Text("普通聊天")
                    }
                    s.projects.forEach { project ->
                        TextButton(
                            onClick = {
                                vm.historyAction(
                                    "move",
                                    chat.str("id"),
                                    json("targetProjectId" to project.str("id")),
                                )
                                move = false
                            }
                        ) {
                            Text(project.str("name"))
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { move = false }) { Text("取消") } },
        )
    if (grouping)
        AlertDialog(
            onDismissRequest = { grouping = false },
            title = { Text("加入分组") },
            text = {
                Column {
                    s.groups.forEach { group ->
                        TextButton(
                            onClick = {
                                vm.historyAction(
                                    "group",
                                    chat.str("id"),
                                    json("groupId" to group.str("id")),
                                )
                                grouping = false
                            }
                        ) {
                            Text(group.str("name"))
                        }
                    }
                    TextButton(
                        onClick = {
                            vm.historyAction("group", chat.str("id"), json("groupId" to null))
                            grouping = false
                        }
                    ) {
                        Text("移出分组")
                    }
                }
            },
            confirmButton = { TextButton(onClick = { grouping = false }) { Text("取消") } },
        )
    if (remove)
        AlertDialog(
            onDismissRequest = { remove = false },
            title = { Text("删除这个对话？") },
            text = { Text("删除后将从历史记录中移除。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.historyAction("delete", chat.str("id"))
                        remove = false
                    }
                ) {
                    Text("删除")
                }
            },
            dismissButton = { TextButton(onClick = { remove = false }) { Text("取消") } },
        )
}

@Composable
fun ProjectsScreen(s: AssistantState, vm: AssistantViewModel) {
    var view by rememberSaveable { mutableStateOf("active") }
    var query by rememberSaveable { mutableStateOf("") }
    var create by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("项目", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
            Button(onClick = { create = true }) {
                Icon(Icons.Outlined.Add, null)
                Text("新建项目")
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("active" to "进行中", "archived" to "已归档", "deleted" to "回收站").forEach { (id, label)
                ->
                FilterChip(
                    selected = view == id,
                    onClick = {
                        view = id
                        vm.loadProjects(id == "archived", id == "deleted")
                    },
                    label = { Text(label) },
                )
            }
        }
        OutlinedTextField(
            query,
            { query = it },
            placeholder = { Text("搜索项目") },
            leadingIcon = { Icon(Icons.Outlined.Search, null) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        val projects =
            s.projects
                .filter { it.str("name").contains(query, true) }
                .sortedWith(
                    compareByDescending<JSONObject> { it.optBoolean("pinned") }
                        .thenByDescending { it.optLong("updatedAt") }
                )
        LazyColumn(Modifier.weight(1f)) {
            items(projects, key = { it.str("id") }) { project -> ProjectRow(project, view, vm) }
            if (projects.isEmpty()) item { EmptyState("这里还没有项目") }
        }
    }
    if (create)
        ProjectEditor(null, { create = false }) { name, instructions ->
            vm.service(
                "/projects",
                json("action" to "create", "name" to name, "instructions" to instructions),
            ) { data ->
                vm.openProject(data.obj("project"))
            }
            create = false
        }
}

@Composable
private fun ProjectRow(project: JSONObject, view: String, vm: AssistantViewModel) {
    var menu by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(project.str("name")) },
        supportingContent = { Text(project.str("instructions").take(90), maxLines = 2) },
        leadingContent = {
            Icon(
                if (project.optBoolean("pinned")) Icons.Outlined.PushPin
                else Icons.Outlined.FolderOpen,
                null,
            )
        },
        trailingContent = {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreHoriz, "项目操作") }
                DropdownMenu(menu, { menu = false }) {
                    if (view != "active")
                        DropdownMenuItem(
                            text = { Text("恢复项目") },
                            onClick = {
                                menu = false
                                vm.projectAction(
                                    if (view == "deleted") "restore" else "archive",
                                    project.str("id"),
                                    json("archived" to false),
                                )
                            },
                        )
                    if (view == "active") {
                        DropdownMenuItem(
                            text = { Text(if (project.optBoolean("pinned")) "取消置顶" else "置顶") },
                            onClick = {
                                menu = false
                                vm.projectAction(
                                    "pin",
                                    project.str("id"),
                                    json("pinned" to !project.optBoolean("pinned")),
                                )
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("项目设置") },
                            onClick = {
                                menu = false
                                edit = true
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("归档") },
                            onClick = {
                                menu = false
                                vm.projectAction("archive", project.str("id"))
                            },
                        )
                    }
                    if (view != "deleted")
                        DropdownMenuItem(
                            text = { Text("删除项目") },
                            onClick = {
                                menu = false
                                deleting = true
                            },
                        )
                }
            }
        },
        modifier = Modifier.clickable(enabled = view == "active") { vm.openProject(project) },
    )
    if (edit)
        ProjectEditor(project, { edit = false }) { name, instructions ->
            vm.projectAction(
                "update",
                project.str("id"),
                json("name" to name, "instructions" to instructions),
            )
            edit = false
        }
    if (deleting)
        AlertDialog(
            onDismissRequest = { deleting = false },
            title = { Text("将项目移入回收站？") },
            text = { Text("项目的对话和资料会保留，可在回收站恢复。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.projectAction("delete", project.str("id"))
                        deleting = false
                    }
                ) {
                    Text("移入回收站")
                }
            },
            dismissButton = { TextButton(onClick = { deleting = false }) { Text("取消") } },
        )
}

@Composable
private fun ProjectEditor(
    project: JSONObject?,
    onDismiss: () -> Unit,
    onSave: (String, String) -> Unit,
) {
    var name by rememberSaveable { mutableStateOf(project?.str("name").orEmpty()) }
    var instructions by rememberSaveable { mutableStateOf(project?.str("instructions").orEmpty()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (project == null) "新建项目" else "项目设置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("项目名称") })
                OutlinedTextField(
                    instructions,
                    { instructions = it },
                    label = { Text("项目说明与回复要求") },
                    minLines = 4,
                    maxLines = 8,
                )
            }
        },
        confirmButton = {
            TextButton(enabled = name.isNotBlank(), onClick = { onSave(name, instructions) }) {
                Text("保存")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
fun ProjectScreen(s: AssistantState, vm: AssistantViewModel) {
    val project = s.project ?: return
    var memory by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var removed by remember { mutableStateOf(false) }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            vm.importProjectFiles(uris)
        }
    var replacement by rememberSaveable { mutableStateOf("") }
    val updatePicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) vm.importProjectFiles(listOf(uri), replacement)
        }
    val folderPicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri != null) vm.importProjectFolder(uri)
        }
    NativePage {
        Text(project.str("name"), style = MaterialTheme.typography.headlineMedium)
        Text(
            project.str("instructions").ifBlank { "项目内的对话、记忆和资料独立保存。" },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        ChoiceField(
            "资料阅读方式",
            project.str("readingMode", "retrieve"),
            listOf("retrieve" to "按需检索", "full" to "整份阅读"),
        ) { mode ->
            vm.projectAction("update", project.str("id"), json("readingMode" to mode)) {
                vm.openProject(project)
            }
        }
        Text(
            if (project.str("readingMode", "retrieve") == "full")
                "每次提问逐段阅读全部资料。未完成会明确提示，不会把部分阅读当作全文。"
            else "根据问题检索相关片段，适合日常提问。",
            style = MaterialTheme.typography.bodySmall,
        )
        TextButton(onClick = { folderPicker.launch(null) }) {
            Icon(Icons.Outlined.CreateNewFolder, null)
            Spacer(Modifier.width(8.dp))
            Text("导入文件夹")
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { vm.newChat() }) {
                Icon(Icons.Outlined.Add, null)
                Text("新建对话")
            }
            OutlinedButton(onClick = { edit = true }) { Text("项目设置") }
            OutlinedButton(onClick = { vm.navigate(Page.TASKS) }) { Text("定时任务") }
        }
        Text("参考资料", style = MaterialTheme.typography.titleMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { picker.launch(arrayOf("*/*")) }) {
                Icon(Icons.Outlined.UploadFile, null)
                Text("上传资料或 ZIP")
            }
            TextButton(
                onClick = {
                    removed = true
                    vm.service(
                        "/projects",
                        json("action" to "removed_files", "projectId" to project.str("id")),
                    ) { data ->
                        vm.pageData(data)
                    }
                }
            ) {
                Text("已移除资料")
            }
        }
        project.arr("files").objects().forEach { file ->
            OutlinedCard {
                Column(Modifier.padding(14.dp)) {
                    Text(
                        listOf(file.str("folder"), file.str("relativePath", file.str("name")))
                            .filter { it.isNotBlank() }
                            .joinToString("/"),
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        "${file.optLong("characters")} 字 · ${file.optLong("size")/1024} KB",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    FlowRow {
                        TextButton(
                            onClick = {
                                vm.service(
                                    "/projects",
                                    json(
                                        "action" to "preview",
                                        "projectId" to project.str("id"),
                                        "fileId" to file.str("id"),
                                    ),
                                ) {
                                    preview =
                                        it.obj("file").copyJson().apply {
                                            if (it.has("segments"))
                                                put(
                                                    "text",
                                                    it.arr("segments").objects().joinToString(
                                                        "\n\n"
                                                    ) { segment ->
                                                        segment.str("location") +
                                                            "\n" +
                                                            segment.str("text")
                                                    },
                                                )
                                        }
                                }
                            }
                        ) {
                            Text("预览")
                        }
                        TextButton(onClick = { vm.downloadProjectFile(file) }) { Text("下载原文件") }
                        TextButton(
                            onClick = {
                                replacement = file.str("id")
                                updatePicker.launch(arrayOf("*/*"))
                            }
                        ) {
                            Text("更新")
                        }
                        TextButton(
                            onClick = {
                                vm.projectAction(
                                    "remove_file",
                                    project.str("id"),
                                    json("fileId" to file.str("id")),
                                ) {
                                    vm.openProject(project)
                                }
                            }
                        ) {
                            Text("移除")
                        }
                    }
                }
            }
        }
        Text("项目记忆", style = MaterialTheme.typography.titleMedium)
        Text(
            project.str("memory").ifBlank { "还没有项目记忆" },
            style = MaterialTheme.typography.bodyMedium,
        )
        TextButton(onClick = { memory = true }) { Text("编辑项目记忆") }
        Text("项目对话", style = MaterialTheme.typography.titleMedium)
        s.histories.take(30).forEach { chat ->
            ListItem(
                headlineContent = { Text(chat.str("title")) },
                supportingContent = { Text(dateLabel(chat.opt("updatedAt"))) },
                modifier = Modifier.clickable { vm.openChat(chat.str("id"), chat.str("title")) },
            )
        }
    }
    if (memory)
        TextEditorDialog("项目记忆", project.str("memory"), { memory = false }) {
            vm.projectAction("update", project.str("id"), json("memory" to it)) {
                vm.openProject(project)
            }
            memory = false
        }
    if (edit)
        ProjectEditor(project, { edit = false }) { name, instructions ->
            vm.projectAction(
                "update",
                project.str("id"),
                json("name" to name, "instructions" to instructions),
            ) {
                vm.openProject(project)
            }
            edit = false
        }
    if (preview != null)
        AlertDialog(
            onDismissRequest = { preview = null },
            title = { Text(preview!!.str("name", "资料预览")) },
            text = {
                Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState())) {
                    Markdown(preview!!.str("text"))
                }
            },
            confirmButton = { TextButton(onClick = { preview = null }) { Text("关闭") } },
        )
    if (removed)
        AlertDialog(
            onDismissRequest = { removed = false },
            title = { Text("已移除资料") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    s.data.arr("files").objects().forEach { file ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(file.str("name"), Modifier.weight(1f))
                            TextButton(
                                onClick = {
                                    vm.projectAction(
                                        "restore_file",
                                        project.str("id"),
                                        json("fileId" to file.str("id")),
                                    ) {
                                        vm.openProject(project)
                                    }
                                    removed = false
                                }
                            ) {
                                Text("恢复")
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { removed = false }) { Text("关闭") } },
        )
}

@Composable
fun TasksScreen(s: AssistantState, vm: AssistantViewModel) {
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current
    LaunchedEffect(Unit) {
        lifecycle.lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while (true) {
                kotlinx.coroutines.delay(2000)
                val tasks = vm.state.value.data.arr("tasks").objects()
                if (
                    tasks.any {
                        it.str("status") == "running" ||
                            (it.optBoolean("enabled") &&
                                it.optLong("nextRunAt") > 0 &&
                                it.optLong("nextRunAt") <= System.currentTimeMillis() + 5000)
                    }
                )
                    vm.refreshTasks()
            }
        }
    }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var create by remember { mutableStateOf(false) }
    var history by remember { mutableStateOf<JSONObject?>(null) }
    var historyRuns by remember { mutableStateOf(emptyList<JSONObject>()) }
    var historyNext by remember { mutableStateOf<String?>(null) }
    var historyError by remember { mutableStateOf("") }
    var historyEpoch by remember { mutableIntStateOf(0) }
    var historyLoading by remember { mutableStateOf(false) }
    var replay by remember { mutableStateOf<JSONObject?>(null) }
    var replayJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    DisposableEffect(Unit) { onDispose { replayJob?.cancel() } }
    fun loadHistory(task: JSONObject, after: String? = null) {
        historyLoading = true
        historyError = ""
        val epoch=historyEpoch
        vm.taskHistory(task, after) { result ->
            if (epoch!=historyEpoch || history?.str("id")!=task.str("id")) return@taskHistory
            historyLoading = false
            if (result != null) {
                historyRuns = (if (after == null) emptyList() else historyRuns) + result.arr("runs").objects()
                historyNext = result.str("next").ifBlank { null }
            } else historyError=vm.state.value.error.ifBlank { "读取执行记录失败，请重试" }
        }
    }
    var deleting by remember { mutableStateOf<JSONObject?>(null) }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("定时任务", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
                Button(onClick = { create = true }) {
                    Icon(Icons.Outlined.Add, null)
                    Text("新建")
                }
            }
        }
        items(s.data.arr("tasks").objects(), key = { it.str("id") }) { task ->
            val active=task.str("status")=="running"||task.optBoolean("queued")
            OutlinedCard(Modifier.testTag("task-card-"+task.str("id"))) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            task.str("name"),
                            Modifier.weight(1f),
                            fontWeight = FontWeight.SemiBold,
                        )
                        Switch(
                            task.optBoolean("enabled"),
                            { enabled -> vm.taskAction("toggle", task, json("enabled" to enabled)) },
                            enabled=!active,
                        )
                    }
                    Text(task.str("prompt"), maxLines = 3)
                    Text(
                        vm.modelName(task.str("model")) +
                            " · " +
                            task.obj("schedule").str("timeZone"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "下次执行：" + dateLabel(task.opt("nextRunAt")).ifBlank { "未计划" },
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (task.str("error").isNotBlank())
                        Text(
                            task.str("error"),
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    FlowRow {
                        TextButton(onClick = { editing = task },enabled=!active) { Text("编辑") }
                        TextButton(onClick = { vm.taskAction("run", task) },enabled=!active) { Text("立即执行") }
                        if (task.str("status") == "running") TextButton(onClick = { vm.taskAction("stop", task) }) { Text("停止本次执行") }
                        TextButton(onClick = { historyEpoch++; history = task; historyRuns = emptyList(); historyNext = null; loadHistory(task) }) { Text("执行记录") }
                        TextButton(onClick = { deleting = task },enabled=!active) { Text("删除") }
                    }
                }
            }
        }
        if (s.data.arr("tasks").length() == 0) item { EmptyState("创建任务，在指定时间自动处理问题。") }
    }
    if (deleting != null)
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除定时任务？") },
            text = { Text("删除后不再自动执行此任务。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.taskAction("delete", deleting!!)
                        deleting = null
                    }
                ) {
                    Text("删除")
                }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } },
        )
    if (create || editing != null)
        TaskEditor(
            editing,
            s,
            vm,
            {
                create = false
                editing = null
            },
        )
    if (history != null && replay == null)
        AlertDialog(
            onDismissRequest = { historyEpoch++;history = null },
            title = { Text("执行记录") },
            text = {
                Column(Modifier.heightIn(max=480.dp).verticalScroll(rememberScrollState())) {
                    historyRuns.forEach { run ->
                        TextButton(onClick = {
                            if (run.str("runId").isNotBlank() && !run.optBoolean("legacy")) {
                                replayJob?.cancel(); replay = JSONObject()
                                replayJob = vm.observeTaskRun(history!!,run) { replay = it }
                            } else { vm.openTaskChat(history!!,run.str("chatId")); history = null }
                        }) {
                            Column(Modifier.fillMaxWidth()) {
                                Text(dateLabel(run.opt("at")))
                                Text(taskStatus(run.str("status")), style=MaterialTheme.typography.bodySmall)
                                if (run.str("error").isNotBlank()) Text(run.str("error"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                    if (historyLoading) CircularProgressIndicator(Modifier.size(24.dp))
                    if (!historyLoading && historyRuns.isEmpty() && historyError.isBlank()) Text("还没有执行记录")
                    if (historyError.isNotBlank()) { Text(historyError,color=MaterialTheme.colorScheme.error);TextButton(onClick={loadHistory(history!!,if(historyRuns.isEmpty())null else historyNext)}){Text("重试")} }
                    if (historyNext != null) TextButton(onClick={loadHistory(history!!,historyNext)},enabled=!historyLoading) {Text("加载更早的记录")}
                }
            },
            confirmButton = { TextButton(onClick = { history = null }) { Text("关闭") } },
        )
    if (replay != null) {
        val clipboard=androidx.compose.ui.platform.LocalClipboardManager.current
        AlertDialog(
            onDismissRequest={replayJob?.cancel();replay=null},
            title={Text("任务执行日志")},
            text={Column(Modifier.heightIn(max=480.dp).verticalScroll(rememberScrollState())) {
                if(replay!!.length()==0) CircularProgressIndicator(Modifier.size(24.dp))
                else if(replay!!.has("error")) Text(replay!!.str("error"),color=MaterialTheme.colorScheme.error)
                else { Text(taskStatus(replay!!.str("status")),style=MaterialTheme.typography.labelMedium);Markdown(replay!!.obj("reply").str("text").ifBlank {"等待任务输出…"}) }
            }},
            confirmButton={TextButton(onClick={replayJob?.cancel();replay=null}){Text("关闭")}},
            dismissButton={TextButton(onClick={clipboard.setText(androidx.compose.ui.text.AnnotatedString(replay!!.obj("reply").str("text")));vm.notice("内容已复制")},enabled=replay!!.obj("reply").str("text").isNotBlank()){Text("复制内容")}}
        )
    }
}

private fun taskStatus(value:String)=when(value) {"running"->"执行中";"completed"->"已完成";"failed"->"执行失败";"cancelled","stopped"->"已停止";else->value}

@Composable
private fun TaskEditor(
    task: JSONObject?,
    s: AssistantState,
    vm: AssistantViewModel,
    onDismiss: () -> Unit,
) {
    var name by rememberSaveable { mutableStateOf(task?.str("name").orEmpty()) }
    var prompt by rememberSaveable { mutableStateOf(task?.str("prompt").orEmpty()) }
    var model by rememberSaveable { mutableStateOf(vm.clientContract.chat(task?.str("model") ?: s.model)) }
    var frequency by rememberSaveable {
        mutableStateOf(task?.obj("schedule")?.str("frequency") ?: "daily")
    }
    var zone by rememberSaveable {
        mutableStateOf(task?.obj("schedule")?.str("timeZone") ?: ZoneId.systemDefault().id)
    }
    val originalOnce =
        remember(task?.str("id")) {
            runCatching {
                    java.time.Instant.parse(task?.obj("schedule")?.str("at"))
                        .atZone(ZoneId.of(zone))
                }
                .getOrNull()
        }
    var time by rememberSaveable {
        mutableStateOf(
            originalOnce
                ?.toLocalTime()
                ?.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
                ?: task?.obj("schedule")?.str("time")?.ifBlank { null }
                ?: "09:00"
        )
    }
    var day by rememberSaveable { mutableStateOf(task?.obj("schedule")?.optInt("day", 1) ?: 1) }
    var date by rememberSaveable {
        mutableStateOf(
            originalOnce?.toLocalDate()?.toString() ?: LocalDate.now().plusDays(1).toString()
        )
    }
    var search by rememberSaveable { mutableStateOf(task?.optBoolean("search") ?: s.search) }
    val id = remember { task?.str("id") ?: UUID.randomUUID().toString() }
    var effort by rememberSaveable {
        mutableStateOf(vm.clientContract.effort(model, task?.str("effort")?.ifBlank { null } ?: vm.savedEffort(model)))
    }
    val context = LocalContext.current
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(20.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                if (task == null) "新建定时任务" else "编辑定时任务",
                style = MaterialTheme.typography.titleLarge,
            )
            OutlinedTextField(
                name,
                { name = it },
                label = { Text("任务名称") },
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                prompt,
                { prompt = it },
                label = { Text("任务指令") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                maxLines = 7,
            )
            ChoiceField(
                "模型",
                model,
                s.catalog
                    .arr("models")
                    .objects()
                    .filterNot { it.optBoolean("image") }
                    .map { it.str("id") to it.str("name") },
            ) {
                model = it
            }
            val levels =
                s.catalog
                    .arr("models")
                    .objects()
                    .find { it.str("id") == model }
                    ?.arr("levels")
                    ?.strings()
                    .orEmpty()
            if (levels.isNotEmpty())
                OrderedSlider(
                    "思考深度",
                    levels.map { it to effortLabel(it) },
                    effort.takeIf { it in levels } ?: levels.first(),
                ) {
                    effort = it
                }
            ChoiceField(
                "重复",
                frequency,
                listOf("once" to "仅一次", "daily" to "每天", "weekdays" to "工作日", "weekly" to "每周"),
            ) {
                frequency = it
            }
            if (frequency == "once")
                OutlinedButton(
                    onClick = {
                        val d = LocalDate.parse(date)
                        DatePickerDialog(
                                context,
                                { _, y, m, dayValue ->
                                    date = LocalDate.of(y, m + 1, dayValue).toString()
                                },
                                d.year,
                                d.monthValue - 1,
                                d.dayOfMonth,
                            )
                            .show()
                    }
                ) {
                    Text("执行日期：$date")
                }
            if (frequency == "weekly")
                ChoiceField(
                    "每周",
                    day.toString(),
                    listOf(
                        "1" to "星期一",
                        "2" to "星期二",
                        "3" to "星期三",
                        "4" to "星期四",
                        "5" to "星期五",
                        "6" to "星期六",
                        "0" to "星期日",
                    ),
                ) {
                    day = it.toInt()
                }
            OutlinedButton(
                onClick = {
                    val t = LocalTime.parse(time)
                    TimePickerDialog(
                            context,
                            { _, h, m -> time = "%02d:%02d".format(h, m) },
                            t.hour,
                            t.minute,
                            true,
                        )
                        .show()
                }
            ) {
                Text("执行时间：$time")
            }
            OutlinedTextField(
                zone,
                { zone = it },
                label = { Text("时区") },
                supportingText = { Text("例如 Asia/Shanghai") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("联网搜索", Modifier.weight(1f))
                Switch(search, { search = it })
            }
            Button(
                enabled = name.isNotBlank() && prompt.isNotBlank() && !s.loading,
                onClick = {
                    runCatching {
                            val schedule =
                                json("frequency" to frequency, "timeZone" to zone, "time" to time)
                            if (frequency == "weekly") schedule.put("day", day)
                            if (frequency == "once")
                                schedule.put(
                                    "at",
                                    LocalDateTime.of(LocalDate.parse(date), LocalTime.parse(time))
                                        .atZone(ZoneId.of(zone))
                                        .toInstant()
                                        .toString(),
                                )
                            vm.service(
                                "/schedules",
                                json(
                                    "action" to if (task == null) "create" else "update",
                                    "id" to id,
                                    "name" to name,
                                    "prompt" to prompt,
                                    "model" to model,
                                    "effort" to effort.takeIf { it in levels },
                                    "schedule" to schedule,
                                    "search" to search,
                                    "enabled" to true,
                                ),
                            ) {
                                vm.navigate(Page.TASKS)
                            }
                            onDismiss()
                        }
                        .onFailure { vm.notice("请检查执行时间和时区") }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("保存任务")
            }
        }
    }
}

@Composable
fun SkillsScreen(s: AssistantState, vm: AssistantViewModel) {
    val settings = s.skills
    val selected = settings.arr("ids").strings()
    NativePage {
        ChoiceField(
            "技能调用",
            settings.str("mode", "auto"),
            listOf("auto" to "自动选择", "manual" to "手动选择", "off" to "关闭"),
        ) {
            vm.skillConfig(settings.copyJson().put("mode", it))
        }
        Text(
            "技能会帮助完成资料研究、文件生成、分析和写作。手动模式最多选择 3 项。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (settings.str("mode") == "manual")
            s.catalog.arr("skills").objects().forEach { skill ->
                OutlinedCard(
                    Modifier.fillMaxWidth().clickable {
                        val id = skill.str("id")
                        val next = if (id in selected) selected - id else (selected + id).take(3)
                        vm.skillConfig(settings.copyJson().put("ids", JSONArray(next)))
                    }
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            skill.str("id") in selected,
                            { checked ->
                                val id = skill.str("id")
                                if (!checked || selected.size < 3)
                                    vm.skillConfig(
                                        settings
                                            .copyJson()
                                            .put(
                                                "ids",
                                                JSONArray(
                                                    if (checked) selected + id else selected - id
                                                ),
                                            )
                                    )
                            },
                        )
                        Column(Modifier.weight(1f)) {
                            Text(skill.str("name"), fontWeight = FontWeight.Medium)
                            Text(
                                skill.str("description"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
    }
}

@Composable
fun PromptScreen(s: AssistantState, vm: AssistantViewModel) {
    var text by remember(s.data.str("prompt")) { mutableStateOf(s.data.str("prompt")) }
    NativePage {
        Text(
            if (s.project == null) "普通聊天提示词" else "当前项目提示词",
            style = MaterialTheme.typography.titleLarge,
        )
        OutlinedTextField(
            text,
            { text = it },
            modifier = Modifier.fillMaxWidth().heightIn(min = 220.dp),
            minLines = 9,
            maxLines = 18,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = {
                    vm.service("/system-prompt", json("action" to "save", "prompt" to text)) {
                        vm.pageData(it)
                        vm.notice("提示词已保存")
                    }
                }
            ) {
                Text("保存")
            }
            OutlinedButton(
                onClick = {
                    vm.service("/system-prompt", json("action" to "reset")) { vm.pageData(it) }
                }
            ) {
                Text("恢复默认")
            }
        }
    }
}

@Composable
fun MemoryScreen(s: AssistantState, vm: AssistantViewModel) {
    NativePage {
        Text(
            if (s.project == null) "普通聊天记忆" else "项目记忆",
            style = MaterialTheme.typography.titleLarge,
        )
        Text(
            "不同项目的记忆相互隔离。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Markdown(s.data.str("memory").ifBlank { "还没有积累记忆。" })
        OutlinedButton(onClick = { vm.navigate(Page.MEMORY) }) {
            Icon(Icons.Outlined.Refresh, null)
            Text("刷新记忆")
        }
    }
}

@Composable
fun UsageScreen(s: AssistantState, vm: AssistantViewModel) {
    var all by remember { mutableStateOf(false) }
    var receipt by remember { mutableStateOf<JSONObject?>(null) }
    val total = s.data.obj("total")
    NativePage {
        if (s.session?.canManage == true)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("所有账号的累计用量", Modifier.weight(1f))
                Switch(
                    all,
                    {
                        all = it
                        vm.loadUsage(it)
                    },
                )
            }
        Text("已核算费用", style = MaterialTheme.typography.titleMedium)
        Text(
            if (total.has("knownCostUsd")) "$" + total.str("knownCostUsd") else "暂未提供",
            style = MaterialTheme.typography.headlineLarge,
        )
        Text(
            "输入 ${total.optLong("input")} · 输出 ${total.optLong("output")} token",
            style = MaterialTheme.typography.bodyMedium,
        )
        if (total.optInt("unsettled") > 0)
            Text(
                "${total.optInt("unsettled")} 次请求含待结算项目，未知部分未计成 0。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        Text("按模型统计", style = MaterialTheme.typography.titleMedium)
        val models = s.data.obj("models")
        models.keys().forEach { key ->
            val row = models.obj(key)
            ListItem(
                headlineContent = { Text(vm.modelName(key)) },
                supportingContent = {
                    Text(
                        "${row.optLong("calls")} 次 · 输入 ${row.optLong("input")} / 输出 ${row.optLong("output")}"
                    )
                },
                trailingContent = { Text("$" + row.str("knownCostUsd", "待核实")) },
            )
        }
        Text("最近请求", style = MaterialTheme.typography.titleMedium)
        s.data.arr("receipts").objects().forEach { item ->
            ListItem(
                headlineContent = { Text(vm.modelName(item.str("model"))) },
                supportingContent = { Text(dateLabel(item.opt("at"))) },
                trailingContent = { Icon(Icons.Outlined.ChevronRight, null) },
                modifier =
                    Modifier.clickable {
                        vm.service("/usage", json("action" to "receipt", "id" to item.str("id"))) {
                            receipt = it.optJSONObject("receipt") ?: it
                        }
                    },
            )
        }
        Text(
            s.data.str("historicalNote", "金额以官方用量明细及账单为准；旧版记录未并入新版统计。"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = { vm.loadUsage(all) }) { Text("刷新用量") }
    }
    if (receipt != null) NativeUsageReceipt(receipt!!) { receipt = null }
}
