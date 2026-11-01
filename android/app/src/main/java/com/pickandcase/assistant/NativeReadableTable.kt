package com.pickandcase.assistant

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.launch

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun NativeReadableTable(table: NativeMarkdownPart.Table) {
    val linkColor = MaterialTheme.colorScheme.primary
    val cells = remember(table, linkColor) { NativeTableCellText(linkColor) }
    val renderer = rememberNativeMarkdownRenderer()
    CompositionLocalProvider(LocalNativeMarkdownRenderer provides renderer) {
        BoxWithConstraints(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
            var chosen by rememberSaveable(table.headers.joinToString("|")) { mutableStateOf<String?>(null) }
            var page by rememberSaveable(table.headers.joinToString("|")) { mutableIntStateOf(0) }
            val top = remember { BringIntoViewRequester() }
            val scope = rememberCoroutineScope()
            var sectionSize by remember { mutableStateOf(IntSize.Zero) }
            val previewDp = minOf(240f, LocalConfiguration.current.screenHeightDp * .25f).dp
            val previewHeight = with(LocalDensity.current) { previewDp.toPx() }
            val pageCount = maxOf(1, (table.rows.size + 11) / 12)
            val currentPage = page.coerceIn(0, pageCount - 1)
            val from = currentPage * 12
            val to = minOf(from + 12, table.rows.size)
            val rows = table.rows.subList(from, to)
            val horizontalScroll = rememberScrollState()
            val widths = remember(table) {
                table.headers.indices.map { column ->
                    if (table.headers[column].length > 60 || table.rows.any { it.getOrElse(column) { "" }.length > 60 }) 240.dp else 160.dp
                }
            }
            val mode = chosen ?: if (maxWidth < 720.dp && table.headers.size >= 4) "cards" else "table"
            fun revealStart() {
                scope.launch {
                    withFrameNanos { }; withFrameNanos { }
                    if (sectionSize != IntSize.Zero) top.bringIntoView(Rect(
                        0f, 0f, sectionSize.width.toFloat(), minOf(sectionSize.height.toFloat(), previewHeight),
                    ))
                }
            }
            fun changePage(value: Int) { page = value; revealStart() }
            fun changeMode(value: String) { chosen = value; revealStart() }
            Column(Modifier.fillMaxWidth().bringIntoViewRequester(top).onSizeChanged { sectionSize = it }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("${table.rows.size} 项 · ${table.headers.size} 列", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    FilterChip(selected = mode == "table", onClick = { changeMode("table") }, label = { Text("表格") }, modifier = Modifier.testTag("markdown-table-view"))
                    Spacer(Modifier.width(6.dp))
                    FilterChip(selected = mode == "cards", onClick = { changeMode("cards") }, label = { Text("逐项") }, modifier = Modifier.testTag("markdown-cards-view"))
                }
                SelectionContainer {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (mode == "cards") {
                            rows.forEachIndexed { index, row ->
                                val rowIndex = from + index
                                OutlinedCard(Modifier.fillMaxWidth().testTag("markdown-row-card-$rowIndex"), shape = RoundedCornerShape(12.dp), colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                        Text("第 ${rowIndex + 1} 项", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        table.headers.forEachIndexed { column, label ->
                                            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                                Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                                TableCell(row.getOrElse(column) { "" }, cells)
                                            }
                                        }
                                    }
                                }
                            }
                        } else {
                            Text("左右滑动查看全部列", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface, border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                                Column(Modifier.horizontalScroll(horizontalScroll).testTag("markdown-table-scroll")) {
                                    Row {
                                        table.headers.forEachIndexed { column, label ->
                                            Text(label, Modifier.width(widths[column]).padding(14.dp), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                                        }
                                    }
                                    rows.forEach { row ->
                                        HorizontalDivider()
                                        Row {
                                            table.headers.indices.forEach { column ->
                                                Box(Modifier.width(widths[column]).padding(14.dp)) { TableCell(row.getOrElse(column) { "" }, cells) }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if (pageCount > 1) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        ArenaTextButton(onClick = { changePage(currentPage - 1) }, enabled = currentPage > 0,
                            modifier = Modifier.testTag("markdown-table-page-prev")) { Text("上一页") }
                        Text("第 ${from + 1}–$to 项，共 ${table.rows.size} 项", Modifier.weight(1f),
                            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        ArenaTextButton(onClick = { changePage(currentPage + 1) }, enabled = currentPage + 1 < pageCount,
                            modifier = Modifier.testTag("markdown-table-page-next")) { Text("下一页") }
                    }
                }
            }
        }
    }
}

@Composable
private fun TableCell(value: String, cells: NativeTableCellText) {
    val text = cells.get(value)
    if (text == null) MarkdownText(value)
    else Text(text, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), style = MaterialTheme.typography.bodyLarge)
}
