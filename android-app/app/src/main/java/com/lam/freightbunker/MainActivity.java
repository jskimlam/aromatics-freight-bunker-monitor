package com.lam.freightbunker;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

public class MainActivity extends Activity {

    private static final String HOME_URL =
            "https://jskimlam.github.io/aromatics-freight-bunker-monitor/";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private WebView webView;
    private ProgressBar progressBar;
    private ValueCallback<android.net.Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // 웹의 최신 내용을 항상 우선 사용.
        // 앞으로 리포트 목록, 관리자 버튼, UI 수정은 GitHub / Apps Script만 바꾸면 됨.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        progressBar = new ProgressBar(
                this,
                null,
                android.R.attr.progressBarStyleHorizontal
        );
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

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(
                        newProgress >= 100 ? View.GONE : View.VISIBLE
                );
            }

            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<android.net.Uri[]> newCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }

                filePathCallback = newCallback;

                try {
                    Intent intent = fileChooserParams.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;

                } catch (Exception e) {
                    filePathCallback = null;

                    Toast.makeText(
                            MainActivity.this,
                            "파일 선택창을 열 수 없습니다.",
                            Toast.LENGTH_SHORT
                    ).show();

                    return false;
                }
            }
        });

        webView.setWebViewClient(new WebViewClient());

        setContentView(root);
        openHome();
    }

    private void openHome() {
        webView.loadUrl(
                HOME_URL + "?v=" + System.currentTimeMillis()
        );
    }

    private int dp(int value) {
        float density =
                getResources().getDisplayMetrics().density;

        return Math.round(value * density);
    }

    @Override
    protected void onActivityResult(
            int requestCode,
            int resultCode,
            Intent data
    ) {
        if (requestCode == FILE_CHOOSER_REQUEST) {

            android.net.Uri[] results =
                    WebChromeClient.FileChooserParams.parseResult(
                            resultCode,
                            data
                    );

            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }

            return;
        }

        super.onActivityResult(
                requestCode,
                resultCode,
                data
        );
    }

    @Override
    public boolean onKeyDown(
            int keyCode,
            KeyEvent event
    ) {
        if (
                keyCode == KeyEvent.KEYCODE_BACK &&
                webView != null &&
                webView.canGoBack()
        ) {
            webView.goBack();
            return true;
        }

        return super.onKeyDown(
                keyCode,
                event
        );
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
}
