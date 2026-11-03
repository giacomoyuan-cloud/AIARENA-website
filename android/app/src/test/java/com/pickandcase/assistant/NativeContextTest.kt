package com.pickandcase.assistant

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class NativeContextTest {
    @Test fun legacy_null_topic_does_not_erase_the_actual_user_request() {
        val value=contextHistory(listOf(json("uid" to 1,"isUser" to true,"topicText" to org.json.JSONObject.NULL,"text" to "旧版原始要求"))).getJSONObject(0)
        assertEquals("旧版原始要求",value.str("text"));assertEquals("旧版原始要求",value.str("userText"))
    }
    @Test fun interrupted_output_keeps_received_content_and_marks_it_incomplete() {
        val result=contextHistory(listOf(json("uid" to 1,"isError" to true,"contextPartial" to true,"original" to "已经写到第二步","text" to "已经写到第二步\n\n[网络中断]","generationError" to "网络中断"))).getJSONObject(0)
        assertTrue(result.str("text").contains("尚未完成"));assertTrue(result.str("text").contains("已经写到第二步"));assertFalse(result.str("text").contains("网络中断"));assertTrue(result.optBoolean("partial"))
    }
    @Test fun complete_user_source_preserves_pasted_documents_and_quotes() {
        val original = "产品参数：" + "完整资料".repeat(3000) + "；尾部编号 ZX-81234。"
        val message = json("uid" to 1, "isUser" to true, "topicText" to "只修改电机参数。", "text" to "界面文字", "pastedTexts" to JSONArray(listOf(original)), "_quote" to json("author" to "小李", "text" to "保留水箱"))
        val result = contextHistory(listOf(message)).getJSONObject(0)
        assertEquals("引用（小李）：保留水箱\n只修改电机参数。\n$original", result.str("text"))
        assertEquals("只修改电机参数。", result.str("userText"))
        assertFalse(result.optBoolean("clipped"))
    }
    @Test fun failed_replies_are_not_context_and_valid_citations_keep_their_source() {
        val result = contextHistory(listOf(json("uid" to 1,"text" to "故障","isError" to true),json("uid" to 2,"text" to "说明 [[aa-citation:1]]","citations" to JSONArray(listOf(json("url" to "https://example.test/source", "title" to "原资料"),json("url" to "https://secret:password@example.test/private"))))))
        assertEquals(1,result.length())
        assertTrue(result.getJSONObject(0).str("text").contains("原资料 https://example.test/source"))
        assertFalse(result.toString().contains("secret:password"))
    }
    @Test fun history_keeps_more_than_3000_messages_and_file_only_messages() {
        val messages = (1..3002).map { json("uid" to it,"isUser" to true,"topicText" to "", "text" to "", "pastedTexts" to JSONArray(listOf("原文 $it"))) }
        val result = contextHistory(messages)
        assertEquals(3002,result.length())
        assertTrue(result.getJSONObject(0).str("text").contains("原文 1"))
        assertTrue(result.getJSONObject(3001).str("text").contains("原文 3002"))
    }
    @Test fun image_references_are_inline_only_and_original_media_is_not_clipped() {
        val messages = listOf(json("isUser" to true,"imgSrcs" to JSONArray(listOf("https://external.test/image.png","data:image/png;base64,AQID"))))
        val result = contextImages(messages)
        assertEquals(1,result.length());assertEquals("AQID",result.getJSONObject(0).str("data"))
    }
    @Test fun context_explanation_discloses_summary_and_sync_failures() {
        val description=contextDescription(json("historyPolicy" to "summarized","historyCount" to 24,"summaryMessages" to 200,"commitmentCount" to 5,"memoryWarning" to "记忆暂未读取"))
        assertTrue(description.contains("200"));assertTrue(description.contains("5 条用户原文"));assertTrue(description.contains("记忆暂未读取"));assertTrue(description.contains("可能省略细节"))
    }
}
