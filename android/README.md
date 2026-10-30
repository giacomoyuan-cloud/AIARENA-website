# AI 助手 Android 原生客户端

`com.pickandcase.assistant`，Kotlin + Jetpack Compose，最低 Android 8.0。界面、导航、文件选择、图片查看/蒙版、语音入口、系统保存/分享均为 Android 原生实现，业务页面不使用 WebView。

原生客户端直接调用 `https://api.pickandcase.com/native/`，复用网页的账号、对话、项目、模型、辩论、图片、Skills、定时任务和用量数据。功能及实际验收范围见 [NATIVE_PARITY.md](NATIVE_PARITY.md)。

## 登录与管理

- 登录后使用不可推测的服务端会话；会话没有定时过期，不在设备保留明文密码或密码哈希。
- 会话通过 Android Keystore AES-GCM 加密保存；进程结束、重启和断网不会主动退出。设置页提供显式退出，离线退出的服务端撤销会在恢复网络后重试。
- 管理权限由服务端 `NATIVE_OWNER_ACCOUNT` 绑定既有 Oakley 的稳定账号 ID。其他账号不显示入口，服务端同样拒绝其管理请求。
- 开户通过 Durable Object 按用户名串行处理，防止重复开户覆盖。账号使用现有网页账号格式，网页与 App 通用。
- 2.0 首次从旧网页容器版本升级时需登录一次，此后保留原生会话。

## 构建

需要 JDK 17、Android SDK 36、Gradle 8.11.1（已有 wrapper）。

```sh
./gradlew :app:testDebugUnitTest :app:lintRelease :app:assembleDebug :app:assembleDebugAndroidTest :app:assembleRelease
```

可用 `-PnativeBuildRoot=/absolute/task-scratch/android-build` 和 `--project-cache-dir /absolute/task-scratch/gradle-project-cache` 把可重建产物放到任务临时目录。

发布签名使用 gitignored 的 `signing/release.jks` 与 `signing/release.properties`，alias 为 `ai-assistant`。沿用 1.0 原签名，支持覆盖升级；密钥必须安全保留，不能提交或打包到公共网站。APK 不包含供应商密钥或用户凭据。

## 验收

原生测试在专用模拟器连接完整 Worker、ChatRun、项目与调度实现。供应商响应在进程内模拟，外部模型网络封闭。覆盖加密会话、管理权限、对话/分支/附件、滑块、历史、三种讨论、失败恢复、全部图片供应商协议、蒙版/原图保存、私有资料/版本/下载、PDF/Office/ZIP 解析、定时任务、完整执行历史、独立日志回放、Skills 文件下载/删除、提示词/记忆/用量与主题。

```sh
NATIVE_QA_FULL_WORKER=1 node scripts/native-qa-server.mjs
# 在专用模拟器安装 debug 与 androidTest APK 后，显式指定设备：
adb -s emulator-5562 shell am instrument -w \
  -e class com.pickandcase.assistant.NativeRuntimeTest,com.pickandcase.assistant.NativeFeatureRuntimeTest,com.pickandcase.assistant.NativeParityRuntimeTest,com.pickandcase.assistant.NativeAdvancedRuntimeTest,com.pickandcase.assistant.NativeTaskJournalRuntimeTest,com.pickandcase.assistant.NativeArtifactRuntimeTest \
  com.pickandcase.assistant.debug.test/androidx.test.runner.AndroidJUnitRunner
```

测试后端地址覆盖仅在 DEBUG 构建生效。Release 使用固定 HTTPS API；真实供应商验收只用 Sol 6.1 Low。模拟器结果不等同于真机摄像头、语音服务或所有厂商 ROM 的验收。

若模拟器的 `10.0.2.2` NAT 出现间歇性连接超时，可先运行 `adb -s emulator-5562 reverse tcp:4197 tcp:4197`，再给 instrumentation 加上 `-e nativeFixtureBase http://127.0.0.1:4197/native/`。功能请求仍经过同一完整本地后台。冷启动测试需分别执行 `NativeColdStartRuntimeTest#prepare_local_persistent_session` 与 `NativeColdStartRuntimeTest#restore_after_real_process_death_without_login`，中间运行 `adb -s emulator-5562 shell am force-stop com.pickandcase.assistant.debug`。

真实测试账号由管理员创建，再由运维在该账号的服务端记录设置 `_solLowQA: true`。仅 `nativeqa-` 账号且 `createdBy` 为既有管理员时生效；HTTP 请求不能开启该标志。服务端强制生成、Skills 自动选择与记忆提取使用 Sol 6.1 Low，并在发出前写入不含提示词和凭据的审计。QA 辅助调用复用主对话的美国后台传输通道，不回退其他模型。普通账号沿用现有策略。

当前调度器约每 30 秒检查并回写任务状态。原生执行日志直接读取该次 ChatRun；查看日志不重新生成回答，也不恢复已删除的普通历史对话。当前网页隐藏且服务端已停用的旧视频、换脸和 Midjourney 入口不作为功能对齐目标。

`node scripts/stage-site.mjs` 只发布公共网页、下载包与素材，排除 Android 源码、测试、构建目录、签名材料与 node_modules。数学渲染组件的许可和带独立模块链接例外的授权随 APK 附带，原始源码镜像位于 downloads/open-source。
