package com.pickandcase.assistant

import android.app.Application
import android.net.Uri
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

enum class Page {
    CHAT,
    HISTORY,
    PROJECTS,
    PROJECT,
    TASKS,
    SETTINGS,
    ACCOUNT,
    USAGE,
    ADMIN,
    SKILLS,
    PROMPT,
    MEMORY,
}

data class AssistantState(
    val session: SavedSession? = null,
    val page: Page = Page.CHAT,
    val catalog: JSONObject = JSONObject(),
    val project: JSONObject? = null,
    val chatId: String = UUID.randomUUID().toString(),
    val title: String = "新对话",
    val messages: List<JSONObject> = emptyList(),
    val histories: List<JSONObject> = emptyList(),
    val groups: List<JSONObject> = emptyList(),
    val projects: List<JSONObject> = emptyList(),
    val data: JSONObject = JSONObject(),
    val draft: String = "",
    val mode: String = "chat",
    val model: String = "gpt-6.1-sol",
    val effort: String = "low",
    val imageModel: String = "gpt-image-2.5-sunburst",
    val imageTask: String = "generation",
    val imageSettings: JSONObject =
        json(
            "quality" to "auto",
            "format" to "png",
            "size" to "auto",
            "compression" to 100,
            "count" to 1,
            "partial" to 2,
        ),
    val debate: JSONObject =
        json(
            "mode" to "free",
            "rounds" to 1,
            "objective" to "explore",
            "detail" to "balanced",
            "members" to
                JSONArray(
                    listOf(
                        json(
                            "id" to "seat-1",
                            "model" to "gpt-6.1-sol",
                            "effort" to "low",
                            "label" to "席位 1",
                        ),
                        json(
                            "id" to "seat-2",
                            "model" to "gpt-6.1-sol",
                            "effort" to "low",
                            "label" to "席位 2",
                        ),
                    )
                ),
        ),
    val skills: JSONObject = json("mode" to "auto", "ids" to JSONArray()),
    val attachments: List<NativeAttachment> = emptyList(),
    val quote: JSONObject? = null,
    val imageParent: Long? = null,
    val imageMask: NativeAttachment? = null,
    val search: Boolean = false,
    val incognito: Boolean = false,
    val busy: Boolean = false,
    val loading: Boolean = false,
    val error: String = "",
    val notice: String = "",
    val connection: String = "",
    val run: JSONObject? = null,
    val theme: String = "system",
)

class AssistantViewModel(application: Application, val api: NativeApi = NativeApi()) :
    AndroidViewModel(application) {
    val files = NativeFiles(application)
    private val sessions = NativeSession(application)
    private val cache = NativeCache(application)
    private val preferences = application.getSharedPreferences("native_preferences_v2", 0)
    private val mutable =
        MutableStateFlow(
            AssistantState(theme = preferences.getString("theme", "system") ?: "system")
        )
    val state = mutable.asStateFlow()
    private val pendingExport = MutableStateFlow<NativeExport?>(null)
    val exports = pendingExport.asStateFlow()

    fun export(file: File, mime: String, name: String = file.name) {
        pendingExport.value = NativeExport(file.path, mime, name, account())
    }

    fun exportHandled() {
        pendingExport.value = null
    }

    fun saveGallery(file: File, mime: String) {
        viewModelScope.launch {
            runCatching { withContext(Dispatchers.IO) { files.saveGallery(file, mime) } }
                .onSuccess { notice("原图已保存到相册") }
                .onFailure { error(it) }
        }
    }

    fun imageMask(reference: NativeAttachment, mask: NativeAttachment) {
        mutable.update {
            it.copy(
                attachments = listOf(reference),
                imageMask = mask,
                imageTask = "edit",
                imageParent = null,
            )
        }
    }

    private var observer: Job? = null
    private var pageEpoch = 0
    private var activeRun: JSONObject? = null

    private fun scope(s: AssistantState = mutable.value) = s.project?.str("id") ?: "general"

    private fun account() = mutable.value.session?.accountId.orEmpty()

    private fun projectPayload(s: AssistantState = mutable.value) =
        json("projectId" to s.project?.str("id"))

    private fun error(error: Throwable) {
        if (error is CancellationException) throw error
        mutable.update { it.copy(error = error.message ?: "操作未完成，请重试", loading = false) }
    }

    fun dismissError() {
        mutable.update { it.copy(error = "", notice = "") }
    }

    fun notice(value: String) {
        mutable.update { it.copy(notice = value) }
    }

    init {
        runCatching { sessions.load() }
            .onSuccess { saved ->
                if (saved != null) {
                    api.token = saved.token
                    mutable.update { it.copy(session = saved) }
                    restorePreferences()
                    restoreLastView()
                    refreshSession()
                }
            }
            .onFailure { error(it) }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                sessions.revocations().forEach { (key, token) ->
                    runCatching {
                        api.route("logout", JSONObject(), token)
                        sessions.revoked(key)
                    }
                }
            }
        }
    }

    fun login(username: String, password: String) {
        if (mutable.value.loading) return
        if (username.isBlank() || password.isEmpty()) {
            notice("请输入账号和密码")
            return
        }
        viewModelScope.launch {
            mutable.update { it.copy(loading = true, error = "") }
            try {
                val result =
                    api.route(
                        "login",
                        json("username" to username.trim(), "passwordHash" to sha256(password)),
                        null,
                    )
                val saved =
                    SavedSession(
                        result.getString("token"),
                        result.getJSONObject("profile"),
                        result.optBoolean("canManage"),
                    )
                withContext(Dispatchers.IO) { sessions.save(saved) }
                api.token = saved.token
                mutable.update { it.copy(session = saved, loading = false) }
                restorePreferences()
                refreshSession()
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            try {
                val id = account()
                val logoutJob = currentCoroutineContext()[Job]
                viewModelScope.coroutineContext[Job]
                    ?.children
                    ?.filter { it !== logoutJob }
                    ?.toList()
                    ?.forEach { it.cancel() }
                observer?.cancel()
                withContext(Dispatchers.IO) {
                    sessions.logout()
                    cache.clearAccount(id)
                }
                api.token = null
                activeRun = null
                mutable.value = AssistantState(theme = mutable.value.theme)
                withContext(Dispatchers.IO) {
                    sessions.revocations().forEach { (key, token) ->
                        runCatching {
                            api.route("logout", JSONObject(), token)
                            sessions.revoked(key)
                        }
                    }
                }
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    private fun restorePreferences() {
        val saved =
            runCatching { JSONObject(preferences.getString("settings:" + account(), "{}") ?: "{}") }
                .getOrDefault(JSONObject())
        mutable.update {
            it.copy(
                model = saved.str("model", "gpt-6.1-sol"),
                effort = saved.str("effort", "low"),
                imageModel = saved.str("imageModel", "gpt-image-2.5-sunburst"),
                skills = saved.optJSONObject("skills") ?: it.skills,
                debate =
                    (saved.optJSONObject("debate") ?: it.debate).copyJson().apply {
                        remove("priorRunId")
                    },
                imageSettings = saved.optJSONObject("imageSettings") ?: it.imageSettings,
            )
        }
        runCatching { cache.get(account(), "general", "catalog") }
            .getOrNull()
            ?.let { value -> mutable.update { it.copy(catalog = value) } }
    }

    private fun restoreLastView() {
        runCatching { JSONObject(preferences.getString("last-view:" + account(), "{}") ?: "{}") }
            .getOrNull()
            ?.let { last ->
                if (last.str("chatId").isNotBlank())
                    openChat(
                        last.str("chatId"),
                        last.str("title", "对话"),
                        last.optJSONObject("project"),
                    )
            }
    }

    private fun rememberView() {
        val s = mutable.value
        if (!s.incognito)
            preferences
                .edit()
                .putString(
                    "last-view:" + account(),
                    json(
                            "chatId" to s.chatId,
                            "title" to if (s.messages.isEmpty()) s.draft.take(50) else s.title,
                            "project" to s.project,
                        )
                        .toString(),
                )
                .apply()
    }

    private fun savePreferences() {
        val s = mutable.value
        preferences
            .edit()
            .putString(
                "settings:" + account(),
                json(
                        "model" to s.model,
                        "effort" to s.effort,
                        "imageModel" to s.imageModel,
                        "skills" to s.skills,
                        "debate" to s.debate,
                        "imageSettings" to s.imageSettings,
                    )
                    .toString(),
            )
            .apply()
    }

    fun refreshSession() {
        val old = mutable.value.session ?: return
        viewModelScope.launch {
            try {
                val result = api.route("catalog")
                if (mutable.value.session?.token != old.token) return@launch
                val saved =
                    SavedSession(old.token, result.obj("profile"), result.optBoolean("canManage"))
                withContext(Dispatchers.IO) {
                    sessions.save(saved)
                    cache.put(saved.accountId, "general", "catalog", result)
                }
                mutable.update {
                    it.copy(session = saved, catalog = result, connection = "已连接", error = "")
                }
                loadHistory()
            } catch (e: Exception) {
                mutable.update { it.copy(connection = "暂时离线，已保留登录") }
                error(e)
            }
        }
    }

    fun navigate(page: Page) {
        pageEpoch++
        mutable.update { it.copy(page = page, data = JSONObject(), error = "") }
        when (page) {
            Page.HISTORY -> loadHistory()
            Page.PROJECTS -> loadProjects()
            Page.TASKS -> loadData(Page.TASKS, "/schedules", json("action" to "list"))
            Page.USAGE -> loadUsage()
            Page.MEMORY -> loadData(Page.MEMORY, "/memory", json("action" to "get"))
            Page.PROMPT -> loadData(Page.PROMPT, "/system-prompt", json("action" to "get"))
            Page.ADMIN -> loadAdmin()
            else -> Unit
        }
    }

    fun draft(value: String) {
        mutable.update { it.copy(draft = value) }
        if (!mutable.value.incognito)
            preferences.edit().putString("draft:" + account() + ":" + scope(), value).apply()
    }

    fun mode(value: String) {
        if (mutable.value.busy) {
            notice("请先停止当前任务，再切换模式")
            return
        }
        mutable.update { it.copy(mode = value, page = Page.CHAT) }
    }

    fun model(id: String, effort: String) {
        mutable.update { it.copy(model = id, effort = effort) }
        preferences.edit().putString("effort:" + account() + ":" + id, effort).apply()
        savePreferences()
    }

    fun savedEffort(id: String) =
        preferences.getString("effort:" + account() + ":" + id, "low") ?: "low"

    fun search(value: Boolean) {
        mutable.update { it.copy(search = value) }
    }

    fun incognito(value: Boolean) {
        newChat()
        mutable.update { it.copy(incognito = value) }
    }

    fun theme(value: String) {
        preferences.edit().putString("theme", value).apply()
        mutable.update { it.copy(theme = value) }
    }

    fun imageConfig(model: String, task: String, settings: JSONObject) {
        mutable.update {
            it.copy(imageModel = model, imageTask = task, imageSettings = settings.copyJson())
        }
        preferences
            .edit()
            .putString("image:" + account() + ":" + model, settings.toString())
            .apply()
        savePreferences()
    }

    fun selectImageModel(id: String) {
        val settings =
            runCatching {
                    JSONObject(preferences.getString("image:" + account() + ":" + id, "{}") ?: "{}")
                }
                .getOrDefault(JSONObject())
        imageConfig(id, mutable.value.imageTask, settings)
    }

    fun debateConfig(value: JSONObject) {
        mutable.update { it.copy(debate = value.copyJson()) }
        savePreferences()
    }

    fun skillConfig(value: JSONObject) {
        val catalog = mutable.value.catalog
        val restricted =
            value.str("mode") == "manual" &&
                value.arr("ids").strings().any { id ->
                    catalog.arr("skills").objects().any {
                        it.str("id") == id &&
                            (it.optBoolean("official") || it.str("kind") == "compute")
                    }
                }
        mutable.update { it.copy(skills = value.copyJson()) }
        if (restricted && !catalog.obj("skillModels").has(mutable.value.model)) {
            val target = catalog.str("defaultSkillModel", "claude-sonnet-5-5")
            model(target, savedEffort(target))
            notice("所选 Skill 需要 Claude，已切换到兼容模型")
        }
        savePreferences()
    }

    fun quote(message: JSONObject) {
        mutable.update {
            it.copy(
                quote =
                    json("author" to message.str("name"), "text" to message.str("text").take(6000)),
                page = Page.CHAT,
            )
        }
    }

    fun clearQuote() {
        mutable.update { it.copy(quote = null) }
    }

    fun newChat() {
        preferences.edit().remove("last-view:" + account()).apply()
        observer?.cancel()
        activeRun = null
        mutable.update {
            it.copy(
                page = Page.CHAT,
                chatId = UUID.randomUUID().toString(),
                title = "新对话",
                messages = emptyList(),
                draft = "",
                attachments = emptyList(),
                quote = null,
                imageParent = null,
                imageMask = null,
                imageTask = "generation",
                run = null,
                busy = false,
                error = "",
                debate = it.debate.copyJson().apply { remove("priorRunId") },
            )
        }
    }

    fun addFiles(uris: List<Uri>) {
        viewModelScope.launch {
            mutable.update { it.copy(loading = true) }
            try {
                val entries = withContext(Dispatchers.IO) { uris.flatMap(files::import) }
                mutable.update {
                    it.copy(
                        attachments = it.attachments + entries,
                        loading = false,
                        imageMask = if (entries.any { file -> file.image }) null else it.imageMask,
                    )
                }
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    fun removeAttachment(id: String) {
        mutable.update {
            it.copy(
                attachments = it.attachments.filterNot { file -> file.id == id },
                imageMask = null,
            )
        }
    }

    fun loadHistory() {
        val s = mutable.value
        viewModelScope.launch {
            try {
                val data = api.call("/chats", projectPayload(s).put("action", "list"))
                val groups = api.call("/chats", projectPayload(s).put("action", "groups"))
                if (account() == s.session?.accountId && scope() == scope(s)) {
                    mutable.update {
                        it.copy(
                            histories = data.arr("chats").objects(),
                            groups = groups.arr("groups").objects(),
                        )
                    }
                    withContext(Dispatchers.IO) {
                        cache.put(s.session?.accountId.orEmpty(), scope(s), "histories", data)
                    }
                }
            } catch (e: Exception) {
                runCatching { cache.get(s.session?.accountId.orEmpty(), scope(s), "histories") }
                    .getOrNull()
                    ?.let { data ->
                        if (scope() == scope(s))
                            mutable.update { it.copy(histories = data.arr("chats").objects()) }
                    }
                error(e)
            }
        }
    }

    fun openChat(id: String, title: String = "对话", project: JSONObject? = mutable.value.project) {
        observer?.cancel()
        preferences
            .edit()
            .putString(
                "last-view:" + account(),
                json("chatId" to id, "title" to title, "project" to project).toString(),
            )
            .apply()
        activeRun = null
        pageEpoch++
        val epoch = pageEpoch
        mutable.update {
            it.copy(
                page = Page.CHAT,
                incognito = false,
                project = project,
                chatId = id,
                title = title,
                messages = emptyList(),
                loading = true,
                draft = "",
                attachments = emptyList(),
                run = null,
                busy = false,
                quote = null,
                imageParent = null,
                imageMask = null,
                imageTask = "generation",
            )
        }
        val s = mutable.value
        viewModelScope.launch {
            try {
                val data =
                    api.call("/chats", projectPayload(s).put("action", "load").put("chatId", id))
                if (epoch != pageEpoch) return@launch
                val messages = normalizeMessages(data.arr("messages").objects(), id)
                mutable.update {
                    it.copy(messages = messages, loading = false, mode = inferMode(messages))
                }
                withContext(Dispatchers.IO) {
                    cache.put(s.session?.accountId.orEmpty(), scope(s), id, data)
                }
                resumeMessages(messages)
            } catch (e: Exception) {
                if (epoch == pageEpoch) {
                    cache.get(s.session?.accountId.orEmpty(), scope(s), id)?.let { data ->
                        mutable.update {
                            it.copy(
                                messages = normalizeMessages(data.arr("messages").objects(), id)
                            )
                        }
                    }
                    error(e)
                }
            }
        }
    }

    private fun normalizeMessages(
        messages: List<JSONObject>,
        chatId: String,
        local: Boolean = false,
    ): List<JSONObject> {
        val used = mutableSetOf<Long>()
        return messages.mapIndexed { index, message ->
            val out = message.copyJson()
            if (!local) {
                out.remove("localPreview")
                out.arr("imgItems").objects().forEach { it.remove("localPath") }
            }
            var uid = out.optLong("uid")
            if (uid <= 0 || !used.add(uid)) {
                uid = sha256(chatId + ":" + index).take(13).toLong(16) + 1
                while (!used.add(uid)) uid++
                out.put("uid", uid)
            }
            out
        }
    }

    private fun inferMode(messages: List<JSONObject>): String =
        messages.lastOrNull()?.str("chatMode")?.ifBlank { null }
            ?: if (messages.any { it.has("debateRun") }) "debate"
            else if (messages.any { it.arr("imgItems").length() > 0 || it.has("imgData") }) "image"
            else "chat"

    fun historyAction(action: String, id: String, extra: JSONObject = JSONObject()) {
        service("/chats", extra.put("action", action).put("chatId", id)) { loadHistory() }
    }

    fun service(path: String, payload: JSONObject, onDone: (JSONObject) -> Unit = {}) {
        val s = mutable.value
        viewModelScope.launch {
            try {
                if (!payload.has("projectId"))
                    payload.put("projectId", s.project?.str("id") ?: JSONObject.NULL)
                val data = api.call(path, payload)
                if (mutable.value.session?.token == s.session?.token) onDone(data)
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    fun loadData(page: Page, path: String, payload: JSONObject) {
        val epoch = pageEpoch
        mutable.update { it.copy(loading = true) }
        service(path, payload) { data ->
            if (pageEpoch == epoch && mutable.value.page == page)
                mutable.update { it.copy(data = data, loading = false) }
        }
    }

    fun loadProjects(archived: Boolean = false, deleted: Boolean = false) {
        service(
            "/projects",
            json("action" to "list", "includeArchived" to archived, "includeDeleted" to deleted),
        ) { data ->
            mutable.update {
                it.copy(projects = data.arr("projects").objects(), data = data, loading = false)
            }
        }
    }

    fun openProject(project: JSONObject) {
        val id = project.str("id")
        val epoch = ++pageEpoch
        service("/projects", json("action" to "get", "projectId" to id)) { data ->
            if (epoch != pageEpoch) return@service
            observer?.cancel()
            activeRun = null
            mutable.update {
                it.copy(
                    project = data.obj("project"),
                    page = Page.PROJECT,
                    data = data,
                    messages = emptyList(),
                    busy = false,
                    run = null,
                )
            }
            loadHistory()
        }
    }

    fun general() {
        observer?.cancel()
        mutable.update { it.copy(project = null) }
        newChat()
        loadHistory()
    }

    fun projectAction(
        action: String,
        projectId: String,
        extra: JSONObject = JSONObject(),
        onDone: (JSONObject) -> Unit = { loadProjects() },
    ) {
        service("/projects", extra.put("action", action).put("projectId", projectId), onDone)
    }

    fun uploadProject(attachments: List<NativeAttachment>) {
        val p = mutable.value.project ?: return
        viewModelScope.launch {
            try {
                for (file in attachments) {
                    require(file.text.isNotBlank()) { "${file.name} 没有可提取的文字，请作为对话附件使用" }
                    val entry =
                        json(
                            "name" to file.name,
                            "text" to file.text,
                            "size" to file.size,
                            "type" to file.mime,
                            "data" to Base64.encodeToString(file.bytes(), Base64.NO_WRAP),
                        )
                    if (file.relativePath.contains('/'))
                        entry
                            .put("folder", file.relativePath.substringBefore('/'))
                            .put("relativePath", file.relativePath.substringAfter('/'))
                    api.call(
                        "/projects",
                        json("action" to "upload", "projectId" to p.str("id"), "file" to entry),
                    )
                }
                openProject(p)
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    fun importProjectFiles(uris: List<Uri>) {
        viewModelScope.launch {
            try {
                mutable.update { it.copy(loading = true) }
                val imported = withContext(Dispatchers.IO) { uris.flatMap(files::import) }
                uploadProject(imported)
                mutable.update { it.copy(loading = false) }
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    fun pageData(data: JSONObject) {
        mutable.update { it.copy(data = data) }
    }

    fun downloadProjectFile(file: JSONObject) {
        service("/projects", json("action" to "download", "fileId" to file.str("id"))) { response ->
            val source = response.obj("file")
            val name = source.str("name", file.str("name", "document"))
            val target =
                File(
                    getApplication<Application>().filesDir,
                    "attachments/" +
                        UUID.randomUUID().toString() +
                        "-" +
                        name.replace(Regex("[^\\p{L}\\p{N}._-]"), "_"),
                )
            target.parentFile?.mkdirs()
            target.writeBytes(Base64.decode(source.str("data"), Base64.DEFAULT))
            export(target, source.str("type", "application/octet-stream"), name)
        }
    }

    fun taskAction(action: String, task: JSONObject, extra: JSONObject = JSONObject()) {
        service(
            "/schedules",
            extra
                .put("action", action)
                .put("id", task.str("id"))
                .put("projectId", task.opt("projectId")),
        ) {
            navigate(Page.TASKS)
        }
    }

    fun openTaskChat(task: JSONObject, chatId: String) {
        if (chatId.isBlank()) {
            notice("该次任务还没有生成对话")
            return
        }
        val projectId = task.str("projectId")
        if (projectId.isBlank()) openChat(chatId, task.str("name"), null)
        else
            service("/projects", json("action" to "get", "projectId" to projectId)) { data ->
                openChat(chatId, task.str("name"), data.obj("project"))
            }
    }

    fun saveProfile(
        displayName: String,
        loginName: String,
        password: String,
        avatar: String? = null,
    ) {
        val body =
            json("action" to "update", "displayName" to displayName, "loginName" to loginName)
        if (password.isNotBlank()) body.put("newPasswordHash", sha256(password))
        if (avatar != null) body.put("avatar", avatar)
        service("/account", body) { result ->
            val old = mutable.value.session ?: return@service
            val saved = SavedSession(old.token, result.obj("profile"), old.canManage)
            sessions.save(saved)
            mutable.update { it.copy(session = saved, notice = "账号设置已保存") }
        }
    }

    fun loadAdmin() {
        if (mutable.value.session?.canManage != true) return
        viewModelScope.launch {
            try {
                val data = api.route("users")
                mutable.update { it.copy(data = data, loading = false) }
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    fun moreAdmin() {
        val cursor = mutable.value.data.str("cursor")
        if (cursor.isBlank()) return
        viewModelScope.launch {
            try {
                val next = api.route("users?cursor=" + java.net.URLEncoder.encode(cursor, "UTF-8"))
                mutable.update {
                    it.copy(
                        data =
                            next.put(
                                "users",
                                JSONArray(
                                    it.data.arr("users").objects() + next.arr("users").objects()
                                ),
                            )
                    )
                }
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    fun loadUsage(all: Boolean = false) {
        viewModelScope.launch {
            try {
                val total = api.call("/usage", json("action" to "summary", "all" to all))
                val receipts = api.call("/usage", json("action" to "receipts"))
                mutable.update {
                    it.copy(data = total.put("receipts", receipts.arr("receipts")), loading = false)
                }
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    fun createUser(username: String, password: String) {
        mutable.update { it.copy(loading = true) }
        viewModelScope.launch {
            try {
                require(username.isNotBlank() && password.isNotEmpty()) { "请输入新账号和密码" }
                api.route(
                    "users",
                    json("username" to username.trim(), "passwordHash" to sha256(password)),
                )
                notice("账号已创建，对方现在可以使用它登录")
                loadAdmin()
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    private fun updateMessage(uid: Long, change: (JSONObject) -> Unit) {
        mutable.update { s ->
            s.copy(
                messages =
                    s.messages.map { message ->
                        if (message.optLong("uid") == uid) message.copyJson().apply(change)
                        else message
                    }
            )
        }
    }

    private suspend fun saveChat(s: AssistantState = mutable.value) {
        if (s.incognito) return
        val body =
            projectPayload(s)
                .put("action", "save")
                .put("chatId", s.chatId)
                .put("title", s.title)
                .put(
                    "messages",
                    JSONArray(
                        s.messages.map { message ->
                            message.copyJson().apply {
                                remove("localPreview")
                                arr("imgItems").objects().forEach { it.remove("localPath") }
                            }
                        }
                    ),
                )
        api.call("/chats", body)
        withContext(Dispatchers.IO) {
            cache.put(
                s.session?.accountId.orEmpty(),
                scope(s),
                s.chatId,
                json("messages" to JSONArray(s.messages)),
            )
        }
    }

    fun messageFlag(uid: Long, key: String, value: Any) {
        updateMessage(uid) { it.put(key, value) }
        viewModelScope.launch {
            try {
                saveChat()
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    fun fork(message: JSONObject, edited: String? = null) {
        val all = mutable.value.messages
        val index = all.indexOfFirst { it.optLong("uid") == message.optLong("uid") }
        val user =
            if (message.optBoolean("isUser")) message
            else all.take(index).lastOrNull { it.optBoolean("isUser") } ?: return
        val before = all.takeWhile { it.optLong("uid") != user.optLong("uid") }
        newChat()
        mutable.update {
            it.copy(
                messages = before,
                draft = edited ?: user.str("topicText", user.str("text")),
                title = "分支 · " + user.str("text").take(36),
            )
        }
    }

    fun send() {
        val s = mutable.value
        if (s.busy || s.loading || s.draft.isBlank()) return
        mutable.update { it.copy(busy = true) }
        rememberView()
        viewModelScope.launch {
            try {
                when (s.mode) {
                    "image" -> sendImage(s)
                    "debate" -> sendDebate(s)
                    else -> sendChat(s)
                }
            } catch (e: Exception) {
                mutable.update { it.copy(busy = false) }
                error(e)
            }
        }
    }

    private fun userMessage(s: AssistantState, uid: Long): JSONObject {
        val text = (s.quote?.let { "引用 ${it.str("author")}：${it.str("text")}\n\n" } ?: "") + s.draft
        return json(
            "uid" to uid,
            "isUser" to true,
            "brand" to "user",
            "name" to s.session?.profile?.str("displayName", "用户"),
            "text" to text,
            "topicText" to s.draft,
            "chatMode" to s.mode,
            "_quote" to s.quote,
            "pastedTexts" to
                JSONArray(
                    s.attachments.filterNot { it.image }.map { "[文件: ${it.name}]\n" + it.text }
                ),
        )
    }

    private suspend fun sendChat(s: AssistantState) {
        require(s.draft.length + s.attachments.sumOf { it.text.length } <= 50000) {
            "内容较长，请先加入项目资料再提问"
        }
        val uid = System.currentTimeMillis()
        val replyUid = uid + 1
        val runId = UUID.randomUUID().toString()
        val user = userMessage(s, uid)
        val reply =
            json(
                "uid" to replyUid,
                "isUser" to false,
                "submodel" to s.model,
                "name" to modelName(s.model),
                "text" to "",
                "reasoning" to "",
                "effort" to s.effort,
                "chatMode" to "chat",
                "run" to
                    json(
                        "id" to runId,
                        "status" to "running",
                        "chatId" to s.chatId,
                        "projectId" to s.project?.str("id"),
                    ),
            )
        val history = JSONArray(s.messages.takeLast(16))
        val question =
            user.str("text") +
                (s.attachments
                    .filterNot { it.image }
                    .joinToString("") { "\n\n[文件：${it.name}]\n${it.text}" })
        val docs =
            s.attachments.filterNot { it.image }.takeIf { s.skills.str("mode") != "off" }
                ?: emptyList()
        val chat =
            json(
                "chatId" to s.chatId,
                "scope" to scope(s),
                "question" to question,
                "history" to history,
                "historyEndUid" to s.messages.lastOrNull()?.optLong("uid"),
                "skills" to s.skills,
                "files" to JSONArray(docs.map { it.skillFile() }),
                "incognito" to s.incognito,
            )
        val payload =
            json(
                "model" to s.model,
                "effort" to s.effort,
                "prompt" to question,
                "search" to s.search,
                "projectId" to s.project?.str("id"),
                "images" to JSONArray(s.attachments.filter { it.image }.map { it.reference() }),
                "chat" to chat,
                "recovery" to
                    json("userMessage" to user, "replyUid" to replyUid, "title" to s.draft.take(80)),
            )
        if (s.effort.isBlank()) payload.remove("effort")
        mutable.update {
            it.copy(
                messages = s.messages + user + reply,
                title = if (s.messages.isEmpty()) s.draft.take(50) else s.title,
                draft = "",
                attachments = emptyList(),
                quote = null,
                busy = true,
                error = "",
                page = Page.CHAT,
            )
        }
        val ref =
            projectPayload(s).put("runId", runId).put("chatId", s.chatId).put("replyUid", replyUid)
        activeRun = ref
        try {
            startRun("/chat-runs", ref, "payload", payload)
            watchChat(ref)
        } catch (e: Exception) {
            updateMessage(replyUid) { it.put("isError", true).put("text", e.message) }
            mutable.update { it.copy(busy = false) }
            throw e
        }
    }

    private suspend fun startRun(
        path: String,
        ref: JSONObject,
        key: String,
        payload: JSONObject,
    ): JSONObject {
        var last: Exception? = null
        repeat(3) { attempt ->
            try {
                return api.call(path, ref.copyJson().put("action", "start").put(key, payload))
            } catch (e: Exception) {
                if (e is CancellationException || e is ApiFailure && e.status in 400..499) throw e
                last = e
                mutable.update { it.copy(connection = "正在恢复同一任务连接，不会重新创建请求") }
                delay((attempt + 1) * 1000L)
            }
        }
        throw last ?: Exception("连接未完成，请稍后重试")
    }

    private fun watchChat(ref: JSONObject) {
        observer?.cancel()
        observer =
            viewModelScope.launch {
                var cursor = 0L
                var completed = false
                var initialized = false
                while (isActive && !completed) {
                    try {
                        if (!initialized) {
                            val snapshot =
                                api.call("/chat-runs", ref.copyJson().put("action", "status"))
                            applyRunSnapshot(ref, snapshot)
                            cursor = snapshot.optLong("sequence")
                            completed = snapshot.str("status") != "running"
                            initialized = true
                            if (completed) break
                        }
                        api.stream(
                            "api",
                            json(
                                "path" to "/chat-runs",
                                "payload" to
                                    ref.copyJson().put("action", "events").put("after", cursor),
                            ),
                        ) { frame ->
                            if (frame.id > 0 && frame.id <= cursor) return@stream
                            if (frame.value != "[DONE]") {
                                val event = JSONObject(frame.value)
                                val uid = ref.optLong("replyUid")
                                if (
                                    mutable.value.chatId == ref.str("chatId") &&
                                        scope() ==
                                            ref.str("projectId", "general").ifBlank { "general" }
                                )
                                    updateMessage(uid) { message ->
                                        if (event.has("t"))
                                            message.put(
                                                "text",
                                                message.str("text") + event.str("t"),
                                            )
                                        if (event.has("r"))
                                            message.put(
                                                "reasoning",
                                                message.str("reasoning") + event.str("r"),
                                            )
                                        if (event.has("error")) {
                                            message.put("isError", true)
                                            message.put(
                                                "text",
                                                message.str("text").ifBlank { event.str("error") },
                                            )
                                        }
                                        for (key in
                                            listOf(
                                                "context",
                                                "skills",
                                                "artifacts",
                                                "skillSession",
                                                "executionModel",
                                                "grounding",
                                            )) if (event.has(key)) message.put(key, event.get(key))
                                        if (event.has("citation")) {
                                            val list = message.arr("citations")
                                            list.put(event.get("citation"))
                                            message.put("citations", list)
                                        }
                                        if (event.has("executionModel"))
                                            message
                                                .put("submodel", event.str("executionModel"))
                                                .put("name", modelName(event.str("executionModel")))
                                        if (event.has("modelName"))
                                            message.put("name", event.str("modelName"))
                                        if (event.has("status"))
                                            message.put("status", event.get("status"))
                                    }
                            }
                            if (frame.id > 0) cursor = frame.id
                        }
                        run {
                            val result =
                                api.call("/chat-runs", ref.copyJson().put("action", "status"))
                            if (result.str("status") != "running") {
                                applyRunSnapshot(ref, result)
                                completed = true
                            } else delay(1000)
                        }
                    } catch (e: Exception) {
                        if (e is CancellationException) throw e
                        if (e is ApiFailure && e.status in 400..499) {
                            error(e)
                            break
                        }
                        mutable.update { it.copy(connection = "连接恢复中，已收到的内容会保留") }
                        delay(2000)
                    }
                }
                if (mutable.value.chatId == ref.str("chatId")) {
                    if (completed)
                        updateMessage(ref.optLong("replyUid")) {
                            it.put("completedAt", System.currentTimeMillis())
                        }
                    mutable.update {
                        it.copy(busy = false, connection = if (completed) "已连接" else "任务已保留，可重新连接")
                    }
                    runCatching { saveChat() }.onFailure { error(it) }
                    loadHistory()
                }
            }
    }

    private fun updateMemoryAfterChat() {
        val s = mutable.value
        val last = s.messages.lastOrNull { !it.optBoolean("isUser") } ?: return
        if (s.incognito || last.optBoolean("isError") || last.optBoolean("nativeMemoryHandled"))
            return
        updateMessage(last.optLong("uid")) { it.put("nativeMemoryHandled", true) }
        val countKey = "memory-turn:" + account() + ":" + scope(s)
        val turns = preferences.getInt(countKey, 0) + 1
        preferences.edit().putInt(countKey, turns).apply()
        val topic = s.messages.lastOrNull { it.optBoolean("isUser") }?.str("topicText").orEmpty()
        if (
            turns % 4 != 0 &&
                !Regex("记住|请牢记|remember", RegexOption.IGNORE_CASE).containsMatchIn(topic)
        )
            return
        val conversation =
            s.messages
                .takeLast(12)
                .joinToString("\n\n") {
                    (if (it.optBoolean("isUser")) "用户：" else "AI：") + it.str("text")
                }
                .takeLast(24000)
        viewModelScope.launch {
            runCatching {
                val result =
                    api.call(
                        "/memory",
                        projectPayload(s)
                            .put("conversation", conversation)
                            .put("billingParentId", last.obj("usage").str("id")),
                    )
                if (
                    account() == s.session?.accountId &&
                        mutable.value.chatId == s.chatId &&
                        result.has("usage")
                ) {
                    updateMessage(last.optLong("uid")) {
                        it.put("memoryUsage", result.get("usage"))
                    }
                    saveChat()
                }
            }
        }
    }

    private fun applyRunSnapshot(ref: JSONObject, result: JSONObject) {
        val reply = result.optJSONObject("reply") ?: return
        updateMessage(ref.optLong("replyUid")) { message ->
            reply.keys().forEach { key -> message.put(key, reply.get(key)) }
            message.put(
                "run",
                ref.copyJson().put("id", ref.str("runId")).put("status", result.str("status")),
            )
        }
    }

    private fun resumeMessages(messages: List<JSONObject>) {
        val debate =
            messages
                .lastOrNull { !it.optBoolean("isUser") }
                ?.takeIf { it.obj("debateRun").has("id") }
        if (debate != null) {
            val ref =
                projectPayload()
                    .put("chatId", mutable.value.chatId)
                    .put("runId", debate.obj("debateRun").str("id"))
            activeRun = ref
            watchDebate(ref)
            return
        }
        val message = messages.lastOrNull { it.obj("run").str("status") == "running" } ?: return
        val run = message.obj("run")
        val ref =
            projectPayload()
                .put("chatId", mutable.value.chatId)
                .put("runId", run.str("id"))
                .put("replyUid", message.optLong("uid"))
        activeRun = ref
        mutable.update { it.copy(busy = true) }
        watchChat(ref)
    }

    fun stop() {
        if (mutable.value.mode == "image") {
            observer?.cancel()
            mutable.update { it.copy(busy = false, notice = "已停止图片任务") }
            return
        }
        val ref = activeRun ?: return
        val path = if (mutable.value.mode == "debate") "/debate-runs" else "/chat-runs"
        service(
            path,
            ref.copyJson().put("action", "stop").put("operationId", UUID.randomUUID().toString()),
        ) {
            mutable.update { it.copy(busy = false, notice = "已停止") }
        }
    }

    fun modelName(id: String) =
        mutable.value.catalog.arr("models").objects().find { it.str("id") == id }?.str("name") ?: id

    private suspend fun sendImage(s: AssistantState) {
        val references = s.attachments.filter { it.image }
        val task =
            if (s.imageTask == "generation" && references.isNotEmpty())
                if (references.size == 1) "edit" else "multi-edit"
            else s.imageTask
        require(task != "edit" || references.size == 1) { "编辑图片需要 1 张参考图" }
        require(task != "multi-edit" || references.size >= 2) { "多图编辑至少需要 2 张参考图" }
        require(task == "generation" || references.isNotEmpty()) { "请先添加参考图片" }
        val cap = s.catalog.obj("imageCapabilities").obj(s.imageModel)
        require(references.size <= cap.optInt("references", 16)) { "参考图片超过当前模型上限" }
        val uid = System.currentTimeMillis()
        val replyUid = uid + 1
        val user = userMessage(s, uid)
        val reply =
            json(
                "uid" to replyUid,
                "name" to modelName(s.imageModel),
                "submodel" to s.imageModel,
                "text" to "",
                "chatMode" to "image",
                "imgItems" to JSONArray(),
                "imageSettings" to s.imageSettings,
                "imageTurn" to
                    json(
                        "prompt" to s.draft,
                        "parentUid" to s.imageParent,
                        "references" to JSONArray(references.map { it.reference() }),
                    ),
            )
        mutable.update {
            it.copy(
                messages = s.messages + user + reply,
                busy = true,
                error = "",
                draft = "",
                attachments = emptyList(),
                page = Page.CHAT,
                title = if (s.messages.isEmpty()) s.draft.take(50) else s.title,
            )
        }
        observer?.cancel()
        observer =
            viewModelScope.launch {
                try {
                    api.stream(
                        "image",
                        json(
                            "model" to s.imageModel,
                            "prompt" to s.draft,
                            "task" to task,
                            "settings" to s.imageSettings,
                            "references" to JSONArray(references.map { it.reference() }),
                            "projectId" to s.project?.str("id"),
                            "chatId" to s.chatId,
                            "parentUid" to s.imageParent,
                            "imageMask" to s.imageMask?.reference(),
                        ),
                    ) { frame ->
                        if (frame.value == "[DONE]") return@stream
                        val event = JSONObject(frame.value)
                        if (event.has("error")) throw ApiFailure(400, event.str("error"))
                        if (mutable.value.chatId != s.chatId || account() != s.session?.accountId)
                            return@stream
                        val original =
                            if (event.has("img"))
                                files.image(event.str("img"), event.str("mime", "image/png"))
                            else null
                        val preview =
                            event
                                .optJSONObject("imagePreview")
                                ?.takeIf { it.has("data") }
                                ?.let { files.image(it.str("data"), it.str("mime", "image/png")) }
                        val oldPreview =
                            mutable.value.messages
                                .find { it.optLong("uid") == replyUid }
                                ?.str("localPreview")
                                .orEmpty()
                        if (mutable.value.chatId != s.chatId || account() != s.session?.accountId) {
                            original?.let { files.removePreview(it.path) }
                            preview?.let { files.removePreview(it.path) }
                            return@stream
                        }
                        updateMessage(replyUid) { message ->
                            if (event.has("t"))
                                message.put("text", message.str("text") + event.str("t"))
                            if (original != null) {
                                val items = message.arr("imgItems")
                                items.put(
                                    json(
                                        "data" to event.str("img"),
                                        "mime" to event.str("mime", "image/png"),
                                        "localPath" to original.path,
                                    )
                                )
                                message.put("imgItems", items)
                                message.remove("localPreview")
                            }
                            if (preview != null) message.put("localPreview", preview.path)
                            if (event.has("imageContext"))
                                message.put("imageResponse", event.obj("imageContext").arr("parts"))
                            for (key in
                                listOf(
                                    "imageDetails",
                                    "imageUsage",
                                    "grounding",
                                    "activity",
                                    "status",
                                )) if (event.has(key)) message.put(key, event.get(key))
                        }
                        if (oldPreview.isNotBlank() && (original != null || preview != null))
                            files.removePreview(oldPreview)
                    }
                    updateMessage(replyUid) { it.put("completedAt", System.currentTimeMillis()) }
                    saveChat()
                    loadHistory()
                } catch (e: Exception) {
                    if (e !is CancellationException) {
                        updateMessage(replyUid) {
                            it.put("isError", true).put("generationError", e.message)
                        }
                        error(e)
                    }
                } finally {
                    if (mutable.value.chatId == s.chatId) mutable.update { it.copy(busy = false) }
                }
            }
    }

    fun editImage(message: JSONObject, index: Int) {
        viewModelScope.launch {
            try {
                val item =
                    message.arr("imgItems").optJSONObject(index)
                        ?: json(
                            "data" to message.str("imgData"),
                            "mime" to message.str("imgMime", "image/png"),
                        )
                val file =
                    withContext(Dispatchers.IO) {
                        if (
                            item.str("localPath").isNotBlank() &&
                                files.owns(File(item.str("localPath")))
                        )
                            File(item.str("localPath"))
                        else files.image(item.str("data"), item.str("mime", "image/png"))
                    }
                val attachment =
                    NativeAttachment(
                        UUID.randomUUID().toString(),
                        "参考图片." + file.extension,
                        item.str("mime", "image/png"),
                        file.path,
                        file.length(),
                    )
                mutable.update {
                    it.copy(
                        mode = "image",
                        imageModel = message.str("submodel", it.imageModel),
                        imageTask = "edit",
                        attachments = listOf(attachment),
                        imageParent =
                            if (
                                message.arr("imageResponse").length() > 0 &&
                                    message.has("imageTurn")
                            )
                                message.optLong("uid")
                            else null,
                        imageMask = null,
                        page = Page.CHAT,
                        draft = "",
                    )
                }
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    private suspend fun sendDebate(s: AssistantState) {
        val uid = System.currentTimeMillis()
        val runId = UUID.randomUUID().toString()
        val user = userMessage(s, uid)
        val config =
            s.debate
                .copyJson()
                .put("id", runId)
                .put(
                    "topic",
                    user.str("text") +
                        s.attachments
                            .filterNot { it.image }
                            .joinToString("") { "\n\n[资料：${it.name}]\n${it.text}" },
                )
                .put("contractVersion", "studio-v3")
        val plan = api.route("debate-plan", config).obj("plan")
        val ids = (0 until plan.arr("turns").length()).map { uid + it + 1 }
        val input =
            json(
                "config" to config,
                "userMessage" to user,
                "replyUids" to JSONArray(ids),
                "historyEndUid" to s.messages.lastOrNull()?.optLong("uid"),
                "skills" to s.skills,
                "search" to s.search,
                "images" to JSONArray(s.attachments.filter { it.image }.map { it.reference() }),
                "incognito" to s.incognito,
                "title" to s.draft.take(80),
            )
        mutable.update {
            it.copy(
                messages = s.messages + user,
                draft = "",
                attachments = emptyList(),
                quote = null,
                busy = true,
                error = "",
                page = Page.CHAT,
                title = if (s.messages.isEmpty()) s.draft.take(50) else s.title,
            )
        }
        val ref = projectPayload(s).put("runId", runId).put("chatId", s.chatId)
        activeRun = ref
        startRun("/debate-runs", ref, "input", input)
        watchDebate(ref)
    }

    private fun watchDebate(ref: JSONObject) {
        observer?.cancel()
        observer =
            viewModelScope.launch {
                var version = 0L
                try {
                    while (isActive) {
                        val snapshot =
                            api.call(
                                "/debate-runs",
                                ref.copyJson().put("action", "status").put("after", version),
                            )
                        version = snapshot.optLong("version", version)
                        if (mutable.value.chatId != ref.str("chatId")) break
                        val plan = snapshot.obj("plan")
                        val specifications = plan.arr("turns")
                        val mapped =
                            snapshot.arr("turns").objects().map { turn ->
                                val spec =
                                    specifications.optJSONObject(turn.optInt("index"))
                                        ?: JSONObject()
                                val reply = turn.obj("reply").copyJson()
                                if (!reply.has("uid"))
                                    reply.put(
                                        "uid",
                                        (ref.str("runId") + ":" + turn.optInt("index"))
                                            .hashCode()
                                            .toLong()
                                            .let { if (it < 0) -it else it } + 1,
                                    )
                                reply
                                    .put(
                                        "debateRun",
                                        json(
                                            "id" to ref.str("runId"),
                                            "status" to snapshot.str("status"),
                                        ),
                                    )
                                    .put("debateSessionId", ref.str("runId"))
                                    .put("chatMode", "debate")
                                    .put("participantId", spec.obj("member").str("id"))
                                    .put("debateStage", spec.str("stage"))
                                    .put("turnIndex", turn.optInt("index"))
                                    .put("turnStatus", turn.str("status"))
                                    .put("turnAttempt", turn.optInt("attempt"))
                                if (reply.str("name").isBlank())
                                    reply.put("name", spec.obj("member").str("label", "讨论席位"))
                                if (turn.has("error"))
                                    reply.put("generationError", turn.get("error"))
                                reply
                            }
                        mutable.update { current ->
                            val prefix =
                                current.messages.filterNot {
                                    it.str("debateSessionId") == ref.str("runId")
                                }
                            current.copy(
                                messages = prefix + mapped,
                                run = snapshot,
                                busy = snapshot.str("status") == "running",
                                connection = "已连接",
                            )
                        }
                        if (snapshot.str("status") != "running") {
                            runCatching { saveChat() }.onFailure { error(it) }
                            loadHistory()
                            break
                        }
                        delay(1000)
                    }
                } catch (e: Exception) {
                    if (e !is CancellationException) {
                        error(e)
                        mutable.update { it.copy(busy = false, connection = "讨论已保留，可重新连接") }
                    }
                }
            }
    }

    fun debateAction(action: String, turn: JSONObject? = null) {
        val ref = activeRun ?: return
        val body =
            ref.copyJson().put("action", action).put("operationId", UUID.randomUUID().toString())
        if (turn != null)
            body.put("turn", turn.optInt("turnIndex")).put("attempt", turn.optInt("turnAttempt"))
        service("/debate-runs", body) { watchDebate(ref) }
    }

    fun reconnect() {
        activeRun?.let { if (mutable.value.mode == "debate") watchDebate(it) else watchChat(it) }
    }

    fun followupDebate() {
        val s = mutable.value
        val run = s.run ?: return
        mutable.update {
            it.copy(
                debate = it.debate.copyJson().put("priorRunId", run.str("id", run.str("runId"))),
                draft = "",
                run = null,
                busy = false,
            )
        }
    }

    fun exportedText(): String {
        val s = mutable.value
        return "# ${s.title}\n\n" +
            s.messages.joinToString("\n\n") { message ->
                "## " +
                    message.str("name", if (message.optBoolean("isUser")) "用户" else "AI") +
                    message.str("debateStage").let { if (it.isBlank()) "" else " · $it" } +
                    "\n\n" +
                    message.str("text") +
                    (message.str("generationError").let {
                        if (it.isBlank()) "" else "\n\n执行说明：$it"
                    })
            }
    }

    fun imageFile(message: JSONObject, index: Int, onFile: (File, String) -> Unit) {
        viewModelScope.launch {
            try {
                val item =
                    message.arr("imgItems").optJSONObject(index)
                        ?: json(
                            "data" to message.str("imgData"),
                            "mime" to message.str("imgMime", "image/png"),
                        )
                val file =
                    withContext(Dispatchers.IO) {
                        if (
                            item.str("localPath").isNotBlank() &&
                                files.owns(File(item.str("localPath")))
                        )
                            File(item.str("localPath"))
                        else files.image(item.str("data"), item.str("mime", "image/png"))
                    }
                onFile(file, item.str("mime", "image/png"))
            } catch (e: Exception) {
                error(e)
            }
        }
    }

    fun artifact(
        message: JSONObject,
        file: JSONObject,
        delete: Boolean = false,
        onFile: (File, String) -> Unit = { _, _ -> },
    ) {
        viewModelScope.launch {
            try {
                val payload =
                    projectPayload()
                        .put("token", file.str("token"))
                        .put("action", if (delete) "delete" else "download")
                if (delete) {
                    api.call("/skill-files", payload)
                    updateMessage(message.optLong("uid")) { m ->
                        val entries =
                            m.arr("artifacts").objects().map { entry ->
                                if (entry.str("token") == file.str("token"))
                                    entry.copyJson().put("deleted", true)
                                else entry
                            }
                        m.put("artifacts", JSONArray(entries))
                    }
                    saveChat()
                } else {
                    val target =
                        File(
                            getApplication<Application>().filesDir,
                            "attachments/" +
                                UUID.randomUUID().toString() +
                                "-" +
                                file
                                    .str("name", "document")
                                    .replace(Regex("[^\\p{L}\\p{N}._-]"), "_"),
                        )
                    target.parentFile?.mkdirs()
                    val mime = api.download("/skill-files", payload, target)
                    onFile(target, mime)
                }
            } catch (e: Exception) {
                error(e)
            }
        }
    }
}
