package com.pickandcase.assistant;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.File;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends ComponentActivity {
    WebView web;
    FrameLayout root;
    LinearLayout errorView;
    ProgressBar progress;
    final ExecutorService io=Executors.newSingleThreadExecutor();
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private ImageStore.Image pendingSave;
    private JavaScriptReplyProxy pendingSaveReply;
    private String pendingSaveId;
    private boolean imageBusy;
    private boolean destroyed;
    private boolean pageFailed;
    private final ActivityResultLauncher<Intent> picker=registerForActivityResult(new ActivityResultContracts.StartActivityForResult(),result -> {
        if (fileCallback == null) return;
        Uri[] uris=null;
        if (result.getResultCode()==Activity.RESULT_OK) {
            Intent data=result.getData();
            if (data != null && data.getClipData() != null) {
                ClipData clips=data.getClipData(); uris=new Uri[clips.getItemCount()];
                for (int i=0;i<uris.length;i++) uris[i]=clips.getItemAt(i).getUri();
            } else if (data != null && data.getData()!=null) uris=new Uri[]{data.getData()};
            else if (cameraUri != null) uris=new Uri[]{cameraUri};
        }
        fileCallback.onReceiveValue(uris); fileCallback=null; cameraUri=null;
    });
    private final ActivityResultLauncher<Intent> savePicker=registerForActivityResult(new ActivityResultContracts.StartActivityForResult(),result -> {
        ImageStore.Image image=pendingSave; JavaScriptReplyProxy reply=pendingSaveReply; String id=pendingSaveId;
        pendingSave=null;pendingSaveReply=null;pendingSaveId=null;
        if (image==null) return;
        if (result.getResultCode()!=Activity.RESULT_OK || result.getData()==null || result.getData().getData()==null) {
            imageBusy=false;reply(reply,id,false,"已取消保存");return;
        }
        Uri uri=result.getData().getData();
        io.execute(() -> {try {ImageStore.copy(this,image,uri);runOnUiThread(() -> finishImage(reply,id,null));}
            catch(Exception e){runOnUiThread(() -> finishImage(reply,id,"保存失败，请重试"));}});
    });
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(),false);
        root=new FrameLayout(this);root.setBackgroundColor(Color.WHITE);setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root,(view,insets) -> {
            Insets safe=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout()|WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left,safe.top,safe.right,safe.bottom);return WindowInsetsCompat.CONSUMED;
        });
        web=new WebView(this);web.setId(View.generateViewId());
        root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.rgb(204,120,92)));
        root.addView(progress,new FrameLayout.LayoutParams(-1,dp(2),Gravity.TOP));
        createErrorView();configureWeb();
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){handleBack();}});
        io.execute(() -> ImageStore.cleanOld(this));
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) && (state==null || web.restoreState(state)==null)) web.loadUrl(BuildConfig.SITE_URL);
    }
    private int dp(int value) {return Math.round(getResources().getDisplayMetrics().density*value);}
    private void createErrorView() {
        errorView=new LinearLayout(this);errorView.setOrientation(LinearLayout.VERTICAL);errorView.setGravity(Gravity.CENTER);errorView.setPadding(dp(28),dp(28),dp(28),dp(28));errorView.setBackgroundColor(Color.WHITE);
        TextView title=new TextView(this);title.setText("暂时无法连接");title.setTextSize(22);title.setTextColor(Color.rgb(48,48,46));
        TextView detail=new TextView(this);detail.setText("请检查网络，然后重试。");detail.setTextSize(15);detail.setPadding(0,dp(12),0,dp(20));
        Button retry=new Button(this);retry.setText("重试");retry.setOnClickListener(v -> {errorView.setVisibility(View.GONE);web.loadUrl(BuildConfig.SITE_URL);});
        errorView.addView(title);errorView.addView(detail);errorView.addView(retry);errorView.setVisibility(View.GONE);
        root.addView(errorView,new FrameLayout.LayoutParams(-1,-1));
    }
    @SuppressLint("SetJavaScriptEnabled") private void configureWeb() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSafeBrowsingEnabled(true);
        s.setSupportMultipleWindows(true);s.setJavaScriptCanOpenWindowsAutomatically(false);s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);s.setUserAgentString(s.getUserAgentString()+" PickandcaseAndroid/"+BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                if(!request.isForMainFrame())return !OriginPolicy.trusted(request.getUrl().toString());
                if(OriginPolicy.trusted(request.getUrl().toString()))return false;
                if(request.hasGesture())openExternal(request.getUrl());return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){pageFailed=false;progress.setVisibility(View.VISIBLE);}
            @Override public void onPageCommitVisible(WebView view,String url){if(OriginPolicy.trusted(url)&&!pageFailed){errorView.setVisibility(View.GONE);progress.setVisibility(View.GONE);}}
            @Override public void onReceivedError(WebView view,WebResourceRequest req,WebResourceError error){if(req.isForMainFrame())showError();}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest req,WebResourceResponse response){if(req.isForMainFrame())showError();}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();showError();}
            @Override public boolean onRenderProcessGone(WebView view,android.webkit.RenderProcessGoneDetail detail){
                root.removeView(view);view.destroy();web=null;showError();
                // Recreate only this Activity after the user chooses retry.
                ((Button)errorView.getChildAt(2)).setOnClickListener(v -> recreate());return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onProgressChanged(WebView view,int value){progress.setProgress(value);if(value==100)progress.setVisibility(View.GONE);}
            @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(!OriginPolicy.trusted(view.getUrl()))return false;
                if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
                try {
                    Intent select=params.createIntent();select.addCategory(Intent.CATEGORY_OPENABLE);
                    select.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                    Intent chooser=Intent.createChooser(select,"选择文件");
                    String[] types=params.getAcceptTypes();boolean images=types.length>0;
                    for(String type:types) if(!type.startsWith("image/"))images=false;
                    if(images) {
                        Intent camera=new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        if(camera.resolveActivity(getPackageManager())!=null){
                            File dir=new File(getCacheDir(),"shared-images");if(!dir.isDirectory())dir.mkdirs();
                            File target=File.createTempFile("camera-",".jpg",dir);
                            cameraUri=androidx.core.content.FileProvider.getUriForFile(MainActivity.this,getPackageName()+".files",target);
                            camera.putExtra(MediaStore.EXTRA_OUTPUT,cameraUri);camera.setClipData(ClipData.newRawUri("photo",cameraUri));camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS,new Intent[]{camera});
                        }
                    }
                    picker.launch(chooser);return true;
                }catch(Exception e){fileCallback.onReceiveValue(null);fileCallback=null;cameraUri=null;return true;}
            }
            @Override public boolean onCreateWindow(WebView view,boolean dialog,boolean gesture,Message result){
                if(!gesture)return false;
                WebView popup=new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest req){
                    Uri uri=req.getUrl();if(OriginPolicy.trusted(uri.toString()))web.loadUrl(uri.toString());else openExternal(uri);
                    v.post(v::destroy);return true;
                }});
                ((WebView.WebViewTransport)result.obj).setWebView(popup);result.sendToTarget();return true;
            }
        });
        web.setDownloadListener((url,userAgent,disposition,mime,length) -> {if(OriginPolicy.trusted(web.getUrl()))openExternal(Uri.parse(url));});
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web,"PickandcaseNative",Collections.singleton("https://ai.pickandcase.com"),
                (view,message,origin,mainFrame,proxy) -> {
                    if(!mainFrame||!OriginPolicy.trusted(origin.toString())||!OriginPolicy.trusted(view.getUrl()))return;
                    try {handleMessage(new JSONObject(message.getData()),proxy);}catch(Exception ignored){reply(proxy,"",false,"请求无效");}
                });
        } else {
            showError();
            ((TextView)errorView.getChildAt(0)).setText("请更新 Android System WebView");
            ((TextView)errorView.getChildAt(1)).setText("更新系统网页组件后重新打开 AI 助手。");
            ((Button)errorView.getChildAt(2)).setOnClickListener(v -> recreate());
        }
    }
    private void showError(){pageFailed=true;progress.setVisibility(View.GONE);errorView.setVisibility(View.VISIBLE);}
    private void openExternal(Uri uri){
        String scheme=uri.getScheme();
        if(!"https".equalsIgnoreCase(scheme)&&!"http".equalsIgnoreCase(scheme))return;
        try{startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));}catch(Exception ignored){}
    }
    void handleBack(){
        if(web==null){moveTaskToBack(true);return;}
        if(OriginPolicy.trusted(web.getUrl()))web.evaluateJavascript("Boolean(window.ArenaNative && ArenaNative.back())",result -> {
            if(!"true".equals(result))nativeBack();
        });else nativeBack();
    }
    private void nativeBack(){if(web!=null&&web.canGoBack())web.goBack();else moveTaskToBack(true);}
    private void handleMessage(JSONObject data,JavaScriptReplyProxy proxy){
        String id=data.optString("id"),action=data.optString("action");
        if(id.length()>32)return;
        switch(action){
            case "haptic": web.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);reply(proxy,id,true,null);break;
            case "theme":
                boolean dark=data.optBoolean("dark");root.setBackgroundColor(dark?Color.rgb(36,36,34):Color.WHITE);web.setBackgroundColor(dark?Color.rgb(36,36,34):Color.WHITE);
                WindowCompat.getInsetsController(getWindow(),root).setAppearanceLightStatusBars(!dark);
                WindowCompat.getInsetsController(getWindow(),root).setAppearanceLightNavigationBars(!dark);reply(proxy,id,true,null);break;
            case "saveImage":case "shareImage":
                if(imageBusy){reply(proxy,id,false,"请等待上一次图片操作完成");return;}
                imageBusy=true;
                io.execute(() -> {
                    try {
                        ImageStore.Image image=ImageStore.decode(this,data.optString("data"),data.optString("mime"));
                        if("saveImage".equals(action)&&Build.VERSION.SDK_INT>=29){ImageStore.save(this,image);runOnUiThread(() -> finishImage(proxy,id,null));}
                        else runOnUiThread(() -> {
                            if(destroyed)return;
                            try {
                                if("shareImage".equals(action)){
                                    Uri uri=ImageStore.shareUri(this,image);
                                    Intent intent=new Intent(Intent.ACTION_SEND).setType(image.mime).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                    intent.setClipData(ClipData.newRawUri("AI image",uri));
                                    startActivity(Intent.createChooser(intent,"分享图片"));finishImage(proxy,id,null);
                                }else{
                                    pendingSave=image;pendingSaveReply=proxy;pendingSaveId=id;
                                    savePicker.launch(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(image.mime).putExtra(Intent.EXTRA_TITLE,image.name));
                                }
                            }catch(Exception e){finishImage(proxy,id,"无法打开系统图片操作");}
                        });
                    }catch(Exception e){runOnUiThread(() -> finishImage(proxy,id,e.getMessage()==null?"图片操作失败":e.getMessage()));}
                });break;
            default:reply(proxy,id,false,"不支持的操作");
        }
    }
    private void finishImage(JavaScriptReplyProxy proxy,String id,String error){imageBusy=false;reply(proxy,id,error==null,error);}
    private void reply(JavaScriptReplyProxy proxy,String id,boolean ok,String error){
        if(destroyed||web==null)return;
        try{JSONObject value=new JSONObject();value.put("id",id);value.put("ok",ok);if(error!=null)value.put("error",error);if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))proxy.postMessage(value.toString());}catch(Exception ignored){}
    }
    @Override protected void onResume(){super.onResume();if(web!=null){web.onResume();if(OriginPolicy.trusted(web.getUrl()))web.evaluateJavascript("window.dispatchEvent(new Event('arena:resume'))",null);}}
    @Override protected void onPause(){if(web!=null)web.onPause();CookieManager.getInstance().flush();super.onPause();}
    @Override protected void onSaveInstanceState(Bundle out){if(web!=null)web.saveState(out);super.onSaveInstanceState(out);}
    @Override protected void onDestroy(){destroyed=true;if(fileCallback!=null)fileCallback.onReceiveValue(null);io.shutdown();if(web!=null){root.removeView(web);web.destroy();web=null;}super.onDestroy();}
}
