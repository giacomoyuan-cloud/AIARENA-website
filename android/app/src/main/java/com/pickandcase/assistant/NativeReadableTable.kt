package com.pickandcase.assistant

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun NativeReadableTable(table: NativeMarkdownPart.Table) {
    BoxWithConstraints(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        var chosen by rememberSaveable(table.headers.joinToString("|")) { mutableStateOf<String?>(null) }
        var visible by rememberSaveable(table.headers.joinToString("|")) { mutableIntStateOf(12) }
        val mode = chosen ?: if (maxWidth < 720.dp && table.headers.size >= 4) "cards" else "table"
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("${table.rows.size} 项 · ${table.headers.size} 列", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FilterChip(selected = mode == "table", onClick = { chosen = "table" }, label = { Text("表格") }, modifier = Modifier.testTag("markdown-table-view"))
                Spacer(Modifier.width(6.dp))
                FilterChip(selected = mode == "cards", onClick = { chosen = "cards" }, label = { Text("逐项") }, modifier = Modifier.testTag("markdown-cards-view"))
            }
            if (mode == "cards") {
                table.rows.take(visible).forEachIndexed { rowIndex, row ->
                    OutlinedCard(Modifier.fillMaxWidth().testTag("markdown-row-card-$rowIndex"), shape = RoundedCornerShape(12.dp), colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            Text("第 ${rowIndex + 1} 项", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            table.headers.forEachIndexed { column, label ->
                                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    MarkdownText(row.getOrElse(column) { "" }.ifBlank { "—" })
                                }
                            }
                        }
                    }
                }
                if (table.rows.size > visible) TextButton(onClick = { visible += 12 }, modifier = Modifier.fillMaxWidth()) { Text("继续阅读（剩余 ${table.rows.size - visible} 项）") }
            } else {
                Text("左右滑动查看全部列", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val widths = table.headers.indices.map { column ->
                    if ((listOf(table.headers[column]) + table.rows.map { it.getOrElse(column) { "" } }).any { it.length > 60 }) 240.dp else 160.dp
                }
                Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface, border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Column(Modifier.horizontalScroll(rememberScrollState()).testTag("markdown-table-scroll")) {
                        Row {
                            table.headers.forEachIndexed { column, label ->
                                Text(label, Modifier.width(widths[column]).padding(14.dp), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                            }
                        }
                        table.rows.forEach { row ->
                            HorizontalDivider()
                            Row {
                                table.headers.indices.forEach { column ->
                                    Box(Modifier.width(widths[column]).padding(14.dp)) { MarkdownText(row.getOrElse(column) { "" }.ifBlank { "—" }) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
