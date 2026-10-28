# Android APK repair and release signing

`public/eduflow.apk` is the existing TWA application, repackaged rather than
replaced with a placeholder. Its original `classes.dex` is preserved byte for
byte. The original APK failed `apksigner verify` with
`ERROR: Missing META-INF/MANIFEST.MF`.

## Package changes

- Application ID and resource package: `ru.eduflow.app`.
- min SDK 24; target SDK 34 (compile SDK metadata remains 36).
- Existing launcher class and MAIN/LAUNCHER intent filter preserved;
  `android:exported="true"` confirmed in the compiled manifest.
- FileProvider authority, AndroidX startup authority and signature permission
  renamed to the new application ID, avoiding collisions with the old package.
- Original fully qualified Java class names retained: renaming them in the
  manifest without rebuilding DEX would cause a launch-time class-not-found error.

## Verification performed

Android build-tools 33.0.2 `zipalign -v 4`, then `apksigner sign` with explicit
v1/v2/v3 enabled; `zipalign -c -v 4` passed on the signed output.
`apksigner verify --verbose --print-certs --min-sdk-version 23` reported all
three schemes **true**, RSA 2048, with a SHA256withRSA certificate. The verification
SDK override exercises v1 too (normal verification starting at min SDK 24 uses
v2/v3 and reports v1 as unused). V1-only verification warns about upstream
META-INF version/build metadata; v2/v3 protect the complete APK.

Certificate SHA-256:
`f2bf4b851bcb69fcb39f80070be9414014bf5dc1bfafa4c6faac218b3aaaeb75`

APK SHA-256:
`5b88894b37f7d4fea0db202bbabcd3b98209d95a24ae75270ef06bc75855c2ca`

`npm test` and `npm run lint` passed. The Android regression runs as part of
`npm test` (or `npm run test:android`) and requires Python 3. It checks ZIP CRCs,
required files, stored-entry alignment, compiled manifest settings and launcher,
v1 certificate/signature files and v2/v3 signing-block structures. Structural
checks do not replace cryptographic verification with Android's `apksigner`.
The repaired APK was also decoded independently with apktool to check its
manifest and resource authority. No physical device/emulator installation was
available; device installation and launch are still a release smoke test.

## Reproduce with Android SDK build-tools and a JDK

```sh
python3 scripts/repack-android.py input.apk unsigned.apk
zipalign -f -v 4 unsigned.apk aligned.apk
# KEYSTORE and KS_PASSWORD_FILE refer to securely stored release material.
apksigner sign --ks "$KEYSTORE" --ks-key-alias eduflow \
  --ks-pass "file:$KS_PASSWORD_FILE" \
  --v1-signing-enabled true --v2-signing-enabled true \
  --v3-signing-enabled true --v4-signing-enabled false \
  --out public/eduflow.apk aligned.apk
zipalign -c -v 4 public/eduflow.apk
apksigner verify --verbose --print-certs --min-sdk-version 23 public/eduflow.apk
npm run test:android
```

A new release keystore was generated using `keytool -genkeypair -keyalg RSA
-keysize 2048 -sigalg SHA256withRSA -validity 10000`, alias `eduflow`.
The local keystore and its randomly generated password file are in the ignored,
permission-restricted `.android-signing/` directory. **Back them up into secure
release-key storage before discarding this workspace.** Neither is committed.
Future updates to `ru.eduflow.app` must use this same key; another certificate
would require uninstalling the installed app first.

This remains a web-backed TWA and uses the original website URL. For verified
full-screen TWA behavior, the website's `/.well-known/assetlinks.json` must list
`ru.eduflow.app` and the new certificate SHA-256 above. That server-side
association is separate from APK installability and is not changed here.
