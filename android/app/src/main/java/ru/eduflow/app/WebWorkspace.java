package ru.eduflow.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.URLUtil;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Same-origin workspace for features that have not yet been ported to native UI. */
final class WebWorkspace extends LinearLayout {
    private final MainActivity activity;
    private final WebView web;
    private final FrameLayout errorOverlay;

    WebWorkspace(final MainActivity activity) {
        super(activity);
        this.activity = activity;
        setOrientation(VERTICAL);
        setBackgroundColor(MainActivity.SLATE);

        LinearLayout bar = new LinearLayout(activity);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(8), 0, dp(16), 0);
        Button back = new Button(activity);
        back.setText("‹");
        back.setTextSize(28);
        back.setTextColor(Color.WHITE);
        back.setContentDescription("Назад");
        back.setBackgroundColor(Color.TRANSPARENT);
        back.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View view) { activity.handleBack(); }
        });
        bar.addView(back, new LinearLayout.LayoutParams(dp(52), dp(52)));
        TextView label = new TextView(activity);
        label.setText("EduFlow");
        label.setTextSize(17);
        label.setTextColor(Color.WHITE);
        bar.addView(label);
        addView(bar, new LinearLayout.LayoutParams(-1, dp(52)));

        FrameLayout body = new FrameLayout(activity);
        addView(body, new LinearLayout.LayoutParams(-1, 0, 1));
        web = new WebView(activity);
        web.setBackgroundColor(MainActivity.SLATE);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        body.addView(web, new FrameLayout.LayoutParams(-1, -1));

        errorOverlay = new FrameLayout(activity);
        errorOverlay.setBackgroundColor(MainActivity.SLATE);
        LinearLayout error = new LinearLayout(activity);
        error.setOrientation(VERTICAL);
        error.setGravity(Gravity.CENTER);
        error.setPadding(dp(24), dp(24), dp(24), dp(24));
        TextView message = new TextView(activity);
        message.setText("Не удалось открыть EduFlow. Проверьте подключение к интернету.");
        message.setTextColor(Color.WHITE);
        message.setTextSize(17);
        message.setGravity(Gravity.CENTER);
        error.addView(message);
        Button retry = new Button(activity);
        retry.setText("Повторить");
        retry.setAllCaps(false);
        retry.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View view) { errorOverlay.setVisibility(GONE); web.reload(); }
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(-2, -2);
        retryParams.topMargin = dp(16);
        error.addView(retry, retryParams);
        errorOverlay.addView(error, new FrameLayout.LayoutParams(-1, -1));
        errorOverlay.setVisibility(GONE);
        body.addView(errorOverlay, new FrameLayout.LayoutParams(-1, -1));

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrusted(uri)) return false;
                if (request.isForMainFrame()) openExternal(uri);
                return true;
            }
            @SuppressWarnings("deprecation")
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (isTrusted(uri)) return false;
                openExternal(uri);
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                errorOverlay.setVisibility(GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) errorOverlay.setVisibility(VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(final PermissionRequest request) {
                activity.runOnUiThread(new Runnable() {
                    @Override public void run() { activity.requestMedia(request); }
                });
            }
            @Override public void onPermissionRequestCanceled(final PermissionRequest request) {
                activity.runOnUiThread(new Runnable() {
                    @Override public void run() { activity.cancelMedia(request); }
                });
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return activity.chooseFiles(callback, params);
            }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                activity.showFullscreen(view, callback);
            }
            @Override public void onHideCustomView() { activity.hideFullscreen(); }
        });
        web.setDownloadListener(new DownloadListener() {
            @Override public void onDownloadStart(String url, String userAgent, String disposition, String mimeType, long length) {
                download(url, userAgent, disposition, mimeType);
            }
        });
    }

    static boolean isTrusted(Uri uri) {
        if (uri == null || !uri.isHierarchical()) return false;
        String scheme = uri.getScheme();
        String host = uri.getHost();
        int port = uri.getPort();
        return "https".equalsIgnoreCase(scheme) && EduFlowApi.HOST.equalsIgnoreCase(host)
            && (port == -1 || port == 443) && uri.getUserInfo() == null;
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http")
                || scheme.equalsIgnoreCase("mailto") || scheme.equalsIgnoreCase("tel"))) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            activity.startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(activity, "Не найдено приложение для этой ссылки", Toast.LENGTH_SHORT).show();
        }
    }

    private void download(String url, String userAgent, String disposition, String mimeType) {
        Uri uri = Uri.parse(url);
        if (!isTrusted(uri)) { openExternal(uri); return; }
        String filename = URLUtil.guessFileName(url, disposition, mimeType).replaceAll("[/\\\\]", "_");
        activity.saveDownload(uri, filename, mimeType, userAgent);
    }

    void open(String url) {
        Uri uri = Uri.parse(url);
        if (!isTrusted(uri)) throw new IllegalArgumentException("Untrusted workspace URL");
        web.loadUrl(url);
    }
    boolean canGoBack() { return web.canGoBack(); }
    void goBack() { web.goBack(); }
    void resume() { web.onResume(); }
    void pause() { web.onPause(); }
    void dispose() {
        web.stopLoading();
        web.loadUrl("about:blank");
        ((ViewGroup) web.getParent()).removeView(web);
        web.destroy();
    }
}
