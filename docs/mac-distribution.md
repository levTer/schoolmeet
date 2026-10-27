# macOS download

`public/eduflow.dmg` is a real zlib-compressed UDIF (UDZO) disk image with an
HFS+ filesystem. It contains:

- `EduFlow.app/Contents/Info.plist`;
- executable `Contents/MacOS/EduFlow`;
- `Contents/Resources/EduFlow.icns`, generated from `public/icon-512.png`;
- an Applications shortcut and `README.txt`.

The app automatically opens **https://schoolmeet-vb96.onrender.com** in the
default browser, without asking for an address. Copy it to Applications first.
This is an **unsigned browser launcher**, not a native or offline client.
Internet access is required. There is no Apple Developer signature or
notarization. Gatekeeper may block it; do not disable Gatekeeper globally.
Safari > File > Add to Dock remains an alternative.

## Native macOS build (recommended)

```sh
python3 scripts/create-mac-dmg.py
```

No Python dependencies are needed. The script creates the bundle and icon,
uses `hdiutil create -fs HFS+ -format UDZO`, verifies the resulting image,
mounts it read-only, checks the launcher contents/executable permissions,
Info.plist and icon, and detaches it even if a bundle check fails.
No Next.js build or Prisma generation is involved.

## GitHub Actions and shared download

`.github/workflows/build-mac-dmg.yml` runs on pushes to `main`, relevant PR
changes, and manual dispatch. Its `macos-latest` job first verifies and mounts
the committed starter image, then builds and verifies a native DMG. It uploads
the DMG and SHA-256 file as a 30-day Actions artifact. On a push to `main`, a
separate job with `contents: write` publishes/replaces the shared release assets:

https://github.com/levTer/schoolmeet/releases/download/macos-latest/eduflow.dmg

Publication runs only after successful macOS verification, not for PRs.
Repository Actions permissions must allow release creation. The first shared
release appears only after a successful run on `main`.

The website's three links intentionally remain same-origin `/eduflow.apk`,
`/eduflow.msix`, `/eduflow.dmg`, with download attributes. The website serves
the committed starter DMG; the workflow does **not** commit to `main` or silently
change the deployed file. To refresh the website's DMG with a native CI build,
download its artifact/release asset and replace `public/eduflow.dmg` in a PR.

## Linux bootstrap

The committed starter was formatted with the `newfs_hfs` CLI from
[Debian hfsprogs](https://github.com/rbrito/pkg-hfsprogs) and populated/read back
with the `hfsplus` CLI from
[libdmg-hfsplus](https://github.com/planetbeing/libdmg-hfsplus).
Install/build those tools separately; they are not vendored or run by the
application. The Linux generator fails rather than falling back to ISO9660
or generating a signature-only placeholder when the tools are missing.

```sh
python3 scripts/create-mac-dmg.py \
  --mkfs-hfsplus /path/to/newfs_hfs \
  --hfsplus /path/to/hfsplus
```

It constructs a 16 MiB HFS+ volume, populates the bundle, reads back its files,
and wraps the volume in UDZO with CRC32 checksums, a `mish` block map, XML
resource plist, and a 512-byte `koly` trailer. Temporary uncompressed images
are deleted; only the small compressed image is committed. Segment IDs and
filesystem timestamps can differ between builds.

## Validation and remaining limits

`npm test` checks direct download anchors, UDIF structure, zlib decompression,
primary/backup HFS+ signatures, bundle catalog name, automatic site URL and icon.
The service worker bypasses DMG downloads without an HTML fallback.
`npm run lint` checks frontend code.

The Linux-created image was also independently decoded using the `dmg iso`
CLI from libdmg-hfsplus; its HFS+ files and launcher were read back successfully.
The macOS workflow performs actual `hdiutil` checks when GitHub runs it; those
checks are not claimed as completed in the Linux workspace. GUI launch,
Gatekeeper behavior and opening the remote site still need testing on real
Intel and Apple Silicon Macs. Signing/notarization requires a separate release
pipeline and Apple Developer credentials.
