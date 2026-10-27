# macOS download

`public/eduflow.dmg` is a zlib-compressed UDIF (UDZO) image, not an HTML
placeholder or a renamed ZIP. It contains an ISO9660 filesystem with Joliet
and Rock Ridge names, `EduFlow.app`, and `README.txt`.

**Release limitation:** EduFlow.app is an unsigned shell/AppleScript browser
launcher, not a native or offline client. It asks for the deployment's HTTPS
URL because the repository does not configure a production website URL.
It opens that URL in the default browser. There is no signing or notarization.

## Regeneration on Linux or macOS

```sh
python3 -m venv .venv
.venv/bin/pip install pycdlib==1.22.0
.venv/bin/python scripts/create-mac-dmg.py
```

The generator constructs the actual filesystem, zlib stream, `mish` block
map, XML resource plist, CRC32 checksums, and 512-byte `koly` UDIF trailer.
It verifies a filesystem round-trip before reporting success. No Next.js
build or Prisma generation is needed. Generated timestamps/segment IDs may
change between runs.

## Verification

`npm test` checks both download anchors, the block map, decompression,
filesystem signature, launcher payload, and service-worker network bypass.
`npm run lint` checks the frontend source.

Before calling this a production macOS installer, test on a real Mac:

```sh
hdiutil verify public/eduflow.dmg
hdiutil attach -readonly public/eduflow.dmg
```

Check Finder names, copy EduFlow.app to Applications, and test opening it on
both Intel and Apple Silicon Macs. These steps were **not run** in the Linux
development environment. Gatekeeper may block the unsigned launcher; do not
disable it globally. A native signed/notarized client requires a separate
macOS packaging/release pipeline and Apple Developer credentials.
