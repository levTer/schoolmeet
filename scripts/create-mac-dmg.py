#!/usr/bin/env python3
"""Create a real UDZO image with an ISO9660/Joliet/Rock Ridge filesystem.

Requires Python 3 and pycdlib==1.22.0 (install in a virtual environment).
No macOS tools, application build, or Prisma generation are involved.
The payload is an unsigned browser launcher, NOT a native/offline client.
"""
import io
from pathlib import Path
import plistlib
import struct
import uuid
import zlib

import pycdlib

ROOT = Path(__file__).resolve().parent.parent


def checksum(data):
    return struct.pack('>III', 2, 32, zlib.crc32(data)) + bytes(124)


def create_image():
    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=3, vol_ident='EDUFLOW', joliet=3, rock_ridge='1.09')
    for path, rr in [('/EDUFLOW_APP', 'EduFlow.app'),
                     ('/EDUFLOW_APP/CONTENTS', 'Contents'),
                     ('/EDUFLOW_APP/CONTENTS/MACOS', 'MacOS')]:
        joliet = path.replace('EDUFLOW_APP', 'EduFlow.app').replace('CONTENTS', 'Contents').replace('MACOS', 'MacOS')
        iso.add_directory(iso_path=path, rr_name=rr, joliet_path=joliet)

    def add(path, name, joliet, data, mode=0o100644):
        iso.add_fp(io.BytesIO(data), len(data), iso_path=path, rr_name=name,
                   joliet_path=joliet, file_mode=mode)

    info = plistlib.dumps(dict(CFBundleName='EduFlow', CFBundleDisplayName='EduFlow',
        CFBundleIdentifier='org.eduflow.weblauncher', CFBundleVersion='1',
        CFBundleShortVersionString='0.1.0', CFBundlePackageType='APPL',
        CFBundleExecutable='EduFlow', LSUIElement=True))
    add('/EDUFLOW_APP/CONTENTS/INFO.PLIST;1', 'Info.plist', '/EduFlow.app/Contents/Info.plist', info)
    launcher = b'''#!/bin/sh
exec /usr/bin/osascript <<'APPLESCRIPT'
try
    set siteURL to text returned of (display dialog "Enter your EduFlow HTTPS website address:" default answer "https://" with title "EduFlow" buttons {"Cancel", "Open"} default button "Open")
    if siteURL does not start with "https://" or (length of siteURL) < 9 then
        display alert "Please enter a valid HTTPS website address."
        return
    end if
    open location siteURL
on error number -128
    return
end try
APPLESCRIPT
'''
    add('/EDUFLOW_APP/CONTENTS/MACOS/EDUFLOW;1', 'EduFlow', '/EduFlow.app/Contents/MacOS/EduFlow', launcher, 0o100755)
    readme = b'''EduFlow for Mac - browser launcher (unsigned)

Copy EduFlow.app to Applications, then open it and enter the HTTPS address
of your school's EduFlow deployment. Internet access is required.
This package opens the web app in your default browser; it is NOT a native
or offline client. No production deployment URL was supplied with the source.
For a browser-managed installation use Safari > File > Add to Dock instead.

This disk image is not signed or notarized. macOS launch/mount testing is
required before a production release. Do not disable Gatekeeper globally.
'''
    add('/README.TXT;1', 'README.txt', '/README.txt', readme)
    raw = io.BytesIO()
    iso.write_fp(raw)
    iso.close()
    raw = raw.getvalue()
    sectors = len(raw) // 512
    compressed = zlib.compress(raw, 9)
    # mish block map: one zlib run and a terminating run. All fields big endian.
    blkx = (struct.pack('>4sIQQQII', b'mish', 1, 0, sectors, 0, sectors, 0xfffffffe)
            + bytes(24) + checksum(raw) + struct.pack('>I', 2)
            + struct.pack('>IIQQQQ', 0x80000005, 0, 0, sectors, 0, len(compressed))
            + struct.pack('>IIQQQQ', 0xffffffff, 0, sectors, 0, len(compressed), 0))
    xml = plistlib.dumps({'resource-fork': {'blkx': [{
        'Attributes': '0x0050', 'ID': '0', 'Name': 'EduFlow (ISO9660)', 'Data': blkx}]}})
    trailer = bytearray(512)
    struct.pack_into('>4sIIIQQQQQII', trailer, 0, b'koly', 4, 512, 1,
                     0, 0, len(compressed), 0, 0, 1, 1)
    trailer[64:80] = uuid.uuid4().bytes
    trailer[80:216] = checksum(compressed)
    struct.pack_into('>QQ', trailer, 216, len(compressed), len(xml))
    trailer[352:488] = checksum(struct.pack('>I', zlib.crc32(raw)))
    struct.pack_into('>IQ', trailer, 488, 2, sectors)
    output = ROOT / 'public/eduflow.dmg'
    output.write_bytes(compressed + xml + trailer)
    # Round-trip both the UDZO stream and its filesystem before publishing.
    assert zlib.decompress(compressed) == raw
    check = pycdlib.PyCdlib()
    check.open_fp(io.BytesIO(zlib.decompress(compressed)))
    extracted = io.BytesIO()
    check.get_file_from_iso_fp(extracted, joliet_path='/EduFlow.app/Contents/MacOS/EduFlow')
    assert extracted.getvalue() == launcher
    check.close()
    print(f'{output}: {output.stat().st_size} bytes; {sectors} sectors; UDZO round-trip OK')


if __name__ == '__main__':
    create_image()
