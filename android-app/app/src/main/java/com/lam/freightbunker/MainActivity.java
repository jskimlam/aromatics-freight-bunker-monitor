package com.lam.freightbunker;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final String SCRIPT_BASE =
            "https://script.google.com/macros/s/AKfycbzc08bNohxOAV_iE8x8YZ7v1sOn7tyIID3xK2eoXR6vlrZOIxHBn66-sZGoKDiyF5lH/exec";
    private static final String ADMIN_URL = SCRIPT_BASE + "?page=admin";
    private static final String PUBLIC_REPORT_URL =
            "https://jskimlam.github.io/aromatics-freight-bunker-monitor/latest.html";
    private static final String CACHE_FILE = "latest_freight_dashboard.html";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private WebView webView;
    private ProgressBar progressBar;
    private TextView offline;
    private Button adminButton;
    private ValueCallback<Uri[]> filePathCallback;
    private boolean adminMode = false;
    private String pendingHtml = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.getSettings().setLoadWithOverviewMode(true);
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);
        webView.addJavascriptInterface(new AppBridge(), "FBApp");

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);

        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        );
        root.addView(webView, webParams);

        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                dp(3)
        );
        root.addView(progressBar, progressParams);

        offline = new TextView(this);
        offline.setText("데일리 리포트를 불러올 수 없습니다.\n네트워크 연결을 확인해 주세요.");
        offline.setTextColor(Color.rgb(11, 42, 107));
        offline.setTextSize(15);
        offline.setGravity(Gravity.CENTER);
        offline.setVisibility(View.GONE);
        root.addView(offline, webParams);

        adminButton = new Button(this);
        adminButton.setText("HTML 업로드");
        adminButton.setTextColor(Color.WHITE);
        adminButton.setTextSize(11);
        adminButton.setAllCaps(false);
        adminButton.setPadding(dp(12), 0, dp(12), 0);

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.rgb(11, 46, 99));
        bg.setCornerRadius(dp(12));
        adminButton.setBackground(bg);
        adminButton.setElevation(dp(5));
        adminButton.setOnClickListener(v -> {
            if (adminMode) {
                loadDashboard();
            } else {
                openAdmin();
            }
        });

        FrameLayout.LayoutParams adminParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                dp(42)
        );
        adminParams.gravity = Gravity.END | Gravity.BOTTOM;
        adminParams.setMargins(dp(10), dp(10), dp(12), dp(14));
        root.addView(adminButton, adminParams);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallbackNew,
                    FileChooserParams fileChooserParams
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = filePathCallbackNew;

                try {
                    Intent intent = fileChooserParams.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "파일 선택창을 열 수 없습니다.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                offline.setVisibility(View.GONE);
                if (adminMode) {
                    injectSheetOnlySave();
                }
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (!adminMode) {
                    offline.setVisibility(View.VISIBLE);
                }
            }
        });

        setContentView(root);
        loadDashboard();
    }

    private void openAdmin() {
        adminMode = true;
        adminButton.setText("대시보드");
        offline.setVisibility(View.GONE);
        pendingHtml = "";
        webView.loadUrl(ADMIN_URL);
    }

    private void loadDashboard() {
        adminMode = false;
        adminButton.setText("HTML 업로드");
        offline.setVisibility(View.GONE);

        String cached = readCache();
        if (cached != null && !cached.trim().isEmpty()) {
            webView.loadDataWithBaseURL(
                    PUBLIC_REPORT_URL,
                    cached,
                    "text/html",
                    "UTF-8",
                    null
            );
        } else {
            webView.loadUrl(PUBLIC_REPORT_URL);
        }
    }

    private void injectSheetOnlySave() {
        String js =
                "(function(){" +
                "try{" +
                "var sub=document.querySelector('header .sub');" +
                "if(sub)sub.textContent='APK 업로드: Google Sheet 저장 후 앱 화면에 즉시 반영됩니다.';" +
                "var warn=document.querySelector('.rules .warn');" +
                "if(warn)warn.textContent='선택한 HTML 원본을 그대로 Google Sheet에 저장하며 GitHub 발행 설정은 사용하지 않습니다.';" +
                "window.saveFile=function(){" +
                "if(!selectedFile||!selectedHtml||!selectedMeta)return;" +
                "if(!adminVerified){alert('관리자 인증을 먼저 완료해 주세요.');return;}" +
                "var btn=document.getElementById('saveBtn');" +
                "btn.disabled=true;btn.textContent='저장 중...';" +
                "google.script.run" +
                ".withSuccessHandler(function(r){" +
                "btn.textContent='Google Sheet 저장';refreshButtons();" +
                "var detail='<strong>✓ 저장 완료</strong><br>기준일: '+esc(r.date)+'<br>처리: '+(r.overwritten?'기존 동일 리포트 갱신':'신규 저장')+'<br>원본 HTML: '+(r.originalHtmlSaved?'보존 완료':'저장 확인 필요')+'<br>앱 화면: 반영 완료';" +
                "if(r.warnings&&r.warnings.length){detail+='<br><span class=\"warn\">검증 참고: '+esc(r.warnings.join(' / '))+'</span>';}" +
                "document.getElementById('resultCard').style.display='';" +
                "document.getElementById('resultBox').innerHTML=detail;" +
                "if(window.FBApp&&FBApp.onSaved){FBApp.onSaved(String(r.date||''));}" +
                "})" +
                ".withFailureHandler(function(err){" +
                "btn.textContent='Google Sheet 저장';refreshButtons();" +
                "alert(err&&err.message?err.message:String(err));" +
                "})" +
                ".saveHtmlFromAdmin({" +
                "adminPassword:password()," +
                "fileName:selectedFile.name," +
                "htmlText:selectedHtml," +
                "publishToGithub:false" +
                "});" +
                "};" +
                "}catch(e){console.error(e);}" +
                "})();";

        webView.evaluateJavascript(js, null);
    }

    private String readUriText(Uri uri) {
        try {
            InputStream input = getContentResolver().openInputStream(uri);
            if (input == null) return "";

            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(input, StandardCharsets.UTF_8)
            );
            StringBuilder sb = new StringBuilder();
            char[] buffer = new char[8192];
            int n;
            while ((n = reader.read(buffer)) > 0) {
                sb.append(buffer, 0, n);
            }
            reader.close();
            input.close();
            return sb.toString();

        } catch (Exception e) {
            return "";
        }
    }

    private void writeCache(String html) {
        if (html == null || html.trim().isEmpty()) return;

        try {
            File file = new File(getFilesDir(), CACHE_FILE);
            FileOutputStream out = new FileOutputStream(file, false);
            out.write(html.getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.close();
        } catch (Exception ignored) {
        }
    }

    private String readCache() {
        File file = new File(getFilesDir(), CACHE_FILE);
        if (!file.exists()) return "";

        try {
            FileInputStream input = new FileInputStream(file);
            InputStreamReader reader = new InputStreamReader(input, StandardCharsets.UTF_8);
            StringBuilder sb = new StringBuilder();
            char[] buffer = new char[8192];
            int n;
            while ((n = reader.read(buffer)) > 0) {
                sb.append(buffer, 0, n);
            }
            reader.close();
            input.close();
            return sb.toString();

        } catch (Exception e) {
            return "";
        }
    }

    public class AppBridge {
        @JavascriptInterface
        public void onSaved(String date) {
            runOnUiThread(() -> {
                if (pendingHtml != null && !pendingHtml.trim().isEmpty()) {
                    writeCache(pendingHtml);
                    Toast.makeText(
                            MainActivity.this,
                            (date == null || date.isEmpty() ? "리포트" : date + " 리포트") + " 저장 완료",
                            Toast.LENGTH_SHORT
                    ).show();
                    webView.postDelayed(() -> loadDashboard(), 500);
                } else {
                    Toast.makeText(
                            MainActivity.this,
                            "저장은 완료됐지만 앱 표시용 HTML 캐시를 만들지 못했습니다.",
                            Toast.LENGTH_LONG
                    ).show();
                }
            });
        }
    }

    private int dp(int value) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);

            if (results != null && results.length > 0 && results[0] != null) {
                pendingHtml = readUriText(results[0]);
            } else {
                pendingHtml = "";
            }

            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }

        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (adminMode) {
                loadDashboard();
                return true;
            }
            if (webView.canGoBack()) {
                webView.goBack();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }
}
