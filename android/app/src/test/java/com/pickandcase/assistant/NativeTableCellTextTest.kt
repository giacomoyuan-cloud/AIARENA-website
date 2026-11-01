package com.pickandcase.assistant

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import org.junit.Assert.*
import org.junit.Test

class NativeTableCellTextTest {
    @Test fun inline_formatting_keeps_content_and_semantic_styles() {
        val text = NativeTableCellText.render("普通 **重点** *说明* ~~旧内容~~ `ID-001`", Color.Blue)!!
        assertEquals("普通 重点 说明 旧内容 ID-001", text.text)
        assertTrue(text.spanStyles.any { it.item.fontWeight == FontWeight.Bold })
        assertTrue(text.spanStyles.any { it.item.fontStyle == FontStyle.Italic })
        assertTrue(text.spanStyles.any { it.item.textDecoration == TextDecoration.LineThrough })
        assertTrue(text.spanStyles.any { it.item.fontFamily == FontFamily.Monospace })
    }

    @Test fun links_are_clickable_without_nested_link_annotations() {
        val text = NativeTableCellText.render("[https://example.test](https://example.test) 与 https://example.test/A_(B)。", Color.Blue)!!
        val links = text.getLinkAnnotations(0, text.length)
        assertEquals(2, links.size)
        assertEquals(listOf("https://example.test", "https://example.test/A_(B)"), links.map { (it.item as LinkAnnotation.Url).url })
        assertTrue(text.text.endsWith("。"))
        val unsafe = NativeTableCellText.render("[只显示文字](javascript:alert)", Color.Blue)!!
        assertEquals("只显示文字", unsafe.text)
        assertTrue(unsafe.getLinkAnnotations(0, unsafe.length).isEmpty())
    }

    @Test fun currency_code_escapes_and_line_breaks_are_not_reinterpreted() {
        val text = NativeTableCellText.render("价格 $4 和 $20，`x|y`，a\\|b<br>下一行", Color.Blue)!!
        assertEquals("价格 $4 和 $20，x|y，a|b\n下一行", text.text)
        assertTrue(text.getLinkAnnotations(0, text.length).isEmpty())
    }

    @Test fun formulas_and_block_markdown_keep_the_existing_full_renderer() {
        assertNull(NativeTableCellText.render("公式 \\(x^2\\)", Color.Blue))
        assertNull(NativeTableCellText.render("\$\$x^2\$\$", Color.Blue))
        assertNull(NativeTableCellText.render("- 第一项\n- 第二项", Color.Blue))
        assertNull(NativeTableCellText.render("## 标题", Color.Blue))
    }

    @Test fun platform_contact_links_keep_the_original_click_behavior() {
        for (value in listOf("mail@example.com", "example.com/help", "+86 138 1234 5678")) {
            assertNull(NativeTableCellText.render(value, Color.Blue))
        }
        assertNotNull(NativeTableCellText.render("`contact@example.com`", Color.Blue))
        assertNotNull(NativeTableCellText.render("[example.com](https://example.test)", Color.Blue))
    }
}
