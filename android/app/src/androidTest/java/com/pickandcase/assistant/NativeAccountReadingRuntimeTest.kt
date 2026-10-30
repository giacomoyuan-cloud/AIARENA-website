package com.pickandcase.assistant

import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeAccountReadingRuntimeTest : NativeHarness() {
    @Test fun delete_confirmation_revokes_both_native_and_web_access_without_logging_out_owner() {
        login()
        val suffix=System.currentTimeMillis().toString()
        val id="zz-qa-delete-"+suffix
        val manager=NativeApi(base).apply { token=NativeSession(app).load()!!.token }
        runBlocking {
            repeat(21) { manager.route("users",json("username" to "qa-page-$suffix-$it","password" to "def")) }
            manager.route("users",json("username" to id,"password" to "def"))
        }
        model { it.navigate(Page.ADMIN) }
        scrollToAccount(id)
        val other=NativeApi(base)
        val token=runBlocking { other.route("login",json("username" to id,"password" to "def")).str("token") }
        other.token=token
        ui.onNodeWithTag("admin-delete-"+id).assertIsDisplayed().assertIsEnabled().performClick()
        try { waitFor("admin-delete-confirm") } catch (e:Throwable) { screenshot("native-delete-dialog-missing");ui.onRoot().printToLog("NativeAdminMissingDialog");throw e }
        ui.onNodeWithText("取消",substring=false).performClick()
        assertEquals(token,other.token)
        assertTrue(runBlocking { other.route("catalog").has("profile") })
        scrollToAccount(id)
        ui.onNodeWithTag("admin-delete-"+id).assertIsDisplayed().assertIsEnabled().performClick()
        ui.onNodeWithTag("admin-delete-confirm").performClick()
        ui.waitUntil(15000) { ui.onAllNodesWithTag("admin-delete-"+id).fetchSemanticsNodes().isEmpty() }
        val denied=runBlocking { runCatching { other.route("catalog") }.exceptionOrNull() }
        assertTrue(denied is ApiFailure && denied.status==401)
        assertTrue(NativeSession(app).load()!!.canManage)
        screenshot("native-admin-account-deleted")
    }

    private fun adminState(): AssistantState {
        var value: AssistantState?=null
        model { value=it.state.value }
        return value!!
    }
    private fun scrollToAccount(id:String) {
        ui.waitUntil(15000) { !adminState().loading && adminState().data.has("users") }
        while(adminState().data.arr("users").objects().none { it.str("accountId")==id }) {
            assertTrue("Account must be reachable through pagination",adminState().data.str("cursor").isNotBlank())
            val before=adminState().data.arr("users").length()
            ui.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("加载更多账号"))
            ui.onNodeWithText("加载更多账号").performClick()
            ui.waitUntil(15000) { adminState().data.arr("users").length()>before }
        }
        ui.onNode(hasScrollToIndexAction()).performScrollToNode(hasTestTag("admin-delete-"+id))
    }

    @Test fun a_deleted_signed_in_account_returns_to_login_with_an_explicit_reason() {
        login()
        val owner=NativeApi(base)
        owner.token=runBlocking { owner.route("login",json("username" to "qa-reader","password" to "offline-fixture")).str("token") }
        val id="qa-revoke-"+System.currentTimeMillis()
        runBlocking { owner.route("users",json("username" to id,"password" to "def")) }
        model { it.logout() };waitFor("login-submit");login(id,"def")
        runBlocking { owner.route("users",json("action" to "delete","accountId" to id)) }
        model { it.refreshSession() }
        waitFor("login-submit")
        assertNull(NativeSession(app).load())
        ui.onNodeWithText("账号已被管理员删除，请联系管理员").assertExists()
        screenshot("native-revoked-account-login")
    }

    @Test fun wide_tables_are_readable_cards_and_can_scroll_to_the_last_column() {
        val text="|编号|位置|命中片段|来源|可信度|建议改法|谁来改|替换文案|\n|---|---|---|---|---|---|---|---|\n|WA-01|共享页脚；实际匹配成功 URL|`https://example.test/very/long/path/123456789`|`audit-public-contact.php`|确认|删除元素，不替换|代码维护者|无需替换|"
        scene.onActivity { activity -> activity.setContent { MaterialTheme { Surface(Modifier.fillMaxSize()) { Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) { Markdown(text) } } } } }
        ui.onNodeWithTag("markdown-row-card-0").assertExists()
        ui.onNodeWithText("替换文案",substring=false).performScrollTo().assertIsDisplayed()
        screenshot("native-readable-table-card")
        ui.onNodeWithTag("markdown-table-view").performScrollTo().performClick()
        ui.onNodeWithTag("markdown-table-scroll").assertExists()
        val range=ui.onNodeWithTag("markdown-table-scroll").fetchSemanticsNode().config[SemanticsProperties.HorizontalScrollAxisRange]
        assertTrue(range.maxValue()>0)
        ui.onNodeWithText("替换文案",substring=false).performScrollTo().assertIsDisplayed()
        screenshot("native-wide-table-last-column")
    }

    @Test fun shipped_cat_assets_and_mascot_views_are_absent() {
        assertTrue(runCatching { app.assets.open("native-kitten.png").close() }.isFailure)
        ui.onNodeWithContentDescription("袁啾啾").assertDoesNotExist()
        login()
        ui.onNodeWithContentDescription("袁啾啾").assertDoesNotExist()
        ui.onNodeWithContentDescription("打开导航").performClick()
        ui.onNodeWithContentDescription("袁啾啾").assertDoesNotExist()
        screenshot("native-no-cat-navigation")
    }
}
