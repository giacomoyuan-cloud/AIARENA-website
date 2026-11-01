package com.pickandcase.assistant

import android.app.Application
import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.text.Spanned
import io.noties.markwon.image.AsyncDrawableSpan
import io.noties.markwon.ext.latex.JLatexAsyncDrawableSpan
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeUiConsistencyTest {
    @get:Rule val compose=createAndroidComposeRule<ComponentActivity>()
    private fun screenshot(name:String) {
        compose.waitForIdle()
        val bitmap=compose.onRoot().captureToImage().asAndroidBitmap()
        val target=File(compose.activity.getExternalFilesDir(null),"ui-consistency-$name.png")
        target.outputStream().use {bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
    }
    @Composable private fun Theme(dark:Boolean=false,content:@Composable ()->Unit) {
        val context=LocalContext.current
        MaterialTheme(colorScheme=if(dark)darkColorScheme(primary=WarmAccent)else lightColorScheme(primary=WarmAccent),typography=NativeTypography.typography(context)) { Surface(Modifier.fillMaxSize()){content()} }
    }
    @Test fun choiceAndButtonsRetainStateAndTouchTargets() {
        var picked by mutableStateOf("daily");var saved=false
        compose.setContent {Theme {Column(Modifier.padding(20.dp)){
            ChoiceField("执行频率",picked,listOf("daily" to "每天","weekly" to "每周")){picked=it}
            ArenaButton(onClick={saved=true},modifier=Modifier.testTag("save-role")){Text("保存")}
            Text(nativeTaskState(JSONObject().put("enabled",false).put("status","scheduled")))
        }}}
        compose.onNodeWithText("每天").performClick()
        compose.onNodeWithText("每周").performClick()
        compose.runOnIdle {assertEquals("weekly",picked)}
        compose.onNodeWithText("已暂停").assertExists()
        compose.onNodeWithTag("save-role").assertHeightIsAtLeast(44.dp).performClick()
        compose.runOnIdle {assertTrue(saved)}
        screenshot("shared-choice-buttons")
    }
    @Test fun discreteAndContinuousSlidersShareBehavior() {
        var effort by mutableStateOf("low");var brush by mutableFloatStateOf(.04f)
        compose.setContent {Theme {Column(Modifier.padding(20.dp)){
            OrderedSlider("思考深度",listOf("low" to "Low","medium" to "Medium","high" to "High"),effort){effort=it}
            Text("笔刷大小");ArenaSlider(brush,{brush=it},valueRange=.01f.. .16f,showTicks=false,modifier=Modifier.testTag("brush-slider"))
        }}}
        compose.onNodeWithTag("ordered-slider-思考深度").performSemanticsAction(SemanticsActions.SetProgress){it(2f)}
        compose.onNodeWithTag("brush-slider").performSemanticsAction(SemanticsActions.SetProgress){it(.1f)}
        compose.runOnIdle {assertEquals("high",effort);assertEquals(.1f,brush,.001f)}
        screenshot("shared-sliders")
    }
    @Test fun textAndRealFormulaRendererRemainReadable() {
        var dark by mutableStateOf(false)
        compose.setContent {Theme(dark) {Column(Modifier.padding(20.dp)){
            Text("公式和代码",style=MaterialTheme.typography.titleLarge)
            Markdown("公式 \$a^2+b^2=c^2\$，价格 \$20 / \$100。\n\n```js\nconst price = '\$20';\nconst total = 12345;\n```\n\n\\[\\sum_{i=1}^{n}i=\\frac{n(n+1)}{2}\\]")
        }}}
        compose.onNodeWithText("公式和代码").assertExists()
        fun views(view:View):List<TextView> = if(view is TextView)listOf(view) else if(view is ViewGroup)(0 until view.childCount).flatMap{views(view.getChildAt(it))} else emptyList()
        fun awaitFormulaImages() {
            compose.waitUntil(15000){
                var ready=false
                compose.runOnUiThread {
                    val rendered=views(compose.activity.window.decorView).flatMap { view ->
                        val text=view.text as? Spanned
                        text?.getSpans(0,text.length,AsyncDrawableSpan::class.java)?.filterIsInstance<JLatexAsyncDrawableSpan>()?.map{span->span.drawable.hasResult()&&span.color()==view.currentTextColor}.orEmpty()
                    }
                    ready=rendered.size>=2&&rendered.all{it}
                }
                ready
            }
        }
        awaitFormulaImages()
        screenshot("formula-code")
        compose.runOnIdle {dark=true};awaitFormulaImages();screenshot("formula-code-dark")
    }
    @Test fun wholeAppScreensUseTheSameRoles() {
        val base=InstrumentationRegistry.getArguments().getString("nativeFixtureBase")?:error("Explicit synthetic endpoint required")
        check(base.startsWith("http://127.0.0.1:")&&BuildConfig.DEBUG)
        val vm=AssistantViewModel(ApplicationProvider.getApplicationContext<Application>(),NativeApi(base))
        compose.setContent {AssistantApp(vm)}
        compose.runOnIdle {vm.login("qa-reader","offline-fixture")}
        compose.waitUntil(20000){vm.state.value.session!=null&&!vm.state.value.loading}
        compose.runOnIdle {vm.theme("light")};screenshot("app-chat-light")
        for(page in listOf(Page.PROJECTS,Page.TASKS,Page.SETTINGS)) {
            compose.runOnIdle {vm.navigate(page)}
            compose.waitUntil(15000){vm.state.value.page==page&&!vm.state.value.loading}
            screenshot("app-"+page.name.lowercase())
        }
        compose.runOnIdle {vm.theme("dark")};screenshot("app-settings-dark")
        compose.runOnIdle {vm.mode("image")};screenshot("app-image")
        compose.runOnIdle {vm.mode("debate")};screenshot("app-debate")
    }
}
