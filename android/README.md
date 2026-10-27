# AI 助手 Android

Native Java/AndroidX WebView app for `https://ai.pickandcase.com/`. The APK has its own launcher, Android splash, system-bar/IME insets, back handling, file picker/camera integration, offline recovery, original-image gallery save and Android sharesheet. Regular website changes are fetched on cold start and checked on resume; active work is preserved until an empty, safe view is available. Native permission or Android compatibility changes still require a new APK signed with the same key.

## Build

Requires JDK 17, Android SDK 36 and Gradle 8.11.1 (wrapper included).

```sh
./gradlew :app:testDebugUnitTest :app:lintRelease :app:assembleDebug :app:assembleRelease
```

Release signing uses the locally generated `signing/release.jks` and `signing/release.properties` (`storePassword` and `keyPassword`, alias `ai-assistant`). Both are gitignored. Back up that directory securely before retiring this checkout; losing the key prevents native updates over the installed package. No API keys or website credentials are bundled in the APK.

## Runtime verification

`AppRuntimeTest` uses copied, isolated website assets and synthetic image fixtures. It intercepts HTTP resources and never invokes an AI provider. Tests cover native bridge replies, MIME/origin validation, byte-preserving gallery save, Android sharesheet, multi-photo file picker, back handling, offline retry, continuous touch drag/real selected effort/reset, actual soft-keyboard resize and mobile image settings.

```sh
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
# Install both debug APKs on a dedicated emulator or authorized test device, then:
adb shell am instrument -w com.pickandcase.assistant.debug.test/androidx.test.runner.AndroidJUnitRunner
```

The bridge is injected only into the exact HTTPS production origin. The receiver also rejects subframes and checks the current top-level URL. SSL failures are cancelled, mixed content/file access are disabled, and release WebView debugging is off. FileProvider exposes only the app's image-sharing cache; no broad storage permission is requested.

Stage public assets with `node scripts/stage-site.mjs` from the repository root. This explicitly excludes Android source, tests, build folders, signing credentials and `node_modules` from Cloudflare Pages.
