# EduFlow for Android

`public/eduflow.apk` is a rebuilt, signed Android application with application ID
`ru.eduflow.app`, launcher name **EduFlow**, minimum API 24 and target API 34.
The source lives in `android/`. It is not the former Chrome Trusted Web Activity.

## Scope and architecture

This is a **native Android WebView shell around the existing product, not a
native rewrite of it**. At launch the app opens the site straight away in a
restricted, edge-to-edge in-app WebView at `https://schoolmeet-vb96.onrender.com`,
the same production URL as the existing desktop clients. There are **no native
home screen, quick-access buttons or schedule/homework lists** and no native
screens before the site loads — only the splash logo fades into the WebView.
Login, editing, the existing WebRTC video lessons, chat, whiteboard, and other
features run in that WebView. An internet connection and that deployment are
required; no Next.js bundle or server/database is embedded. The package ID is
not the website hostname.

Android supplies the launch window: on API 31+ the platform SplashScreen uses
the option #9 logo and `#0B0F17`; on API 24–30 the window background provides
the same image. The splash logo overlay fades into the WebView. Status and
navigation bars use `#0B0F17`, with light icons, and are repainted live by the
web theme. The launcher includes all five densities, adaptive
icons on API 26+ and a monochrome themed icon on API 33+. PNGs are generated
from `public/icon.svg` with `npm run android:icons`.

Back closes fullscreen video first, then traverses the WebView history, and at
the root page silently moves the task to the background via `moveTaskToBack` (no
confirmation dialog).
The app declares
`CAMERA`, `RECORD_AUDIO`, and `MODIFY_AUDIO_SETTINGS`; the first two are requested
by the Android runtime only when the trusted lesson requests them. The last is a
normal install-time permission, so Android does not show a runtime dialog for
it. Only the resources actually authorized by the user are granted to WebRTC.

Only the fixed HTTPS origin is allowed inside the workspace. Other HTTP(S),
mail and telephone links open in the appropriate external app. Mixed content,
cleartext traffic, file URL access, third-party cookies and app backups are
disabled. File selection and saving use Android's document pickers; authenticated
file downloads do not forward cookies through redirects. The only
JavaScript-to-Java bridge is the read-only theme sync
(`AndroidApp.setStatusBarColor`), which repaints the system bars.

## Build, align and sign

Android Studio can open `android/`; the Gradle wrapper uses Gradle 8.7 and the
project uses Android Gradle Plugin 8.5.2. A debug build can be made with
`cd android && ./gradlew :app:assembleDebug`.

`.github/workflows/android-build.yml` runs Gradle from `android/` (that is where
`gradlew` lives). Without `EDUFLOW_KEYSTORE_B64` / `EDUFLOW_KS_PASS` it only
compiles an unsigned debug APK as a build check and publishes it as a workflow
artifact; it never replaces the committed release binary. With signing secrets,
CI first runs `./gradlew assembleRelease` as a native compile check. Both Gradle
and the standalone script embed `assets/native-build.json`; Gradle has no
`signingConfig`, so its unsigned output is never published as the release APK.
The release script then compiles, aligns, signs and verifies the distributable.

The release script independently compiles the same Java/resources with the
Android SDK tools, embeds a source fingerprint, performs `zipalign -f -v 4`,
and signs with **v1, v2 and v3 explicitly enabled**. It checks alignment,
verifies all schemes with Android `apksigner` using min SDK 23 (to exercise v1),
and rejects a signer different from `android/release-certificate.sha256` before
replacing `public/eduflow.apk`. It does not build Next.js or run Prisma.

Requirements: JDK, Android SDK platform 34, Android build-tools 34.0.0 (aapt2,
d8, zipalign, apksigner), Python 3, `zip`, and a secure keystore. Use the same
password for the keystore and its key. No private key belongs in Git.

```sh
export ANDROID_HOME=/path/to/Android/Sdk
export JAVA_HOME=/path/to/jdk
export EDUFLOW_KEYSTORE=/secure/path/eduflow-release.jks
export EDUFLOW_KS_PASS_FILE=/secure/path/password.txt
export EDUFLOW_KEY_ALIAS=eduflow
npm run android:build
npm run test:android
# Optional independent SDK verification of the exact committed binary:
"$ANDROID_HOME/build-tools/34.0.0/zipalign" -c -v 4 public/eduflow.apk
"$ANDROID_HOME/build-tools/34.0.0/apksigner" verify --verbose --print-certs \
  --min-sdk-version 23 public/eduflow.apk
```

Tool paths can also be supplied as `ANDROID_JAR`, `AAPT2`, `D8`, `ZIPALIGN`,
and `APKSIGNER`. For an older SDK, `DX_JAR` selects dx instead of d8; the native
source deliberately avoids Java 8 language features that require desugaring.
The committed 1.1.1 (versionCode 3) APK was compiled with platform 34,
aapt2 2.20, Eclipse Java compiler 3.45, D8 8.2.2-dev, AOSP zipalign and
apksigner 0.9. It was aligned and cryptographically verified with v1/v2/v3 all
true. The sandbox could not download Gradle or the Google Maven repository, so
this binary used the repository's standalone native build path, not Gradle.

## Signing continuity — action required

Neither the former TWA key nor the previous native APK key was present in this
checkout. This rebuild therefore uses another newly generated RSA-2048 key.
Existing native installations cannot upgrade in place without the previous key
or a valid signing-lineage rotation; they must be uninstalled first.

- New certificate SHA-256: `8ff609b9cdec5edb30356bf86581813de678fba8cdcda5d6810d7f84ebe39a37`
- Previous native certificate SHA-256: `719237b5918361e9507195c17d0ddecd41df87217015207428604974b40e5e47`
- Former TWA certificate SHA-256: `f2bf4b851bcb69fcb39f80070be9414014bf5dc1bfafa4c6faac218b3aaaeb75`
- APK SHA-256: `ba74a92d0356807d3778d50a0ef482f61f3a2a7350be488da9d2cfa041815f8b`

Android **will not install this APK as an update over the old TWA or previous
native APK** because its certificate differs. Without the original key, an existing installation must be
uninstalled first (which removes its local app data). If the original key exists,
use it for the release and deliberately update the pinned certificate fingerprint
before rebuilding, then verify upgrade on a device. Update the GitHub Actions
signing secrets to this new keystore/password before enabling automated release
rebuilds; an old secret will fail the pinned-certificate check. The newly generated keystore
and password file are in the ignored `.android-signing/` directory in this
workspace only. Back them up to secure release-key storage immediately; losing
this key prevents future updates to installations made with this APK. They are
never committed or sent in the PR.

## Tests

`npm test` includes `npm run test:android`; `npm run lint` checks the web code.
The Android regression needs Python 3 and OpenSSL. It checks APK ZIP integrity,
4-byte stored-entry alignment, compiled manifest identity and permissions,
native logo/splash resources and all icon densities, and that the embedded
source fingerprint matches the checkout (a stale APK fails, rather than being
skipped). It verifies the v1 PKCS#7 signature and
all manifest digests, and independently verifies both v2 and v3 RSA signatures,
the Android chunked APK content digest, and certificate consistency. Tampering
checks ensure the verifiers reject modified data. Set `APKSIGNER` to additionally
run Android's own verifier during the test.

`.github/workflows/android-smoke.yml` runs `scripts/android-device-smoke.py` on
API 26 and 34 emulators on relevant PRs. It installs the committed binary and
exercises the direct fullscreen WebView start (asserting the native
quick-access screen is gone), hardware back and silent minimize. To run it
locally, boot a device/emulator with adb and run
`python3 scripts/android-device-smoke.py`.

A real Android device/emulator is still required to validate system permission
decisions, file pickers and a live video lesson against the deployed server. These require a working Android system
image and server/account; the checks above are not a substitute for that smoke
test.
