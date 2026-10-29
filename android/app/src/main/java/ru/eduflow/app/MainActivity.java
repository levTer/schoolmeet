package ru.eduflow.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native home, schedule and homework lists; the remaining workspace uses WebView.
 *
 * Палитра синхронизирована с `src/styles/design-tokens.css`:
 *  • {@link #SLATE} = --bg-primary (#0B0F17);
 *  • {@link #PANEL} = --bg-card (#111827);
 *  • {@link #MUTED} = --text-secondary (#9CA3AF);
 *  • {@link #TEXT}  = --text-primary (#F9FAFB);
 *  • {@link #ACCENT} = --accent-primary темы Dark Graphite (#10B981).
 * Живая тема приходит из веба через мост AndroidApp.setStatusBarColor().
 */
public final class MainActivity extends Activity {
    /** Цвет по умолчанию для статус-бара и фона (--bg-primary). */
    static final int SLATE = Color.rgb(11, 15, 23);
    private static final int PANEL = Color.rgb(17, 24, 39);
    private static final int MUTED = Color.rgb(156, 163, 175);
    private static final int TEXT = Color.rgb(249, 250, 251);
    private static final int ACCENT = Color.rgb(16, 185, 129);
    /** Прозрачный статус-бар: контент уходит под системную панель (edge-to-edge). */
    private static final String DEFAULT_STATUS_BAR_HEX = "#0B0F17";
    private static final int REQUEST_MEDIA = 102;
    private static final int REQUEST_FILE = 103;
    private static final int REQUEST_SAVE = 104;
    private static final String[] DAYS = {"", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"};

    private enum Screen { HOME, SCHEDULE, HOMEWORK, WEB }
    private final ArrayDeque<Screen> history = new ArrayDeque<Screen>();
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private final Handler handler = new Handler();
    private FrameLayout root;
    private FrameLayout content;
    private FrameLayout splash;
    private FrameLayout fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private Screen screen = Screen.HOME;
    private WebWorkspace workspace;
    private PermissionRequest pendingMedia;
    private ValueCallback<Uri[]> fileCallback;
    private Uri pendingDownload;
    private String pendingDownloadAgent;
    private int renderVersion;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        // Никакого серого заголовка «< EduFlow»: тема NoActionBar + скрытый title.
        requestWindowFeature(Window.FEATURE_NO_TITLE);
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
        show(Screen.HOME);
        showSplashOverlay();
    }

    /**
     * Отступы edge-to-edge: статус-бар сверху, жестовая/навигационная полоса
     * снизу. Паддинг ставится на decor-view, поэтому и нативные экраны, и WebView
     * не заезжают под системные панели.
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

    private GradientDrawable surface(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(radius));
        return shape;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private Button button(String label, boolean accent, View.OnClickListener listener) {
        Button view = new Button(this);
        view.setText(label);
        view.setTextSize(15);
        view.setAllCaps(false);
        view.setMinHeight(dp(52));
        view.setTextColor(accent ? SLATE : TEXT);
        view.setBackground(surface(accent ? ACCENT : PANEL, 14));
        view.setOnClickListener(listener);
        return view;
    }

    private void addSpace(LinearLayout parent, int height) {
        View space = new View(this);
        parent.addView(space, new LinearLayout.LayoutParams(1, dp(height)));
    }

    private LinearLayout page() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(SLATE);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(22), dp(20), dp(22), dp(30));
        scroll.addView(column, new ScrollView.LayoutParams(-1, -2));
        content.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
        return column;
    }

    private void show(Screen next) {
        screen = next;
        renderVersion++;
        content.removeAllViews();
        if (next == Screen.HOME) renderHome();
        else if (next == Screen.SCHEDULE) renderList(true);
        else if (next == Screen.HOMEWORK) renderList(false);
    }

    private void navigate(Screen next) {
        if (screen == next) return;
        history.push(screen);
        show(next);
    }

    private void openWeb(String path) {
        if (!path.startsWith("/") || path.startsWith("//")) throw new IllegalArgumentException("Invalid app path");
        history.push(screen);
        screen = Screen.WEB;
        renderVersion++;
        content.removeAllViews();
        workspace = new WebWorkspace(this);
        content.addView(workspace, new FrameLayout.LayoutParams(-1, -1));
        workspace.open(EduFlowApi.ORIGIN + path);
    }

    private void renderHome() {
        final LinearLayout column = page();
        LinearLayout brand = new LinearLayout(this);
        brand.setGravity(Gravity.CENTER_VERTICAL);
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        icon.setContentDescription("EduFlow");
        brand.addView(icon, new LinearLayout.LayoutParams(dp(50), dp(50)));
        TextView title = text("EduFlow", 24, TEXT, true);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(-2, -2);
        titleParams.leftMargin = dp(12);
        brand.addView(title, titleParams);
        column.addView(brand);
        addSpace(column, 30);
        column.addView(text("ВСЁ ДЛЯ УЧЁБЫ", 12, ACCENT, true));
        addSpace(column, 9);
        column.addView(text("Учиться вместе — проще", 29, TEXT, true));
        addSpace(column, 10);
        final TextView greeting = text("Уроки, задания и расписание в одном месте.", 15, MUTED, false);
        column.addView(greeting);
        addSpace(column, 25);
        column.addView(button("Открыть личный кабинет", true, new View.OnClickListener() {
            @Override public void onClick(View view) { openWeb("/dashboard"); }
        }), new LinearLayout.LayoutParams(-1, dp(54)));
        addSpace(column, 26);
        column.addView(text("Быстрый доступ", 19, TEXT, true));
        addSpace(column, 12);
        column.addView(button("Расписание  →", false, new View.OnClickListener() {
            @Override public void onClick(View view) { navigate(Screen.SCHEDULE); }
        }), new LinearLayout.LayoutParams(-1, dp(58)));
        addSpace(column, 10);
        column.addView(button("Домашние задания  →", false, new View.OnClickListener() {
            @Override public void onClick(View view) { navigate(Screen.HOMEWORK); }
        }), new LinearLayout.LayoutParams(-1, dp(58)));
        addSpace(column, 10);
        column.addView(button("Войти в видеоурок  →", false, new View.OnClickListener() {
            @Override public void onClick(View view) { openWeb("/meeting"); }
        }), new LinearLayout.LayoutParams(-1, dp(58)));
        addSpace(column, 25);
        column.addView(text("Нужен интернет для работы с вашей школой.", 13, MUTED, false));
        final int version = renderVersion;
        request("/api/auth/session", version, new ApiCallback() {
            @Override public void success(EduFlowApi.Response response) {
                JSONObject user = response.json.optJSONObject("user");
                if (response.status == 200 && user != null) {
                    String name = user.optString("name", "").trim();
                    if (!name.isEmpty() && !"null".equals(name)) greeting.setText("Здравствуйте, " + name + "!");
                }
            }
            @Override public void failure() { /* Home remains useful offline. */ }
        });
    }

    private void renderList(final boolean schedule) {
        final LinearLayout column = page();
        column.addView(button("← Главная", false, new View.OnClickListener() {
            @Override public void onClick(View view) { handleBack(); }
        }), new LinearLayout.LayoutParams(-1, dp(48)));
        addSpace(column, 22);
        column.addView(text(schedule ? "Расписание" : "Домашние задания", 27, TEXT, true));
        addSpace(column, 8);
        column.addView(text(schedule ? "Уроки вашей школы" : "Задания, доступные вашему аккаунту", 14, MUTED, false));
        addSpace(column, 18);
        final FrameLayout result = new FrameLayout(this);
        column.addView(result, new LinearLayout.LayoutParams(-1, -2));
        ProgressBar spinner = new ProgressBar(this);
        FrameLayout.LayoutParams spinnerParams = new FrameLayout.LayoutParams(dp(36), dp(36), Gravity.CENTER);
        result.addView(spinner, spinnerParams);
        final int version = renderVersion;
        request(schedule ? "/api/schedule" : "/api/homework", version, new ApiCallback() {
            @Override public void success(EduFlowApi.Response response) {
                result.removeAllViews();
                if (response.status != 200 || !response.json.optBoolean("ok")) {
                    showListProblem(result, response.status == 401 || response.status == 403
                        ? "Войдите в аккаунт, чтобы увидеть данные школы."
                        : "Не удалось загрузить данные. Попробуйте ещё раз.", schedule);
                    return;
                }
                JSONObject data = response.json.optJSONObject("data");
                JSONArray entries = data == null ? null : data.optJSONArray(schedule ? "lessons" : "homeworks");
                if (entries == null) {
                    showListProblem(result, "Ответ сервера не содержит данных. Попробуйте ещё раз.", schedule);
                    return;
                }
                LinearLayout list = new LinearLayout(MainActivity.this);
                list.setOrientation(LinearLayout.VERTICAL);
                result.addView(list);
                if (entries.length() == 0) list.addView(text(schedule ? "Пока нет уроков." : "Пока нет заданий.", 15, MUTED, false));
                for (int i = 0; i < entries.length(); i++) {
                    JSONObject item = entries.optJSONObject(i);
                    if (item != null) addListCard(list, item, schedule);
                }
                addSpace(list, 16);
                list.addView(button(schedule ? "Открыть полное расписание" : "Открыть все задания", false, new View.OnClickListener() {
                    @Override public void onClick(View view) { openWeb(schedule ? "/schedule" : "/homework"); }
                }), new LinearLayout.LayoutParams(-1, dp(52)));
            }
            @Override public void failure() {
                result.removeAllViews();
                showListProblem(result, "Нет связи с EduFlow. Проверьте интернет и повторите попытку.", schedule);
            }
        });
    }

    private void showListProblem(FrameLayout target, String message, final boolean schedule) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.addView(text(message, 15, MUTED, false));
        addSpace(box, 16);
        box.addView(button("Повторить", true, new View.OnClickListener() {
            @Override public void onClick(View view) { show(schedule ? Screen.SCHEDULE : Screen.HOMEWORK); }
        }), new LinearLayout.LayoutParams(-1, dp(52)));
        addSpace(box, 10);
        box.addView(button("Войти в аккаунт", false, new View.OnClickListener() {
            @Override public void onClick(View view) { openWeb("/login"); }
        }), new LinearLayout.LayoutParams(-1, dp(52)));
        target.addView(box);
    }

    private void addListCard(LinearLayout list, JSONObject item, final boolean schedule) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(surface(PANEL, 16));
        JSONObject subject = item.optJSONObject("subject");
        String subjectName = subject == null ? "Урок" : subject.optString("name", "Урок");
        if (schedule) {
            int day = item.optInt("dayOfWeek");
            String dayName = day > 0 && day < DAYS.length ? DAYS[day] : "Урок";
            card.addView(text(dayName + " · " + item.optString("startTime", "") + "–" + item.optString("endTime", ""), 13, ACCENT, true));
            addSpace(card, 7);
            card.addView(text(subjectName, 18, TEXT, true));
            JSONObject teacher = item.optJSONObject("teacher");
            if (teacher != null) {
                addSpace(card, 4);
                card.addView(text(teacher.optString("name", ""), 14, MUTED, false));
            }
            final String code = item.optString("meetingCode", "");
            if (!code.isEmpty() && !"null".equals(code)) {
                addSpace(card, 12);
                card.addView(button("Открыть урок", true, new View.OnClickListener() {
                    @Override public void onClick(View view) { openWeb("/meeting/" + Uri.encode(code)); }
                }), new LinearLayout.LayoutParams(-1, dp(48)));
            }
        } else {
            card.addView(text(subjectName, 13, ACCENT, true));
            addSpace(card, 7);
            card.addView(text(item.optString("title", "Задание"), 18, TEXT, true));
            addSpace(card, 5);
            card.addView(text("Сдать до: " + formatDate(item.optString("deadline", "")), 14, MUTED, false));
            final String id = item.optString("id", "");
            if (!id.isEmpty()) {
                addSpace(card, 12);
                card.addView(button("Открыть задание", true, new View.OnClickListener() {
                    @Override public void onClick(View view) { openWeb("/homework/" + Uri.encode(id)); }
                }), new LinearLayout.LayoutParams(-1, dp(48)));
            }
        }
        list.addView(card, new LinearLayout.LayoutParams(-1, -2));
        addSpace(list, 10);
    }

    private String formatDate(String raw) {
        try {
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            parser.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date date = parser.parse(raw);
            return new SimpleDateFormat("dd.MM.yyyy HH:mm", new Locale("ru")).format(date);
        } catch (Exception ignored) {
            return raw.isEmpty() ? "—" : raw;
        }
    }

    private interface ApiCallback {
        void success(EduFlowApi.Response response);
        void failure();
    }

    private void request(final String endpoint, final int version, final ApiCallback callback) {
        final String cookie = CookieManager.getInstance().getCookie(EduFlowApi.ORIGIN);
        io.execute(new Runnable() {
            @Override public void run() {
                try {
                    final EduFlowApi.Response response = EduFlowApi.get(endpoint, cookie);
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            if (!isFinishing() && !isDestroyed() && version == renderVersion) callback.success(response);
                        }
                    });
                } catch (Exception ignored) {
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            if (!isFinishing() && !isDestroyed() && version == renderVersion) callback.failure();
                        }
                    });
                }
            }
        });
    }

    @Override public void onBackPressed() { handleBack(); }

    void handleBack() {
        if (fullscreen != null) { hideFullscreen(); return; }
        if (screen == Screen.WEB && workspace != null && workspace.canGoBack()) {
            workspace.goBack();
            return;
        }
        if (!history.isEmpty()) {
            closeWorkspace();
            show(history.pop());
            return;
        }
        // На главном экране просто сворачиваем приложение без диалога выхода.
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
        if (workspace == null || screen != Screen.WEB || !WebWorkspace.isTrusted(request.getOrigin()) || pendingMedia != null) {
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
        if (workspace == null || screen != Screen.WEB || !WebWorkspace.isTrusted(request.getOrigin())) {
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
