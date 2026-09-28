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

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String SCRIPT_BASE =
            "https://script.google.com/macros/s/AKfycbzc08bNohxOAV_iE8x8YZ7v1sOn7tyIID3xK2eoXR6vlrZOIxHBn66-sZGoKDiyF5lH/exec";
    private static final String ADMIN_URL = SCRIPT_BASE + "?page=admin";
    private static final String FALLBACK_REPORT_URL =
            "https://jskimlam.github.io/aromatics-freight-bunker-monitor/latest.html";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private WebView webView;
    private ProgressBar progressBar;
    private TextView offline;
    private Button adminButton;
    private ValueCallback<Uri[]> filePathCallback;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private boolean adminMode = false;

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
        offline.setText("최신 데일리 리포트를 불러올 수 없습니다.\n네트워크 연결을 확인해 주세요.");
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
                loadLatestFromSheet();
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
                    injectSheetOnlyAdminPatch();
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
        loadLatestFromSheet();
    }

    private void openAdmin() {
        adminMode = true;
        adminButton.setText("대시보드");
        offline.setVisibility(View.GONE);
        webView.loadUrl(ADMIN_URL);
    }

    private void loadLatestFromSheet() {
        adminMode = false;
        adminButton.setText("HTML 업로드");
        offline.setVisibility(View.GONE);
        progressBar.setVisibility(View.VISIBLE);

        executor.execute(() -> {
            try {
                String listJson = httpGet(SCRIPT_BASE + "?action=listReports&limit=1");
                JSONObject listObj = new JSONObject(listJson);
                JSONArray reports = listObj.optJSONArray("reports");

                if (reports == null || reports.length() == 0) {
                    throw new IllegalStateException("저장된 리포트 없음");
                }

                String date = reports.getJSONObject(0).optString("date", "");
                if (date.isEmpty()) {
                    throw new IllegalStateException("기준일 없음");
                }

                String reportJson = httpGet(SCRIPT_BASE + "?action=getReportHtml&date=" + date);
                JSONObject reportObj = new JSONObject(reportJson);
                if (!reportObj.optBoolean("ok", false)) {
                    throw new IllegalStateException(reportObj.optString("error", "리포트 조회 실패"));
                }

                String html = reportObj.optString("htmlText", "");
                if (html.isEmpty()) {
                    throw new IllegalStateException("HTML 내용 없음");
                }

                runOnUiThread(() -> {
                    offline.setVisibility(View.GONE);
                    webView.loadDataWithBaseURL(
                            SCRIPT_BASE + "/",
                            html,
                            "text/html",
                            "UTF-8",
                            null
                    );
                });

            } catch (Exception e) {
                runOnUiThread(() -> {
                    Toast.makeText(
                            MainActivity.this,
                            "Google Sheet 최신 리포트 조회 실패 · 기존 공개 리포트 표시",
                            Toast.LENGTH_SHORT
                    ).show();
                    webView.loadUrl(FALLBACK_REPORT_URL);
                });
            }
        });
    }

    private String httpGet(String urlString) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "FB-LAM-Android");

            int code = conn.getResponseCode();
            InputStream input = (code >= 200 && code < 300)
                    ? conn.getInputStream()
                    : conn.getErrorStream();

            if (input == null) {
                throw new IllegalStateException("HTTP " + code);
            }

            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(input, StandardCharsets.UTF_8)
            );
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();

            if (code < 200 || code >= 300) {
                throw new IllegalStateException("HTTP " + code + " " + sb);
            }
            return sb.toString();

        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void injectSheetOnlyAdminPatch() {
        String js =
                "(function(){" +
                "try{" +
                "var sub=document.querySelector('header .sub');" +
                "if(sub)sub.textContent='APK에서는 Google Sheet에 저장하며 저장 직후 최신 대시보드에 반영됩니다.';" +
                "var rules=document.querySelector('.rules .warn');" +
                "if(rules)rules.textContent='업로드한 독립형 HTML 원본을 그대로 Google Sheet에 보존하고 APK 최신 화면에 반영합니다.';" +
                "window.saveFile=function(){" +
                "if(!selectedFile||!selectedHtml||!selectedMeta)return;" +
                "if(!adminVerified){alert('관리자 인증을 먼저 완료해 주세요.');return;}" +
                "var btn=document.getElementById('saveBtn');" +
                "btn.disabled=true;btn.textContent='저장 중...';" +
                "google.script.run" +
                ".withSuccessHandler(function(r){" +
                "btn.textContent='Google Sheet 저장';refreshButtons();" +
                "var detail='<strong>✓ 저장 완료</strong><br>기준일: '+esc(r.date)+'<br>처리: '+(r.overwritten?'기존 동일 리포트 갱신':'신규 저장')+'<br>원본 HTML: '+(r.originalHtmlSaved?'보존 완료':'저장 확인 필요')+'<br>APK 최신 화면: 반영 완료';" +
                "if(r.warnings&&r.warnings.length){detail+='<br><span class=\"warn\">검증 참고: '+esc(r.warnings.join(' / '))+'</span>';}" +
                "document.getElementById('resultCard').style.display='';" +
                "document.getElementById('resultBox').innerHTML=detail;" +
                "document.getElementById('resultCard').scrollIntoView({behavior:'smooth',block:'start'});" +
                "if(window.FBApp&&FBApp.onSaved){setTimeout(function(){FBApp.onSaved(String(r.date||''));},900);}" +
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

    public class AppBridge {
        @JavascriptInterface
        public void onSaved(String date) {
            runOnUiThread(() -> {
                Toast.makeText(
                        MainActivity.this,
                        (date == null || date.isEmpty() ? "리포트" : date + " 리포트") + " 저장 완료",
                        Toast.LENGTH_SHORT
                ).show();
                webView.postDelayed(() -> loadLatestFromSheet(), 1100);
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
            if (filePathCallback == null) {
                super.onActivityResult(requestCode, resultCode, data);
                return;
            }

            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
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
        executor.shutdownNow();
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (adminMode) {
                loadLatestFromSheet();
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
