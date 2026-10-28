package com.pickandcase.assistant;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ClipData;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Base64;
import android.view.MotionEvent;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewFeature;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AppRuntimeTest {
    final Instrumentation inst=InstrumentationRegistry.getInstrumentation();
    String js(ActivityScenario<MainActivity> scene,String script) throws Exception {
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        scene.onActivity(a -> a.web.evaluateJavascript(script,result -> {value.set(result);done.countDown();}));
        assertTrue("JavaScript callback",done.await(8,TimeUnit.SECONDS));return value.get();
    }
    void until(ActivityScenario<MainActivity> scene,String script) throws Exception {
        for(int i=0;i<80;i++){if("true".equals(js(scene,"Boolean("+script+")")))return;Thread.sleep(100);}
        fail("DOM condition not reached: "+script+"; login status="+js(scene,"document.getElementById('aaLoginErr')?.textContent"));
    }
    void fixture(ActivityScenario<MainActivity> scene) throws Exception {
        scene.onActivity(a -> {
            a.web.stopLoading();
            WebViewClient original=a.web.getWebViewClient();
            a.web.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest req){
                    String html="<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><body><input id='files' type='file' accept='image/*' multiple><button id='upload' onclick='files.click()'>Upload</button><script>PickandcaseNative.onmessage=e=>document.body.dataset.reply=e.data;document.body.dataset.ready='yes';</script>";
                    return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(html.getBytes()));
                }
                @Override public void onPageCommitVisible(WebView v,String url){original.onPageCommitVisible(v,url);}
            });
            a.web.loadUrl(BuildConfig.SITE_URL+"?native-fixture");
        });
        until(scene,"document.body.dataset.ready==='yes' && document.readyState==='complete'");
    }
    String image() {
        Bitmap bitmap=Bitmap.createBitmap(2,3,Bitmap.Config.ARGB_8888);bitmap.eraseColor(0xff397df5);
        ByteArrayOutputStream out=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,out);bitmap.recycle();
        return Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);
    }
    void send(ActivityScenario<MainActivity> scene,String action,String id) throws Exception {
        JSONObject msg=new JSONObject().put("id",id).put("action",action).put("mime","image/png").put("data",image());
        js(scene,"PickandcaseNative.postMessage("+JSONObject.quote(msg.toString())+")");
        until(scene,"document.body.dataset.reply && JSON.parse(document.body.dataset.reply).id==="+JSONObject.quote(id));
        assertTrue(js(scene,"document.body.dataset.reply"),"true".equals(js(scene,"JSON.parse(document.body.dataset.reply).ok")));
    }
    @Test public void nativeBridgeAndSafeWebSettings() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            fixture(scene);assertTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));
            scene.onActivity(a -> {assertTrue(a.web.getSettings().getJavaScriptEnabled());assertTrue(a.web.getSettings().getDomStorageEnabled());assertFalse(a.web.getSettings().getAllowFileAccess());});
            send(scene,"haptic","haptic");
            js(scene,"PickandcaseNative.postMessage(JSON.stringify({id:'bad',action:'unknown'}))");
            until(scene,"JSON.parse(document.body.dataset.reply).id==='bad'");assertEquals("false",js(scene,"JSON.parse(document.body.dataset.reply).ok"));
        }
    }
    @Test public void nativeSavePreservesOriginalImageBytes() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            fixture(scene);send(scene,"saveImage","save");
            scene.onActivity(a -> {
                try(android.database.Cursor cursor=a.getContentResolver().query(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,new String[]{"_id","_display_name"},"_display_name LIKE ?",new String[]{"AI-%"},"date_added DESC")){
                    assertNotNull(cursor);assertTrue(cursor.moveToFirst());
                    Uri uri=android.content.ContentUris.withAppendedId(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,cursor.getLong(0));
                    try(InputStream in=a.getContentResolver().openInputStream(uri)){
                        assertArrayEquals(Base64.decode(image(),Base64.DEFAULT),in.readAllBytes());
                    }
                    // Only the synthetic fixture created by this test is removed.
                    a.getContentResolver().delete(uri,null,null);
                }catch(Exception e){throw new AssertionError(e);}
            });
        }
    }
    @Test public void shareUsesSystemChooserAndReadOnlyContentUri() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            fixture(scene);
            Instrumentation.ActivityMonitor monitor=inst.addMonitor(new IntentFilter(Intent.ACTION_CHOOSER),new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null),true);
            try{send(scene,"shareImage","share");assertEquals(1,monitor.getHits());}finally{inst.removeMonitor(monitor);}
            scene.onActivity(a -> {
                try{ImageStore.Image file=ImageStore.decode(a,image(),"image/png");Uri uri=ImageStore.shareUri(a,file);assertEquals("content",uri.getScheme());assertEquals(a.getPackageName()+".files",uri.getAuthority());}
                catch(Exception e){throw new AssertionError(e);}
            });
        }
    }
    @Test public void systemFilePickerReturnsMultiplePhotosToWebInput() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            fixture(scene);AtomicReference<Uri> photo=new AtomicReference<>(),secondPhoto=new AtomicReference<>();
            scene.onActivity(a -> {try{photo.set(ImageStore.shareUri(a,ImageStore.decode(a,image(),"image/png")));secondPhoto.set(ImageStore.shareUri(a,ImageStore.decode(a,image(),"image/png")));}catch(Exception e){throw new AssertionError(e);}});
            Intent result=new Intent();ClipData clips=ClipData.newRawUri("first",photo.get());clips.addItem(new ClipData.Item(secondPhoto.get()));result.setClipData(clips);
            Instrumentation.ActivityMonitor monitor=inst.addMonitor(new IntentFilter(Intent.ACTION_CHOOSER),new Instrumentation.ActivityResult(Activity.RESULT_OK,result),true);
            try{tap(scene,"#upload");until(scene,"document.getElementById('files').files.length===2");assertEquals(1,monitor.getHits());}
            finally{inst.removeMonitor(monitor);}
        }
    }
    @Test public void backClosesWebSurfaceBeforeLeavingApp() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            fixture(scene);js(scene,"window.ArenaNative={back:()=>{document.body.dataset.back='handled';return true;}}");
            scene.onActivity(a -> a.getOnBackPressedDispatcher().onBackPressed());until(scene,"document.body.dataset.back==='handled'");
        }
    }
    @Test public void invalidImageNeverSavesAsGalleryFile() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            scene.onActivity(a -> {
                try{ImageStore.decode(a,"PHNjcmlwdD4=","image/png");fail("invalid image accepted");}catch(java.io.IOException expected){}
                try{ImageStore.decode(a,image(),"text/html");fail("invalid MIME accepted");}catch(java.io.IOException expected){}
            });
        }
    }
    @Test public void nativeErrorSurfaceRetriesWithoutLosingTheApp() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            java.util.concurrent.atomic.AtomicBoolean offline=new java.util.concurrent.atomic.AtomicBoolean(true);
            scene.onActivity(a -> {
                WebViewClient original=a.web.getWebViewClient();
                a.web.setWebViewClient(new WebViewClient(){
                    @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                        return new WebResourceResponse("text/html","UTF-8",offline.get()?503:200,offline.get()?"Unavailable":"OK",java.util.Collections.emptyMap(),new ByteArrayInputStream("<!doctype html><body>fixture ready</body>".getBytes()));
                    }
                    @Override public void onPageStarted(WebView v,String url,Bitmap icon){original.onPageStarted(v,url,icon);}
                    @Override public void onPageCommitVisible(WebView v,String url){original.onPageCommitVisible(v,url);}
                    @Override public void onPageFinished(WebView v,String url){
                        if(offline.get()) original.onReceivedHttpError(v,new WebResourceRequest(){
                            public Uri getUrl(){return Uri.parse(url);}public boolean isForMainFrame(){return true;}public boolean isRedirect(){return false;}public boolean hasGesture(){return false;}public String getMethod(){return "GET";}public java.util.Map<String,String> getRequestHeaders(){return java.util.Collections.emptyMap();}
                        },new WebResourceResponse("text/plain","UTF-8",503,"Unavailable",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0])));
                    }
                });
                a.web.loadUrl(BuildConfig.SITE_URL+"?offline-test");
            });
            until(scene,"document.body.textContent.includes('fixture ready')");
            inst.waitForIdleSync();Thread.sleep(200);
            scene.onActivity(a -> assertEquals(android.view.View.VISIBLE,a.errorView.getVisibility()));
            offline.set(false);scene.onActivity(a -> ((android.widget.Button)a.errorView.getChildAt(2)).performClick());
            until(scene,"document.body.textContent.includes('fixture ready')");
            inst.waitForIdleSync();Thread.sleep(200);
            scene.onActivity(a -> assertEquals(android.view.View.GONE,a.errorView.getVisibility()));
        }
    }
    void workspace(ActivityScenario<MainActivity> scene) throws Exception {
        String search="?offline-native-test="+SystemClock.elapsedRealtimeNanos();
        scene.onActivity(a -> {
            WebViewClient client=a.web.getWebViewClient();
            a.web.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest req){
                    String path=req.getUrl().getPath();
                    try{
                        if(path.startsWith("/mock-api"))return new WebResourceResponse("application/json","UTF-8",new ByteArrayInputStream("{\"ok\":true,\"chats\":[],\"projects\":[],\"memory\":\"\",\"instructions\":\"\",\"prompt\":\"\"}".getBytes()));
                        if(!OriginPolicy.trusted(req.getUrl().toString()))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                        String file=path.equals("/")?"index.html":path.substring(1);
                        String mime=file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":file.endsWith(".json")?"application/json":file.endsWith(".png")?"image/png":file.endsWith(".webp")?"image/webp":"text/html";
                        return new WebResourceResponse(mime,"UTF-8",inst.getContext().getAssets().open(file));
                    }catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
                }
                @Override public void onPageCommitVisible(WebView v,String url){client.onPageCommitVisible(v,url);}
                @Override public void onReceivedError(WebView v,WebResourceRequest r,android.webkit.WebResourceError e){client.onReceivedError(v,r,e);}
            });
            a.web.loadUrl(BuildConfig.SITE_URL+search);
        });
        until(scene,"location.search==="+JSONObject.quote(search)+" && document.getElementById('aaLoginUser') && document.documentElement.classList.contains('arena-android-app') && document.readyState==='complete'");
        js(scene,"if(document.getElementById('aaLoginOverlay').style.display!=='none'){document.getElementById('aaLoginUser').value='android-synthetic-qa';document.getElementById('aaLoginPass').value='offline-fixture';document.getElementById('aaLoginBtn').click()}");
        until(scene,"document.getElementById('aaLoginOverlay').style.display==='none'");
        // Each fixture starts in chat even when a preceding test saved image mode.
        js(scene,"document.getElementById('aaBarChatBtn').click()");
        until(scene,"!document.getElementById('ai-arena-app').classList.contains('arena-image-mode')");
    }
    @Test public void fullMobileWorkspaceDragResetKeyboardAndNoPaidTraffic() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            workspace(scene);
            assertEquals("true",js(scene,"document.documentElement.classList.contains('arena-android-app')"));
            assertEquals("false",js(scene,"document.documentElement.scrollWidth>innerWidth"));
            tap(scene,"#aaChatModelBtn");until(scene,"document.getElementById('aaEffortScale').classList.contains('is-enhanced')");
            assertEquals("false",js(scene,"Boolean(document.querySelector('.arena-effort-bolt'))"));
            JSONArray rect=new JSONArray(js(scene,"(()=>{let r=document.getElementById('aaEffortSlider').getBoundingClientRect();return [r.x,r.y,r.width,r.height,innerWidth]})()"));
            AtomicReference<Float> ratio=new AtomicReference<>();scene.onActivity(a -> ratio.set(a.web.getWidth()/(float)rect.optDouble(4)));
            float scale=ratio.get(),left=(float)rect.getDouble(0),top=(float)rect.getDouble(1),width=(float)rect.getDouble(2),height=(float)rect.getDouble(3);
            long start=SystemClock.uptimeMillis();
            // Move to a fractional position between stops while keeping the finger down.
            touch(scene,start,MotionEvent.ACTION_DOWN,(left+16+(width-32)*2/3)*scale,(top+height/2)*scale);
            touch(scene,start,MotionEvent.ACTION_MOVE,(left+16+(width-32)*.37f)*scale,(top+height/2)*scale);
            assertEquals("true",js(scene,"document.getElementById('aaEffortScale').classList.contains('is-dragging')"));
            until(scene,"Number(document.getElementById('aaEffortSlider').value)===1");
            assertEquals("1",js(scene,"Number(document.getElementById('aaEffortSlider').value)"));
            double visual=Double.parseDouble(js(scene,"new DOMMatrix(getComputedStyle(document.querySelector('.arena-effort-thumb')).transform).m41"));
            assertEquals((width-32)*.37,visual,2);
            screenshot("mobile-drag.png");
            touch(scene,start,MotionEvent.ACTION_UP,(left+16+(width-32)*.37f)*scale,(top+height/2)*scale);
            assertEquals("false",js(scene,"document.getElementById('aaResetEffortBtn').hidden"));
            js(scene,"document.getElementById('aaResetEffortBtn').click()");assertEquals("true",js(scene,"document.getElementById('aaResetEffortBtn').hidden"));
            screenshot("mobile-effort.png");
            scene.onActivity(a -> a.getOnBackPressedDispatcher().onBackPressed());until(scene,"document.getElementById('aaChatModelPop').hidden");
            double before=Double.parseDouble(js(scene,"visualViewport.height"));
            tap(scene,"#aaTopic");
            until(scene,"visualViewport.height < "+before+" - 100");
            assertEquals("true",js(scene,"document.getElementById('aaSendBtn').getBoundingClientRect().bottom<=visualViewport.height+2"));
            screenshot("mobile-keyboard.png");
        }
    }
    @Test public void imageConversationKeepsPicturesAndSignedContextAcrossEdits() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            workspace(scene);tap(scene,"#aaHistoryBtn");until(scene,"document.getElementById('aaHistoryPanel').classList.contains('open')");
            tap(scene,"#aaBarImageBtn");until(scene,"document.getElementById('ai-arena-app').classList.contains('arena-image-mode')");
            js(scene,"document.getElementById('aaHistoryClose').click()");tap(scene,"#aaImageModelBtn");
            until(scene,"document.getElementById('aaImageModelPop').classList.contains('open') && document.querySelector('#aaImageModelPop [data-value=\"gemini-nano-banana-2.1\"]')");
            tap(scene,"#aaImageModelPop [data-value='gemini-nano-banana-2.1']");
            until(scene,"document.getElementById('aaImageModelLabel').textContent.includes('Nano Banana') && !document.getElementById('aaImageModelPop').classList.contains('open')");
            js(scene,"""
                (()=>{const original=window.fetch,bytes=%s;window.qaImageRequests=[];
                  window.fetch=(url,options={})=>{
                    if(new URL(url,location.href).pathname!=='/mock-api')return original(url,options);
                    const body=JSON.parse(options.body),number=qaImageRequests.push(body),enc=new TextEncoder();
                    const events=[{modelName:body.model}];
                    if(!body.prompt.includes('MOCK_EMPTY')){
                      events.push({img:bytes,mime:'image/png'});
                      if(body.model==='gemini-nano-banana-2.1'&&!body.prompt.includes('MOCK_NO_CONTEXT'))events.push({imageContext:{parts:[{imageIndex:0,thoughtSignature:'sig-'+number}]}});
                    }
                    const first=events.map(event=>'data: '+JSON.stringify(event)+'\\n\\n').join('');
                    const stream=new ReadableStream({start(controller){controller.enqueue(enc.encode(first));
                      const finish=()=>{controller.enqueue(enc.encode('data: [DONE]\\n\\n'));controller.close()};
                      if(body.prompt.includes('MOCK_DELAY'))setTimeout(finish,1800);else finish();}});
                    return Promise.resolve(new Response(stream,{headers:{'Content-Type':'text/event-stream'}}));
                  };
                })()
            """.formatted(JSONObject.quote(image())));
            String input="document.getElementById('aaTopic')";
            js(scene,input+".value='画蓝色杯子';"+input+".dispatchEvent(new Event('input',{bubbles:true}))");tap(scene,"#aaSendBtn");
            try{until(scene,"qaImageRequests.length===1 && document.querySelectorAll('.aa-generated-image').length===1 && document.querySelectorAll('#aaImgPreview img').length===1");}
            catch(AssertionError failure){fail("First mock image state: "+js(scene,"({requests:window.qaImageRequests?.length,images:document.querySelectorAll('.aa-generated-image').length,refs:document.querySelectorAll('#aaImgPreview img').length,error:document.getElementById('aaImageError').textContent,lastError:document.querySelector('.aa-msg-body.error')?.textContent,mode:document.getElementById('aaImageTaskBtn').textContent,model:document.getElementById('aaImageModelLabel').textContent,send:document.getElementById('aaSendBtn').getAttribute('aria-label')})"));}
            assertEquals("true",js(scene,"qaImageRequests[0].imageTask==='generation' && qaImageRequests[0].images.length===0"));
            js(scene,input+".value='改成绿色';"+input+".dispatchEvent(new Event('input',{bubbles:true}))");tap(scene,"#aaSendBtn");
            until(scene,"qaImageRequests.length===2 && document.querySelectorAll('.aa-generated-image').length===2 && document.querySelectorAll('#aaImgPreview img').length===1");
            js(scene,input+".value='背景改白';"+input+".dispatchEvent(new Event('input',{bubbles:true}))");tap(scene,"#aaSendBtn");
            until(scene,"qaImageRequests.length===3 && document.querySelectorAll('.aa-generated-image').length===3 && document.querySelectorAll('#aaImgPreview img').length===1");
            assertEquals("true",js(scene,"qaImageRequests[1].imageTask==='edit' && qaImageRequests[1].images.length===1 && qaImageRequests[1].imageHistory.length===2 && qaImageRequests[1].imageHistory[1].parts[0].thoughtSignature==='sig-1'"));
            assertEquals("true",js(scene,"qaImageRequests[2].imageTask==='edit' && qaImageRequests[2].imageHistory.length===4 && qaImageRequests[2].imageHistory[3].parts[0].thoughtSignature==='sig-2'"));
            assertEquals("true",js(scene,"qaImageRequests.every(q=>!('_imgs' in q) && (!q.images||q.images.every(i=>!('preview' in i))))"));
            js(scene,input+".value='MOCK_EMPTY 再改一次';"+input+".dispatchEvent(new Event('input',{bubbles:true}))");tap(scene,"#aaSendBtn");
            until(scene,"document.querySelector('.aa-msg-body.error') && document.querySelector('.aa-msg-body.error').textContent.includes('没有返回图片')");
            assertEquals("true",js(scene,"document.querySelectorAll('#aaImgPreview img').length===1 && "+input+".value==='MOCK_EMPTY 再改一次' && !document.getElementById('aaImageError').hidden"));
            js(scene,"document.getElementById('aaImageTaskBtn').click();document.querySelector('#aaImageTaskPop [data-value=\"generation\"]').click()");
            assertEquals("0",js(scene,"document.querySelectorAll('#aaImgPreview img').length"));
            js(scene,input+".value='MOCK_DELAY 新图片';"+input+".dispatchEvent(new Event('input',{bubbles:true}))");tap(scene,"#aaSendBtn");
            until(scene,"document.querySelectorAll('.aa-generated-image').length===4 && document.getElementById('aaSendBtn').getAttribute('aria-label')==='停止生成'");
            Thread.sleep(200);assertEquals("4",js(scene,"document.querySelectorAll('.aa-generated-image').length"));
            js(scene,input+".value='待完成的修改';"+input+".dispatchEvent(new Event('input',{bubbles:true}));document.querySelectorAll('.aa-generated-btn.edit')[3].click()");
            until(scene,"document.getElementById('aaSendBtn').getAttribute('aria-label')==='发送消息'");
            assertEquals("true",js(scene,input+".value==='待完成的修改' && document.querySelectorAll('#aaImgPreview img').length===1"));
            js(scene,input+".value='MOCK_NO_CONTEXT 再改一次';"+input+".dispatchEvent(new Event('input',{bubbles:true}))");tap(scene,"#aaSendBtn");
            until(scene,"Array.from(document.querySelectorAll('.aa-msg-body.error')).some(e=>e.textContent.includes('编辑上下文未完整返回'))");
            assertEquals("5",js(scene,"document.querySelectorAll('.aa-generated-image').length"));
        }
    }
    JSONObject traceEffortTap(ActivityScenario<MainActivity> scene,int index,int max) throws Exception {
        JSONArray rect=new JSONArray(js(scene,"(()=>{let r=document.getElementById('aaEffortSlider').getBoundingClientRect();return [r.x,r.y,r.width,r.height,innerWidth]})()"));
        AtomicReference<Float> ratio=new AtomicReference<>();scene.onActivity(a -> ratio.set(a.web.getWidth()/(float)rect.optDouble(4)));
        float factor=ratio.get(),width=(float)rect.getDouble(2);
        float x=((float)rect.getDouble(0)+16+(width-32)*index/max)*factor,y=(float)(rect.getDouble(1)+rect.getDouble(3)/2)*factor;
        js(scene,"""
            (()=>{
              const label=document.getElementById('aaEffortValue'), slider=document.getElementById('aaEffortSlider');
              const trace=window.qaEffortTrace={release:null,frames:[],mutations:[]};let active=true;
              const onRelease=e=>{if(e.target.closest?.('#aaEffortScale')) trace.release=performance.now()};
              document.addEventListener('pointerup',onRelease);
              const observer=new MutationObserver(()=>trace.mutations.push(label.textContent));
              observer.observe(label,{childList:true,characterData:true,subtree:true});
              function frame(){if(!active)return;trace.frames.push({at:performance.now(),label:label.textContent,
                x:new DOMMatrix(getComputedStyle(document.querySelector('.arena-effort-thumb')).transform).m41,
                fill:new DOMMatrix(getComputedStyle(document.querySelector('.arena-effort-fill')).transform).a,
                value:slider.value,aria:slider.getAttribute('aria-valuetext'),composer:document.getElementById('aaCurrentEffort').textContent});requestAnimationFrame(frame)}
              requestAnimationFrame(frame);
              window.qaStopEffortTrace=()=>{active=false;observer.disconnect();document.removeEventListener('pointerup',onRelease);return trace};
            })()
        """);
        long start=SystemClock.uptimeMillis();touch(scene,start,MotionEvent.ACTION_DOWN,x,y);touch(scene,start,MotionEvent.ACTION_UP,x,y);
        until(scene,"qaEffortTrace.release!==null && qaEffortTrace.frames.some(f=>f.at>qaEffortTrace.release)");Thread.sleep(180);
        JSONObject trace=new JSONObject(js(scene,"qaStopEffortTrace()"));trace.put("targetX",(width-32)*index/max);trace.put("width",width);return trace;
    }
    void assertEffortTap(ActivityScenario<MainActivity> scene,int index,int max,String label,String model,String value) throws Exception {
        JSONObject trace=traceEffortTap(scene,index,max);JSONArray frames=trace.getJSONArray("frames");int afterRelease=0;
        double target=trace.getDouble("targetX"),release=trace.getDouble("release"),width=trace.getDouble("width");
        for(int i=0;i<frames.length();i++){
            JSONObject frame=frames.getJSONObject(i);if(frame.getDouble("at")<=release)continue;afterRelease++;
            assertEquals("label after release",label,frame.getString("label"));
            assertEquals("slider must not flash back after release",target,frame.getDouble("x"),2);
            assertEquals("fill must stay with thumb",(target+16)/width,frame.getDouble("fill"),.015);
            assertEquals("range and label agree",String.valueOf(index),frame.getString("value"));
            assertEquals("accessibility label agrees",label,frame.getString("aria"));
            assertEquals("composer label agrees",label,frame.getString("composer"));
        }
        assertTrue("captured rendered frames after release",afterRelease>0);
        JSONArray mutations=trace.getJSONArray("mutations");
        for(int i=0;i<mutations.length();i++)assertEquals("no stale label mutation",label,mutations.getString(i));
        assertEquals("stored provider level",JSONObject.quote(value),js(scene,"JSON.parse(localStorage.getItem('aa-effort-selection'))["+JSONObject.quote(model)+"]"));
    }
    @Test public void effortTapsNeverFlashBackToThePreviousLevel() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            workspace(scene);
            until(scene,"document.getElementById('aaWelcome')?.dataset.animationState==='playing' && document.getElementById('aaWelcomePet')?.naturalWidth>0");
            tap(scene,"#aaChatModelBtn");until(scene,"document.querySelector('.arena-effort-gesture')");tap(scene,"#aaModelPickerBtn");
            until(scene,"!document.getElementById('aaModelsSubmenu').hidden && document.querySelector('[data-arena-model=\"claude-fable-5-1\"]')");
            tap(scene,"[data-arena-model='claude-fable-5-1']");until(scene,"document.getElementById('aaEffortSlider').max==='4'");
            assertEffortTap(scene,3,4,"Extra high","claude-fable-5-1","xhigh");
            assertEffortTap(scene,1,4,"Medium","claude-fable-5-1","medium");
            assertEffortTap(scene,3,4,"Extra high","claude-fable-5-1","xhigh");
            assertEffortTap(scene,2,4,"High","claude-fable-5-1","high");
            // Interrupt an in-flight release spring with another tap.
            JSONArray rect=new JSONArray(js(scene,"(()=>{let r=document.getElementById('aaEffortSlider').getBoundingClientRect();return [r.x,r.y,r.width,r.height,innerWidth]})()"));
            AtomicReference<Float> ratio=new AtomicReference<>();scene.onActivity(a -> ratio.set(a.web.getWidth()/(float)rect.optDouble(4)));
            float factor=ratio.get(),left=(float)rect.getDouble(0),width=(float)rect.getDouble(2),y=(float)(rect.getDouble(1)+rect.getDouble(3)/2)*factor;
            long start=SystemClock.uptimeMillis();
            touch(scene,start,MotionEvent.ACTION_DOWN,(left+16+(width-32)*.5f)*factor,y);
            touch(scene,start,MotionEvent.ACTION_MOVE,(left+16+(width-32)*.63f)*factor,y);
            touch(scene,start,MotionEvent.ACTION_UP,(left+16+(width-32)*.63f)*factor,y);
            assertEffortTap(scene,1,4,"Medium","claude-fable-5-1","medium");
            JSONObject repeat=traceEffortTap(scene,1,4);
            assertEquals("selecting the same level does not replace the label",0,repeat.getJSONArray("mutations").length());
            tap(scene,"#aaModelPickerBtn");until(scene,"!document.getElementById('aaModelsSubmenu').hidden");tap(scene,"[data-arena-model='grok-4.7']");until(scene,"document.getElementById('aaEffortSlider').max==='3'");
            assertEffortTap(scene,3,3,"Extra high","grok-4.7","xhigh");
            assertEffortTap(scene,1,3,"Medium","grok-4.7","medium");
            assertEffortTap(scene,3,3,"Extra high","grok-4.7","xhigh");
            assertEffortTap(scene,2,3,"High","grok-4.7","high");
        }
    }
    @Test public void continuousDragDoesNotRestartFeedbackOrPersistBetweenFrames() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            workspace(scene);tap(scene,"#aaChatModelBtn");
            until(scene,"document.querySelector('.arena-effort-gesture')");
            js(scene,"(()=>{let original=Element.prototype.animate,store=Storage.prototype.setItem;window.qaDrag={animations:0,saves:0};Element.prototype.animate=function(...args){if(this.closest?.('#aaEffortScale'))qaDrag.animations++;return original.apply(this,args)};Storage.prototype.setItem=function(key,...args){if(key==='aa-effort-selection')qaDrag.saves++;return store.call(this,key,...args)}})()");
            JSONArray rect=new JSONArray(js(scene,"(()=>{let r=document.getElementById('aaEffortSlider').getBoundingClientRect();return [r.x,r.y,r.width,r.height,innerWidth]})()"));
            AtomicReference<Float> ratio=new AtomicReference<>();scene.onActivity(a -> ratio.set(a.web.getWidth()/(float)rect.optDouble(4)));
            float factor=ratio.get(),left=(float)rect.getDouble(0),y=(float)(rect.getDouble(1)+rect.getDouble(3)/2),width=(float)rect.getDouble(2);
            long start=SystemClock.uptimeMillis();
            touch(scene,start,MotionEvent.ACTION_DOWN,(left+16+(width-32)*.67f)*factor,y*factor);
            for(int i=0;i<24;i++){
                float fraction=.15f+.7f*i/23;
                touch(scene,start,MotionEvent.ACTION_MOVE,(left+16+(width-32)*fraction)*factor,y*factor);Thread.sleep(8);
            }
            for(int i=0;i<24;i++){
                float fraction=.85f-(.85f-.37f)*i/23;
                touch(scene,start,MotionEvent.ACTION_MOVE,(left+16+(width-32)*fraction)*factor,y*factor);Thread.sleep(8);
            }
            until(scene,"document.getElementById('aaEffortSlider').value==='1'");
            Thread.sleep(180);
            assertEquals("0",js(scene,"qaDrag.animations"));assertEquals("0",js(scene,"qaDrag.saves"));
            assertEquals(1.08,Double.parseDouble(js(scene,"new DOMMatrix(getComputedStyle(document.querySelector('.arena-effort-thumb>span')).transform).a")),.005);
            screenshot("mobile-smooth-drag.png");
            js(scene,"""
                (()=>{qaDrag.release=null;qaDrag.frames=[];document.addEventListener('pointerup',()=>qaDrag.release=performance.now(),{once:true});
                  function sample(){if(qaDrag.frames.length<80){qaDrag.frames.push({at:performance.now(),x:new DOMMatrix(getComputedStyle(document.querySelector('.arena-effort-thumb')).transform).m41});requestAnimationFrame(sample)}}requestAnimationFrame(sample)})()
            """);
            touch(scene,start,MotionEvent.ACTION_UP,(left+16+(width-32)*.37f)*factor,y*factor);
            until(scene,"qaDrag.saves===1");
            until(scene,"qaDrag.release!==null && qaDrag.frames.some(f=>f.at>qaDrag.release)");Thread.sleep(180);
            JSONObject releaseTrace=new JSONObject(js(scene,"({release:qaDrag.release,frames:qaDrag.frames})"));
            JSONArray releaseFrames=releaseTrace.getJSONArray("frames");int sampled=0;
            for(int i=0;i<releaseFrames.length();i++){
                JSONObject sample=releaseFrames.getJSONObject(i);if(sample.getDouble("at")<=releaseTrace.getDouble("release"))continue;sampled++;
                assertTrue("drag release must start at the finger, not an older stop",sample.getDouble("x")>=(width-32)/3-8 && sample.getDouble("x")<=(width-32)*.37+8);
            }
            assertTrue("sampled the release",sampled>0);
            double jump=Double.parseDouble(js(scene,"(()=>{let t=document.querySelector('.arena-effort-thumb'),before=t.getBoundingClientRect().left;ArenaEffort.sync();return t.getBoundingClientRect().left-before})()"));
            assertEquals("unrelated sync must preserve the release spring",0,jump,.1);
            assertEquals("false",js(scene,"document.getElementById('aaEffortScale').classList.contains('is-dragging')"));
            assertTrue(Integer.parseInt(js(scene,"qaDrag.animations"))<=4);
            Thread.sleep(650);
            assertEquals((width-32)/3,Double.parseDouble(js(scene,"new DOMMatrix(getComputedStyle(document.querySelector('.arena-effort-thumb')).transform).m41")),.5);
        }
    }
    @Test public void mobileImageControlsFitAndKeepModelSpecificOptions() throws Exception {
        try(ActivityScenario<MainActivity> scene=ActivityScenario.launch(MainActivity.class)){
            workspace(scene);
            tap(scene,"#aaHistoryBtn");
            until(scene,"document.getElementById('aaHistoryPanel').classList.contains('open') && document.getElementById('aaHistoryPanel').getBoundingClientRect().left>=-.5");
            tap(scene,"#aaBarImageBtn");
            until(scene,"document.getElementById('ai-arena-app').classList.contains('arena-image-mode')");
            js(scene,"document.getElementById('aaHistoryClose').click()");
            tap(scene,"#aaImageModelBtn");
            screenshot("mobile-image-before-model.png");
            until(scene,"document.querySelector('#aaImageModelPop [data-value=\"gemini-nano-banana-2.1\"]')");
            tap(scene,"#aaImageModelPop [data-value='gemini-nano-banana-2.1']");
            until(scene,"document.getElementById('aaImageModelLabel').textContent.includes('Nano Banana')");
            tap(scene,"#aaImageSettingsBtn");
            until(scene,"document.querySelector('.aa-image-settings.open')");
            assertEquals("true",js(scene,"(()=>{let r=document.querySelector('.aa-image-settings.open').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1})()"));
            assertEquals("false",js(scene,"document.documentElement.scrollWidth>innerWidth"));
            assertEquals("true",js(scene,"parseFloat(getComputedStyle(document.getElementById('aaTopic')).fontSize)>=16"));
            assertEquals("0",js(scene,"document.querySelector('.aa-image-settings.open').querySelectorAll('select').length"));
            screenshot("mobile-image-settings.png");
        }
    }
    void tap(ActivityScenario<MainActivity> scene,String selector) throws Exception {
        JSONArray r=new JSONArray(js(scene,"(()=>{let r=document.querySelector("+JSONObject.quote(selector)+").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,innerWidth]})()"));
        CountDownLatch painted=new CountDownLatch(1);
        scene.onActivity(a -> a.web.postVisualStateCallback(1,new WebView.VisualStateCallback(){@Override public void onComplete(long id){painted.countDown();}}));
        assertTrue("WebView visual state",painted.await(5,TimeUnit.SECONDS));
        AtomicReference<Float> factor=new AtomicReference<>();scene.onActivity(a -> factor.set(a.web.getWidth()/(float)r.optDouble(2)));
        float x=(float)r.getDouble(0)*factor.get(),y=(float)r.getDouble(1)*factor.get();long time=SystemClock.uptimeMillis();
        touch(scene,time,MotionEvent.ACTION_DOWN,x,y);touch(scene,time,MotionEvent.ACTION_UP,x,y);inst.waitForIdleSync();
    }
    void touch(ActivityScenario<MainActivity> scene,long start,int action,float x,float y){scene.onActivity(a -> {MotionEvent e=MotionEvent.obtain(start,SystemClock.uptimeMillis(),action,x,y,0);a.web.dispatchTouchEvent(e);e.recycle();});}
    void screenshot(String name) throws Exception {
        inst.waitForIdleSync();Thread.sleep(250);
        File file=new File(inst.getTargetContext().getExternalFilesDir(null),name);
        try(FileOutputStream out=new FileOutputStream(file)){inst.getUiAutomation().takeScreenshot().compress(Bitmap.CompressFormat.PNG,100,out);}
    }
}
