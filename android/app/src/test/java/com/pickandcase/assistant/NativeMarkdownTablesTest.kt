package com.pickandcase.assistant

import org.junit.Assert.*
import org.junit.Test

class NativeMarkdownTablesTest {
    @Test fun escaped_pipes_and_inline_code_do_not_create_extra_columns() {
        assertEquals(listOf("名称", "`a|b`", "A\\|B"), NativeMarkdownTables.cells("| 名称 | `a|b` | A\\|B |"))
    }
    @Test fun fenced_examples_remain_code_and_real_tables_preserve_all_fields() {
        val text="""
            ```markdown
            |not|table|
            |---|---|
            ```
            
            |编号|位置|命中片段|来源|可信度|建议|负责人|替换|
            |---|---|---|---|---|---|---|---|
            |WA-01|共享页脚|`https://example.test/long/path`|source.php|确认|删除元素|Owner|空|
        """.trimIndent()
        val parsed=NativeMarkdownTables.parse(text)
        assertEquals(2,parsed.size)
        assertTrue(parsed.first() is NativeMarkdownPart.Text)
        val table=parsed.last() as NativeMarkdownPart.Table
        assertEquals(8,table.headers.size)
        assertEquals(8,table.rows.single().size)
        assertEquals("WA-01",table.rows.single().first())
        assertEquals("空",table.rows.single().last())
    }
    @Test fun ragged_rows_keep_the_same_number_of_fields() {
        val table=NativeMarkdownTables.parse("|A|B|C|\n|---|---|---|\n|1|2|\n|3|4|5|").single() as NativeMarkdownPart.Table
        assertEquals(listOf("1","2",""),table.rows.first())
        assertEquals(2,table.rows.size)
    }
}
