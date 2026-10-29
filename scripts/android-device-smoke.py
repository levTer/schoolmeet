#!/usr/bin/env python3
"""Small device/emulator smoke test; no real account or server access required."""
from pathlib import Path
import re
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


def wait_for(text, timeout=40, attribute='text'):
    deadline = time.monotonic() + timeout
    visible = []
    while time.monotonic() < deadline:
        try:
            tree = screen()
            visible = [node.get('text', '') for node in tree.iter('node') if node.get('text')]
            for node in tree.iter('node'):
                if node.get(attribute, '').casefold() == text.casefold():
                    return node
        except (ET.ParseError, RuntimeError):
            pass
        time.sleep(1)
    raise AssertionError(f'{STAGE}: Android UI did not show {text!r}; visible: {visible}')


def tap(text):
    bounds = wait_for(text).get('bounds', '')
    match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
    if not match:
        raise AssertionError(f'Invalid bounds for {text!r}: {bounds}')
    x1, y1, x2, y2 = map(int, match.groups())
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))


def wait_for_background(timeout=20):
    deadline = time.monotonic() + timeout
    resumed = []
    while time.monotonic() < deadline:
        activities = adb('shell', 'dumpsys', 'activity', 'activities').stdout.decode('utf-8', errors='replace')
        resumed = [line.strip() for line in activities.splitlines()
                   if 'mResumedActivity' in line or 'topResumedActivity' in line]
        if resumed and all('ru.eduflow.app' not in line for line in resumed):
            return
        time.sleep(0.5)
    raise AssertionError(f'{STAGE}: app did not move to background; resumed: {resumed}')


def main():
    global STAGE
    STAGE = 'install and first launch'
    adb('wait-for-device')
    adb('install', '-r', str(ROOT / 'public/eduflow.apk'))
    adb('shell', 'am', 'force-stop', 'ru.eduflow.app')
    adb('shell', 'am', 'start', '-W', '-n', 'ru.eduflow.app/.MainActivity')
    wait_for('Учиться вместе — проще')
    STAGE = 'native schedule'
    tap('Расписание  →')
    wait_for('Расписание')
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    wait_for('Учиться вместе — проще')
    STAGE = 'native homework'
    tap('Домашние задания  →')
    wait_for('Домашние задания')
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    wait_for('Учиться вместе — проще')
    # Wait for the workspace toolbar, not the identically named home logo.
    STAGE = 'open WebView workspace'
    tap('Открыть личный кабинет')
    wait_for('Назад', attribute='content-desc')
    STAGE = 'back from WebView workspace'
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    wait_for('Учиться вместе — проще')
    STAGE = 'native minimize (no dialog)'
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    # На главном экране «Назад» свёртывает приложение в фон тихо, без диалога.
    wait_for_background()
    STAGE = 'resume after minimize'
    adb('shell', 'am', 'start', '-W', '-n', 'ru.eduflow.app/.MainActivity')
    wait_for('Учиться вместе — проще')
    print('Android installation, native screens, hardware back and minimize: OK')


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
