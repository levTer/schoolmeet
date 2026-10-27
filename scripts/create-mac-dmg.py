#!/usr/bin/env python3
"""Package the EduFlow browser launcher in an HFS+/UDZO disk image.

macOS uses native hdiutil; Linux bootstrap requires mkfs.hfsplus (hfsprogs)
and the hfsplus CLI from planetbeing/libdmg-hfsplus. No pip packages needed.
See docs/mac-distribution.md. This is not a signed/notarized native client.
"""
import argparse
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
import uuid
import zlib

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = 'https://schoolmeet-vb96.onrender.com'


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def create_bundle(stage):
    app = stage / 'EduFlow.app'
    contents = app / 'Contents'
    (contents / 'MacOS').mkdir(parents=True)
    (contents / 'Resources').mkdir()
    info = dict(CFBundleName='EduFlow', CFBundleDisplayName='EduFlow',
                CFBundleIdentifier='org.eduflow.weblauncher', CFBundleVersion='2',
                CFBundleShortVersionString='0.1.1', CFBundlePackageType='APPL',
                CFBundleExecutable='EduFlow', CFBundleIconFile='EduFlow.icns',
                LSUIElement=True, NSHighResolutionCapable=True)
    (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
    launcher = contents / 'MacOS/EduFlow'
    launcher.write_text(f'#!/bin/sh\nexec /usr/bin/open "{SITE_URL}"\n')
    launcher.chmod(0o755)
    # ic09 is a standard 512x512 PNG-backed ICNS element.
    png = (ROOT / 'public/icon-512.png').read_bytes()
    assert png[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', png[16:24]) == (512, 512)
    chunk = b'ic09' + struct.pack('>I', len(png) + 8) + png
    (contents / 'Resources/EduFlow.icns').write_bytes(
        b'icns' + struct.pack('>I', len(chunk) + 8) + chunk)
    (stage / 'README.txt').write_text(
        'EduFlow for Mac - unsigned browser launcher\n\n'
        'Copy EduFlow.app to Applications and open it.\n'
        f'It automatically opens {SITE_URL} in your default browser.\n'
        'Internet access is required. This is NOT a native or offline client.\n'
        'The launcher is not signed or notarized by Apple. Gatekeeper may block it.\n'
        'Do not disable Gatekeeper globally. Safari > File > Add to Dock is an alternative.\n')
    return app


def checksum(data):
    return struct.pack('>III', 2, 32, zlib.crc32(data)) + bytes(124)


def wrap_udzo(raw, output):
    assert raw[1024:1026] == b'H+', 'Expected a real HFS+ volume'
    sectors = len(raw) // 512
    compressed = zlib.compress(raw, 9)
    # mish block map: one zlib run and a terminating run. All fields big endian.
    blkx = (struct.pack('>4sIQQQII', b'mish', 1, 0, sectors, 0, sectors, 0xfffffffe)
            + bytes(24) + checksum(raw) + struct.pack('>I', 2)
            + struct.pack('>IIQQQQ', 0x80000005, 0, 0, sectors, 0, len(compressed))
            + struct.pack('>IIQQQQ', 0xffffffff, 0, sectors, 0, len(compressed), 0))
    xml = plistlib.dumps({'resource-fork': {'blkx': [{
        'Attributes': '0x0050', 'ID': '0', 'Name': 'EduFlow (Apple_HFS : 0)', 'Data': blkx}]}})
    trailer = bytearray(512)
    struct.pack_into('>4sIIIQQQQQII', trailer, 0, b'koly', 4, 512, 1,
                     0, 0, len(compressed), 0, 0, 1, 1)
    trailer[64:80] = uuid.uuid4().bytes
    trailer[80:216] = checksum(compressed)
    struct.pack_into('>QQ', trailer, 216, len(compressed), len(xml))
    trailer[352:488] = checksum(struct.pack('>I', zlib.crc32(raw)))
    struct.pack_into('>IQ', trailer, 488, 2, sectors)
    output.write_bytes(compressed + xml + trailer)
    assert zlib.decompress(compressed) == raw
    assert output.stat().st_size > 512
    print(f'{output}: {output.stat().st_size} bytes; HFS+/UDZO round-trip OK')


def create_image(args):
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='eduflow-mac-') as tmp:
        tmp = Path(tmp)
        stage = tmp / 'stage'
        stage.mkdir()
        app = create_bundle(stage)
        if sys.platform == 'darwin':
            # hdiutil preserves bundle permissions and writes native UDIF metadata.
            (stage / 'Applications').symlink_to('/Applications')
            run('plutil', '-lint', app / 'Contents/Info.plist')
            candidate = tmp / 'eduflow.dmg'
            run('hdiutil', 'create', '-volname', 'EduFlow', '-fs', 'HFS+',
                '-srcfolder', stage, '-format', 'UDZO', '-ov', candidate)
            run('hdiutil', 'verify', candidate)
            mount = tmp / 'mounted'
            mount.mkdir()
            run('hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', mount, candidate)
            try:
                installed = mount / 'EduFlow.app/Contents'
                assert (installed / 'MacOS/EduFlow').read_bytes() == (app / 'Contents/MacOS/EduFlow').read_bytes()
                assert (installed / 'MacOS/EduFlow').stat().st_mode & 0o111
                assert (installed / 'Resources/EduFlow.icns').read_bytes() == (app / 'Contents/Resources/EduFlow.icns').read_bytes()
                run('plutil', '-lint', installed / 'Info.plist')
            finally:
                run('hdiutil', 'detach', mount)
            shutil.copyfile(candidate, output)
        else:
            if not args.mkfs_hfsplus or not args.hfsplus:
                raise SystemExit('Linux requires --mkfs-hfsplus and --hfsplus; see docs/mac-distribution.md')
            raw = tmp / 'volume.hfs'
            with raw.open('wb') as file:
                file.truncate(16 * 1024 * 1024)
            run(args.mkfs_hfsplus, '-v', 'EduFlow', raw)
            run(args.hfsplus, raw, 'addall', stage, '/')
            run(args.hfsplus, raw, 'chmod', '755', '/EduFlow.app/Contents/MacOS/EduFlow')
            run(args.hfsplus, raw, 'symlink', '/Applications', '/Applications')
            # Independently read back actual filesystem records before wrapping.
            for relative in ['Contents/Info.plist', 'Contents/MacOS/EduFlow', 'Contents/Resources/EduFlow.icns']:
                extracted = tmp / 'extracted'
                run(args.hfsplus, raw, 'extract', '/EduFlow.app/' + relative, extracted)
                assert extracted.read_bytes() == (app / relative).read_bytes()
            wrap_udzo(raw.read_bytes(), output)
    assert output.stat().st_size > 512
    print(f'Created {output} ({output.stat().st_size} bytes)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'public/eduflow.dmg')
    parser.add_argument('--mkfs-hfsplus', help='Linux only: path to mkfs.hfsplus/newfs_hfs')
    parser.add_argument('--hfsplus', help='Linux only: path to libdmg-hfsplus hfsplus CLI')
    create_image(parser.parse_args())
