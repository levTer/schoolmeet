package ru.eduflow.app;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;

/**
 * Минимальный аналог `androidx.core.view.WindowCompat` без зависимости AndroidX.
 *
 * Контейнер EduFlow собирается скриптом `scripts/build-android.sh` напрямую
 * (aapt2 + javac + d8) с одним `android.jar`, поэтому AndroidX-библиотек в
 * проекте нет — но API вызова совпадает с общепринятым:
 *
 * <pre>WindowCompat.setDecorFitsSystemWindows(window, false);</pre>
 *
 * На API 30+ используется платформенный `Window.setDecorFitsSystemWindows`,
 * на API 24–29 — флаги `SYSTEM_UI_FLAG_LAYOUT_*`, которые дают тот же
 * edge-to-edge результат (прозрачный статус-бар поверх контента).
 */
final class WindowCompat {
    private WindowCompat() {}

    static void setDecorFitsSystemWindows(Window window, boolean decorFitsSystemWindows) {
        if (window == null) return;

        if (Build.VERSION.SDK_INT >= 30) {
            Api30.setDecorFitsSystemWindows(window, decorFitsSystemWindows);
        } else {
            View decor = window.getDecorView();
            int flags = decor.getSystemUiVisibility();
            int edgeToEdge = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (decorFitsSystemWindows) {
                flags &= ~edgeToEdge;
            } else {
                flags |= edgeToEdge;
            }
            decor.setSystemUiVisibility(flags);
        }

        if (!decorFitsSystemWindows) {
            window.setStatusBarColor(Color.TRANSPARENT);
        }
    }

    /** Платформенный вызов API 30+, изолирован, чтобы класс грузился на API 24. */
    private static final class Api30 {
        static void setDecorFitsSystemWindows(Window window, boolean decorFitsSystemWindows) {
            window.setDecorFitsSystemWindows(decorFitsSystemWindows);
        }
    }
}
