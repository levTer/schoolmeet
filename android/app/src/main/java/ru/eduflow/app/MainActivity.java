package ru.eduflow.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Полноэкранный WebView-контейнер сайта EduFlow. Приложение при запуске СРАЗУ
 * открывает сайт на весь экран (edge-to-edge) — никаких нативных экранов, меню
 * и кнопок быстрого доступа к разделам (расписание, домашние задания,
 * видеоуроки, личный кабинет) до загрузки сайта нет и быть не может.
 * Единственный нативный слой до сайта — логотип splash-заставки.
 *
 * Палитра синхронизирована с `src/styles/design-tokens.css`:
 *  • {@link #SLATE} = --bg-primary (#0B0F17).
 * Живая тема приходит из веба через мост AndroidApp.setStatusBarColor().
 */
public final class MainActivity extends Activity {
    /** Цвет по умолчанию для статус-бара и фона (--bg-primary). */
    static final int SLATE = Color.rgb(11, 15, 23);
    /** Прозрачный статус-бар: контент уходит под системную панель (edge-to-edge). */
    private static final String DEFAULT_STATUS_BAR_HEX = "#0B0F17";
    private static final int REQUEST_MEDIA = 102;
    private static final int REQUEST_FILE = 103;
    private static final int REQUEST_SAVE = 104;

    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private final Handler handler = new Handler();
    private FrameLayout root;
    private FrameLayout content;
    private FrameLayout splash;
    private FrameLayout fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private WebWorkspace workspace;
    private PermissionRequest pendingMedia;
    private ValueCallback<Uri[]> fileCallback;
    private Uri pendingDownload;
    private String pendingDownloadAgent;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        // Никакого серого заголовка «‹ EduFlow»: тема NoActionBar, заголовок
        // скрыт и программно — ActionBar не показывается ни при каких условиях.
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        if (getActionBar() != null) getActionBar().hide();
        // Edge-to-edge: контент рисуется под прозрачным статус-баром, а отступы
        // под системные панели добавляются обработчиком WindowInsets ниже.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(SLATE);
        getWindow().getDecorView().setSystemUiVisibility(0); // light icons on dark bars
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        // Isolate newer platform classes so API 24–30 can load the Activity safely.
        if (Build.VERSION.SDK_INT >= 31) Api31.installSplashExit(this);
        if (Build.VERSION.SDK_INT >= 33) Api33.installBackCallback(this);
        root = new FrameLayout(this);
        root.setBackgroundColor(SLATE);
        content = new FrameLayout(this);
        root.addView(content, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        applySystemBarInsets();
        getWindow().setBackgroundDrawable(new ColorDrawable(SLATE));
        // Прямой старт: сразу полноэкранный WebView с сайтом, без нативных экранов.
        openWorkspace();
        showSplashOverlay();
    }

    /**
     * Отступы edge-to-edge: статус-бар сверху, жестовая/навигационная полоса
     * снизу. Паддинг ставится на decor-view, поэтому WebView не заезжает под
     * системные панели.
     */
    private void applySystemBarInsets() {
        final View decor = getWindow().getDecorView();
        decor.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                int top, left, right, bottom;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets bars = Api30.systemBars(insets);
                    top = bars.top; left = bars.left; right = bars.right; bottom = bars.bottom;
                } else {
                    top = insets.getSystemWindowInsetTop();
                    left = insets.getSystemWindowInsetLeft();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                view.setPadding(left, top, right, bottom);
                return insets;
            }
        });
        decor.requestApplyInsets();
    }

    private static final class Api30 {
        static android.graphics.Insets systemBars(WindowInsets insets) {
            return insets.getInsets(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        }
    }

    /**
     * JavaScript-мост `AndroidApp` для веб-интерфейса (useTheme → syncNativeChrome).
     * Веб вызывает `window.AndroidApp.setStatusBarColor("#0B0F17")` при смене темы.
     */
    static final class AndroidBridge {
        private final MainActivity activity;

        AndroidBridge(MainActivity activity) { this.activity = activity; }

        @JavascriptInterface
        public void setStatusBarColor(final String colorHex) {
            activity.runOnUiThread(new Runnable() {
                @Override public void run() { activity.applyStatusBarColor(colorHex); }
            });
        }

        @JavascriptInterface
        public String getStatusBarColor() { return activity.statusBarColor; }

        @JavascriptInterface
        public boolean isEdgeToEdge() { return true; }
    }

    /** Текущий цвет системных панелей (hex) — для диагностики и getStatusBarColor(). */
    private volatile String statusBarColor = DEFAULT_STATUS_BAR_HEX;

    /** Перекрашивает статус-бар и панель навигации в цвет активной темы. */
    void applyStatusBarColor(String colorHex) {
        if (colorHex == null) return;
        int color;
        try {
            color = Color.parseColor(colorHex);
        } catch (IllegalArgumentException invalid) {
            return;
        }
        statusBarColor = colorHex;
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        if (root != null) root.setBackgroundColor(color);
    }

    /** Регистрирует мост в WebView (только для доверенного same-origin контента). */
    void attachJavascriptBridge(WebView web) {
        web.addJavascriptInterface(new AndroidBridge(this), "AndroidApp");
    }

    private static final class Api31 {
        static void installSplashExit(Activity activity) {
            activity.getSplashScreen().setOnExitAnimationListener(new android.window.SplashScreen.OnExitAnimationListener() {
                @Override public void onSplashScreenExit(final android.window.SplashScreenView view) {
                    view.animate().alpha(0f).setDuration(220).withEndAction(new Runnable() {
                        @Override public void run() { view.remove(); }
                    }).start();
                }
            });
        }
    }

    private static final class Api33 {
        static void installBackCallback(final MainActivity activity) {
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                new android.window.OnBackInvokedCallback() {
                    @Override public void onBackInvoked() { activity.handleBack(); }
                });
        }
    }

    private void showSplashOverlay() {
        splash = new FrameLayout(this);
        splash.setBackgroundColor(SLATE);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.splash_logo);
        logo.setContentDescription("EduFlow");
        FrameLayout.LayoutParams icon = new FrameLayout.LayoutParams(dp(176), dp(176), Gravity.CENTER);
        splash.addView(logo, icon);
        root.addView(splash, new FrameLayout.LayoutParams(-1, -1));
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                if (splash == null) return;
                final FrameLayout overlay = splash;
                overlay.animate().alpha(0f).setDuration(260).withEndAction(new Runnable() {
                    @Override public void run() {
                        root.removeView(overlay);
                        if (splash == overlay) splash = null;
                    }
                }).start();
            }
        }, 350);
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    /**
     * Прямой старт рабочего места: полноэкранный WebView открывает сайт сразу,
     * без промежуточных нативных Java-экранов, меню и кнопок «Быстрого доступа».
     */
    private void openWorkspace() {
        content.removeAllViews();
        workspace = new WebWorkspace(this);
        content.addView(workspace, new FrameLayout.LayoutParams(-1, -1));
        workspace.open(EduFlowApi.ORIGIN + "/");
    }

    @Override public void onBackPressed() { handleBack(); }

    void handleBack() {
        if (fullscreen != null) { hideFullscreen(); return; }
        if (workspace != null && workspace.canGoBack()) {
            workspace.goBack();
            return;
        }
        // Нативных экранов больше нет: «Назад» на корневой странице сайта
        // просто сворачивает приложение без диалога выхода.
        moveTaskToBack(true);
    }

    private void closeWorkspace() {
        if (pendingMedia != null) { pendingMedia.deny(); pendingMedia = null; }
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (workspace != null) {
            content.removeView(workspace);
            workspace.dispose();
            workspace = null;
        }
    }

    void requestMedia(PermissionRequest request) {
        if (workspace == null || !WebWorkspace.isTrusted(request.getOrigin()) || pendingMedia != null) {
            request.deny();
            return;
        }
        ArrayList<String> missing = new ArrayList<String>();
        for (String resource : request.getResources()) {
            String permission = mediaPermission(resource);
            if (permission != null && checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED && !missing.contains(permission)) {
                missing.add(permission);
            }
        }
        pendingMedia = request;
        if (missing.isEmpty()) finishMediaRequest();
        else requestPermissions(missing.toArray(new String[missing.size()]), REQUEST_MEDIA);
    }

    private String mediaPermission(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        return null; // Do not grant protected-media, MIDI, or unknown resources.
    }

    private void finishMediaRequest() {
        if (pendingMedia == null) return;
        PermissionRequest request = pendingMedia;
        pendingMedia = null;
        if (workspace == null || !WebWorkspace.isTrusted(request.getOrigin())) {
            request.deny();
            return;
        }
        ArrayList<String> allowed = new ArrayList<String>();
        for (String resource : request.getResources()) {
            String permission = mediaPermission(resource);
            if (permission != null && checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) allowed.add(resource);
        }
        if (allowed.isEmpty()) request.deny();
        else request.grant(allowed.toArray(new String[allowed.size()]));
    }

    void cancelMedia(PermissionRequest request) {
        if (pendingMedia == request) pendingMedia = null;
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == REQUEST_MEDIA) finishMediaRequest();
    }

    boolean chooseFiles(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        try {
            startActivityForResult(params.createIntent(), REQUEST_FILE);
            return true;
        } catch (ActivityNotFoundException e) {
            fileCallback = null;
            callback.onReceiveValue(null);
            Toast.makeText(this, "Нет приложения для выбора файла", Toast.LENGTH_SHORT).show();
            return true;
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        } else if (requestCode == REQUEST_SAVE) {
            Uri source = pendingDownload;
            String agent = pendingDownloadAgent;
            pendingDownload = null;
            pendingDownloadAgent = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && source != null) {
                copyDownload(source, data.getData(), agent);
            }
        }
    }

    /** Save via Android's document picker, without handing a session cookie to a redirecting DownloadManager. */
    void saveDownload(Uri url, String filename, String mimeType, String agent) {
        if (!WebWorkspace.isTrusted(url)) return;
        pendingDownload = url;
        pendingDownloadAgent = agent;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        try {
            startActivityForResult(intent, REQUEST_SAVE);
        } catch (ActivityNotFoundException e) {
            pendingDownload = null;
            pendingDownloadAgent = null;
            Toast.makeText(this, "Нет приложения для сохранения файла", Toast.LENGTH_SHORT).show();
        }
    }

    private void copyDownload(final Uri source, final Uri destination, final String agent) {
        final String cookie = CookieManager.getInstance().getCookie(EduFlowApi.ORIGIN);
        Toast.makeText(this, "Загрузка началась", Toast.LENGTH_SHORT).show();
        io.execute(new Runnable() {
            @Override public void run() {
                boolean success = false;
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(source.toString()).openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(30000);
                    if (cookie != null) connection.setRequestProperty("Cookie", cookie);
                    if (agent != null) connection.setRequestProperty("User-Agent", agent);
                    if (connection.getResponseCode() != 200) throw new java.io.IOException("Download failed");
                    InputStream in = connection.getInputStream();
                    try {
                        OutputStream out = getContentResolver().openOutputStream(destination, "w");
                        if (out == null) throw new java.io.IOException("Cannot open destination");
                        try {
                            byte[] buffer = new byte[16384];
                            long total = 0;
                            int count;
                            while ((count = in.read(buffer)) != -1) {
                                total += count;
                                if (total > 100L * 1024 * 1024) throw new java.io.IOException("File too large");
                                out.write(buffer, 0, count);
                            }
                            success = true;
                        } finally { out.close(); }
                    } finally { in.close(); }
                } catch (Exception ignored) {
                    try { getContentResolver().delete(destination, null, null); } catch (Exception ignoredDelete) { }
                } finally {
                    if (connection != null) connection.disconnect();
                }
                final boolean completed = success;
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (!isFinishing() && !isDestroyed()) Toast.makeText(MainActivity.this,
                            completed ? "Файл сохранён" : "Не удалось сохранить файл", Toast.LENGTH_LONG).show();
                    }
                });
            }
        });
    }

    void showFullscreen(View view, WebChromeClient.CustomViewCallback callback) {
        if (fullscreen != null) { callback.onCustomViewHidden(); return; }
        fullscreen = new FrameLayout(this);
        fullscreen.setBackgroundColor(Color.BLACK);
        fullscreen.addView(view, new FrameLayout.LayoutParams(-1, -1));
        fullscreenCallback = callback;
        root.addView(fullscreen, new FrameLayout.LayoutParams(-1, -1));
    }

    void hideFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen.removeAllViews();
        fullscreen = null;
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
    }

    @Override protected void onResume() {
        super.onResume();
        if (workspace != null) workspace.resume();
    }

    @Override protected void onPause() {
        if (workspace != null) workspace.pause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        hideFullscreen();
        closeWorkspace();
        io.shutdownNow();
        super.onDestroy();
    }
}
