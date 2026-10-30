package com.pickandcase.assistant

import android.graphics.Paint
import android.graphics.Typeface
import android.widget.TextView
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class NativeTypographyRuntimeTest {
    @get:Rule val compose = createComposeRule()

    @Test fun themeInputsMarkdownAndCodeShareApprovedFonts() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val face = NativeTypography.typeface(context)
        val typography = NativeTypography.typography(context)
        val family = typography.bodyLarge.fontFamily
        val styles = listOf(typography.displayLarge, typography.displayMedium, typography.displaySmall,
            typography.headlineLarge, typography.headlineMedium, typography.headlineSmall,
            typography.titleLarge, typography.titleMedium, typography.titleSmall,
            typography.bodyLarge, typography.bodyMedium, typography.bodySmall,
            typography.labelLarge, typography.labelMedium, typography.labelSmall)
        assertTrue(styles.all { it.fontFamily == family })
        assertSame(face, NativeTypography.typeface(context))
        val paint = Paint().apply { typeface = face }
        for (glyph in listOf("思", "源", "现", "代", "Aa", "123")) {
            // hasGlyph accepts one character; multi-character strings need not be ligatures.
            glyph.forEach { assertTrue("Missing approved glyph: $it", paint.hasGlyph(it.toString())) }
        }
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            fun resourceHash(id: Int): String {
                val digest = java.security.MessageDigest.getInstance("SHA-256")
                context.resources.openRawResource(id).use { stream ->
                    val bytes = ByteArray(8192)
                    while (true) { val n = stream.read(bytes); if (n < 0) break; digest.update(bytes, 0, n) }
                }
                return digest.digest().joinToString("") { "%02x".format(it) }
            }
            for ((text, resource) in listOf("A" to R.font.inter, "思" to R.font.noto_sans_sc)) {
                val shaped = android.graphics.text.TextRunShaper.shapeTextRun(text, 0, text.length, 0, text.length, 0f, 0f, false, paint)
                val digest = java.security.MessageDigest.getInstance("SHA-256")
                val buffer = shaped.getFont(0).buffer.duplicate().apply { rewind() }
                digest.update(buffer)
                assertEquals("Renderer selected the wrong font for $text", resourceHash(resource), digest.digest().joinToString("") { "%02x".format(it) })
            }
        }
        lateinit var root: View
        compose.setContent {
            root = LocalView.current
            MaterialTheme(typography = typography) {
                Surface { Column {
                    Text("思源现代 · Inter 123", Modifier.testTag("font-title"), style = MaterialTheme.typography.titleLarge)
                    Text("所有界面统一字体，中文与 English 一致。", Modifier.testTag("font-body"))
                    OutlinedTextField("输入框 Input 123", {}, label = { Text("消息内容") })
                    Button(onClick = {}) { Text("开始讨论") }
                    Markdown("## 回复标题 Heading\n\n正文与 **强调文字**。\n\n`const total = 123`\n\n```text\n代码区域也使用思源现代\n```")
                } }
            }
        }
        compose.waitForIdle()
        for (tag in listOf("font-title", "font-body")) {
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithTag(tag).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertEquals(family, layouts.single().layoutInput.style.fontFamily)
        }
        fun textViews(view: View): List<TextView> = (if (view is TextView) listOf(view) else emptyList()) +
            (if (view is ViewGroup) (0 until view.childCount).flatMap { textViews(view.getChildAt(it)) } else emptyList())
        compose.runOnIdle { assertTrue(textViews(root.rootView).any { it.typeface == face && it.text.contains("const total") }) }
        compose.onRoot().captureToImage().asAndroidBitmap().let { bitmap ->
            File(context.filesDir, "font-acceptance.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        }
    }
}
