package com.pickandcase.assistant

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun NativeUpdateHost(updates: NativeUpdates) {
    val state by updates.state.collectAsStateWithLifecycle()
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, updates) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) updates.resumed() }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    if (!state.visible) return
    val release = state.release
    AlertDialog(
        onDismissRequest = updates::dismiss,
        icon = { Icon(Icons.Outlined.SystemUpdate, null) },
        title = { Text(if (release != null) "发现新版本 ${release.version}" else "应用更新") },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 360.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("当前版本 ${BuildConfig.VERSION_NAME}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                when (state.phase) {
                    UpdatePhase.IDLE, UpdatePhase.CHECKING -> { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("正在检查更新…") }
                    UpdatePhase.CURRENT -> Text("已是最新版本", modifier = Modifier.testTag("update-current"))
                    UpdatePhase.AVAILABLE -> {
                        Text("新版本 ${(release?.bytes ?: 0) / 1024 / 1024} MB · 更新后保留登录与设置")
                        if (!release?.notes.isNullOrBlank()) Text(release!!.notes)
                    }
                    UpdatePhase.DOWNLOADING -> {
                        LinearProgressIndicator(progress = { state.received.toFloat() / (release?.bytes?.coerceAtLeast(1) ?: 1) }, modifier = Modifier.fillMaxWidth().testTag("update-progress"))
                        Text("下载中 ${state.received * 100 / (release?.bytes?.coerceAtLeast(1) ?: 1)}%")
                    }
                    UpdatePhase.READY -> Text("下载完成，安装包已校验。点击安装更新后，由安卓系统确认安装。", modifier = Modifier.testTag("update-ready"))
                    UpdatePhase.FAILED -> Unit
                }
                if (state.error.isNotBlank()) Text(state.error, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("update-error"))
            }
        },
        confirmButton = {
            when (state.phase) {
                UpdatePhase.AVAILABLE -> Button(onClick = updates::download, modifier = Modifier.testTag("update-download")) { Text("下载更新") }
                UpdatePhase.READY -> Button(onClick = updates::install, modifier = Modifier.testTag("update-install")) { Text("安装更新") }
                UpdatePhase.FAILED -> Button(onClick = { if (release == null) updates.check() else updates.download() }, modifier = Modifier.testTag("update-retry")) { Text("重试") }
                UpdatePhase.CURRENT -> TextButton(onClick = updates::dismiss) { Text("完成") }
                else -> Unit
            }
        },
        dismissButton = {
            if (state.phase == UpdatePhase.DOWNLOADING) TextButton(onClick = updates::cancel, modifier = Modifier.testTag("update-cancel")) { Text("取消下载") }
            else if (state.phase != UpdatePhase.CURRENT) TextButton(onClick = updates::dismiss) { Text("稍后") }
        },
    )
}
