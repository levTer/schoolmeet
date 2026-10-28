#!/usr/bin/env bash
# Build and sign the checked-in native Android container without building Next.js.
# Requires Android SDK platform 34/build-tools, JDK, Python 3, zip and a release key.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
BUILD_TOOLS=${ANDROID_BUILD_TOOLS:-${SDK:+$SDK/build-tools/34.0.0}}
ANDROID_JAR=${ANDROID_JAR:-${SDK:+$SDK/platforms/android-34/android.jar}}
AAPT2=${AAPT2:-${BUILD_TOOLS:+$BUILD_TOOLS/aapt2}}
ZIPALIGN=${ZIPALIGN:-${BUILD_TOOLS:+$BUILD_TOOLS/zipalign}}
APKSIGNER=${APKSIGNER:-${BUILD_TOOLS:+$BUILD_TOOLS/apksigner}}
D8=${D8:-${BUILD_TOOLS:+$BUILD_TOOLS/d8}}
JAVA=${JAVA_HOME:+$JAVA_HOME/bin/}java
JAVAC=${JAVA_HOME:+$JAVA_HOME/bin/}javac
JAR=${JAVA_HOME:+$JAVA_HOME/bin/}jar
: "${ANDROID_JAR:?Set ANDROID_HOME (SDK platform 34) or ANDROID_JAR}"
: "${AAPT2:?Set AAPT2 or install Android build-tools}"
: "${ZIPALIGN:?Set ZIPALIGN or install Android build-tools}"
: "${APKSIGNER:?Set APKSIGNER or install Android build-tools}"
: "${EDUFLOW_KEYSTORE:?Set EDUFLOW_KEYSTORE to a secured signing keystore}"
: "${EDUFLOW_KS_PASS_FILE:?Set EDUFLOW_KS_PASS_FILE to a secured password file}"
KEY_ALIAS=${EDUFLOW_KEY_ALIAS:-eduflow}
for file in "$ANDROID_JAR" "$AAPT2" "$ZIPALIGN" "$APKSIGNER" "$EDUFLOW_KEYSTORE" "$EDUFLOW_KS_PASS_FILE"; do
    test -f "$file" || { echo "Missing required file: $file" >&2; exit 1; }
done

# Keep the standalone and Android Studio builds on the same application/version IDs.
python3 - "$ROOT/android/app/build.gradle" <<'PY'
import pathlib, re, sys
source = pathlib.Path(sys.argv[1]).read_text()
for pattern in (r"applicationId\s+['\"]ru\.eduflow\.app['\"]", r'compileSdk\s+34\b',
                r'minSdk\s+24\b', r'targetSdk\s+34\b', r'versionCode\s+2\b',
                r"versionName\s+['\"]1\.1\.0['\"]"):
    if not re.search(pattern, source):
        raise SystemExit('Android Gradle config does not match standalone build: ' + pattern)
PY
WORK=$(mktemp -d "${TMPDIR:-/tmp}/eduflow-android.XXXXXXXX")
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/assets" "$WORK/gen" "$WORK/classes" "$WORK/dex"
python3 "$ROOT/scripts/android-build-info.py" > "$WORK/assets/native-build.json"
# Gradle supplies namespace itself. For standalone aapt2, inject only the package.
python3 - "$ROOT/android/app/src/main/AndroidManifest.xml" "$WORK/AndroidManifest.xml" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
needle = '<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
if source.count(needle) != 1:
    raise SystemExit('Unexpected Android manifest')
pathlib.Path(sys.argv[2]).write_text(source.replace(needle, needle[:-1] + ' package="ru.eduflow.app">'))
PY
"$AAPT2" compile --no-crunch --dir "$ROOT/android/app/src/main/res" -o "$WORK/res.zip"
"$AAPT2" link -o "$WORK/resources.apk" -I "$ANDROID_JAR" --manifest "$WORK/AndroidManifest.xml" \
    --java "$WORK/gen" -A "$WORK/assets" --min-sdk-version 24 --target-sdk-version 34 \
    --version-code 2 --version-name 1.1.0 "$WORK/res.zip"
find "$ROOT/android/app/src/main/java" "$WORK/gen" -name '*.java' -print > "$WORK/sources.txt"
"$JAVAC" -encoding UTF-8 -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$WORK/classes" @"$WORK/sources.txt"
"$JAR" cf "$WORK/classes.jar" -C "$WORK/classes" .
if [[ -n "${DX_JAR:-}" ]]; then
    # Optional for older SDK installations: this project avoids Java-8 language features.
    "$JAVA" -jar "$DX_JAR" --dex --output="$WORK/dex/classes.dex" "$WORK/classes.jar"
elif [[ -n "$D8" && -x "$D8" ]]; then
    "$D8" --min-api 24 --lib "$ANDROID_JAR" --output "$WORK/dex" "$WORK/classes.jar"
else
    echo 'Install d8 or set DX_JAR to a compatible Android dx.jar.' >&2
    exit 1
fi
(cd "$WORK/dex" && zip -q "$WORK/resources.apk" classes.dex)
"$ZIPALIGN" -f -v 4 "$WORK/resources.apk" "$WORK/aligned.apk"
"$APKSIGNER" sign --ks "$EDUFLOW_KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
    --ks-pass "file:$EDUFLOW_KS_PASS_FILE" \
    --min-sdk-version 23 --v1-signing-enabled true --v2-signing-enabled true \
    --v3-signing-enabled true --v4-signing-enabled false \
    --out "$WORK/signed.apk" "$WORK/aligned.apk"
"$ZIPALIGN" -c -v 4 "$WORK/signed.apk"
"$APKSIGNER" verify --verbose --print-certs --min-sdk-version 23 "$WORK/signed.apk" | tee "$WORK/verification.txt"
expected=$(tr -d '[:space:]' < "$ROOT/android/release-certificate.sha256")
actual=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$WORK/verification.txt")
if [[ ! "$expected" =~ ^[0-9a-f]{64}$ || "$actual" != "$expected" ]]; then
    echo 'Signing certificate does not match android/release-certificate.sha256' >&2
    exit 1
fi
install -m 0644 "$WORK/signed.apk" "$ROOT/public/eduflow.apk"
echo "Built $ROOT/public/eduflow.apk"
