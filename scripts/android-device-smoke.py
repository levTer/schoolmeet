#!/usr/bin/env python3
"""Small device/emulator smoke test; no real account or server access required."""
from pathlib import Path
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'android-smoke-artifacts'
STAGE = 'not started'


def adb(*args, check=True):
    result = subprocess.run(['adb', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode:
        details = (result.stdout + result.stderr).decode('utf-8', errors='replace').strip()
        raise RuntimeError(f"adb {' '.join(args)} failed: {details[-1200:]}")
    return result


def screen():
    adb('shell', 'uiautomator', 'dump', '/sdcard/eduflow-window.xml')
    return ET.fromstring(adb('exec-out', 'cat', '/sdcard/eduflow-window.xml').stdout)


def wait_for_class(name, timeout=40):
    """Ждёт нативный view с указанным class (WebView стартует сразу при запуске MainActivity)."""
    deadline = time.monotonic() + timeout
    visible = []
    while time.monotonic() < deadline:
        try:
            tree = screen()
            visible = sorted({node.get('class', '') for node in tree.iter('node') if node.get('class')})
            for node in tree.iter('node'):
                if node.get('class', '') == name:
                    return node
        except (ET.ParseError, RuntimeError):
            pass
        time.sleep(1)
    raise AssertionError(f'{STAGE}: Android UI did not show class {name!r}; visible: {visible}')


def wait_for_page_load(timeout=60):
    """Ждёт, пока заставка скроется и в полноэкранном WebView отобразится загруженная страница сайта.

    WebView создаётся ещё до отрисовки контента сайта, поэтому загрузку страницы
    считаем законченной, когда WebView уже на экране, а сплэш-Overlay (logo
    с content-desc 'EduFlow') убран.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            tree = screen()
            nodes = list(tree.iter('node'))
            webview_visible = any(node.get('class') == 'android.webkit.WebView' for node in nodes)
            splash_still_showing = any(node.get('content-desc') == 'EduFlow' for node in nodes)
            if webview_visible and not splash_still_showing:
                return
        except (ET.ParseError, RuntimeError):
            pass
        time.sleep(1)
    raise AssertionError(f'{STAGE}: web page did not load in WebView within {timeout}s')


def wait_for_background(timeout=10):
    deadline = time.monotonic() + timeout
    resumed = []
    while time.monotonic() < deadline:
        activities = adb('shell', 'dumpsys', 'activity', 'activities').stdout.decode('utf-8', errors='replace')
        resumed = [line.strip() for line in activities.splitlines()
                   if 'mResumedActivity' in line or 'topResumedActivity' in line]
        # Приложение считается свёрнутым, если в фокусе launcher/home, либо
        # ru.eduflow.app больше не является текущим фокусным окном.
        launcher_focused = any(('Launcher' in line or 'HomeActivity' in line) for line in resumed)
        not_our_app = all('ru.eduflow.app' not in line for line in resumed)
        if launcher_focused or not_our_app:
            return
        time.sleep(1)
    raise AssertionError(f'{STAGE}: app did not move to background; resumed: {resumed}')


def back_until_background(presses=3):
    """«Назад»: сначала история WebView, затем тихое сворачивание без диалога.

    На корневой странице сайта MainActivity.handleBack вызывает
    moveTaskToBack(true) — приложение уходит в фон без диалога выхода.
    """
    last = None
    for _ in range(presses):
        adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        try:
            wait_for_background(timeout=6)
            return
        except AssertionError as error:
            last = error
    raise last


def main():
    global STAGE
    STAGE = 'install and first launch'
    adb('wait-for-device')
    adb('install', '-r', str(ROOT / 'public/eduflow.apk'))
    adb('shell', 'am', 'force-stop', 'ru.eduflow.app')
    adb('shell', 'am', 'start', '-W', '-n', 'ru.eduflow.app/.MainActivity')
    # Приложение сразу открывает полноэкранный WebView с сайтом:
    # никакого нативного стартового экрана «Быстрого доступа» до загрузки сайта.
    STAGE = 'direct fullscreen WebView (no native quick access)'
    wait_for_class('android.webkit.WebView')
    STAGE = 'web page loaded in WebView'
    wait_for_page_load()
    STAGE = 'hardware back minimizes (no dialog)'
    # На корневой странице сайта «Назад» сворачивает приложение в фон тихо,
    # без диалога выхода (MainActivity.handleBack → moveTaskToBack(true)).
    back_until_background()
    # Разворачиваем приложение обратно из фона перед следующей проверкой.
    adb('shell', 'am', 'start', '-n', 'ru.eduflow.app/.MainActivity')
    time.sleep(3)
    STAGE = 'resume after minimize'
    wait_for_class('android.webkit.WebView')
    print('Android installation, direct WebView start, hardware back and minimize: OK')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        ARTIFACTS.mkdir(exist_ok=True)
        (ARTIFACTS / 'screen.png').write_bytes(adb('exec-out', 'screencap', '-p', check=False).stdout)
        logcat = adb('logcat', '-d', '-t', '2000', check=False).stdout
        (ARTIFACTS / 'logcat.txt').write_bytes(logcat)
        print(str(exc), file=sys.stderr)
        # The Actions API exposes annotations even where log/artifact hosts are blocked.
        def annotation(message):
            escaped = message.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
            print('::error title=Android device smoke::' + escaped[:3500])
        annotation(str(exc))
        activities = adb('shell', 'dumpsys', 'activity', 'activities', check=False).stdout.decode('utf-8', errors='replace')
        resumed = [line.strip() for line in activities.splitlines() if 'mResumedActivity' in line or 'topResumedActivity' in line]
        if resumed:
            annotation('Activity state: ' + ' | '.join(resumed))
        errors = [line for line in logcat.decode('utf-8', errors='replace').splitlines() if ' E AndroidRuntime:' in line or 'FATAL EXCEPTION' in line]
        if errors:
            annotation('\n'.join(errors[-25:]))
        raise
