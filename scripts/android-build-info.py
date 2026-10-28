#!/usr/bin/env python3
"""Canonical source fingerprint embedded into each Android APK."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def build_info():
    main = ROOT / 'android/app/src/main'
    files = sorted(path for path in main.rglob('*') if path.is_file())
    files.extend(ROOT / path for path in (
        'android/app/build.gradle', 'android/build.gradle', 'android/settings.gradle',
        'android/release-certificate.sha256', 'android/gradle/wrapper/gradle-wrapper.properties',
        'public/icon.svg', 'scripts/android-build-info.py',
        'scripts/generate-android-icons.mjs', 'scripts/build-android.sh',
    ))
    return {
        'applicationId': 'ru.eduflow.app',
        'files': {
            path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(files)
        },
    }


if __name__ == '__main__':
    json.dump(build_info(), sys.stdout, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    sys.stdout.write('\n')
