#!/usr/bin/env python3
"""Repack the existing TWA without changing DEX class names. Align/sign afterwards.

Usage: python3 scripts/repack-android.py input.apk unsigned.apk
Only identity strings are changed; the compiled classes keep their original names.
"""
import re
import struct
import sys
import zipfile

OLD = 'com.onrender.schoolmeet_vb96.twa'
NEW = 'ru.eduflow.app'


def u32(data, offset):
    return struct.unpack_from('<I', data, offset)[0]


def pool(data, offset, replacements):
    """Rewrite an Android string pool, preserving indices and style spans."""
    kind, header, size = struct.unpack_from('<HHI', data, offset)
    assert kind == 1
    count, styles, flags, start, style_start = struct.unpack_from('<IIIII', data, offset + 8)
    utf8 = bool(flags & 256)

    def length(pos):
        if utf8:
            a = data[pos]
            return (((a & 127) << 8) | data[pos + 1], pos + 2) if a & 128 else (a, pos + 1)
        a = struct.unpack_from('<H', data, pos)[0]
        return (((a & 32767) << 16) | struct.unpack_from('<H', data, pos + 2)[0], pos + 4) if a & 32768 else (a, pos + 2)

    def encode_length(n):
        if utf8:
            return bytes([n]) if n < 128 else bytes([128 | (n >> 8), n & 255])
        return struct.pack('<H', n) if n < 32768 else struct.pack('<HH', 32768 | (n >> 16), n & 65535)

    strings = bytearray()
    offsets = []
    for i in range(count):
        pos = offset + start + u32(data, offset + header + i * 4)
        n, pos = length(pos)
        if utf8:
            n, pos = length(pos)
        text = data[pos:pos + n * (1 if utf8 else 2)].decode('utf-8' if utf8 else 'utf-16le')
        text = replacements.get(text, text)
        offsets.append(len(strings))
        encoded = text.encode('utf-8' if utf8 else 'utf-16le')
        strings.extend(encode_length(len(text.encode('utf-16le')) // 2))
        if utf8:
            strings.extend(encode_length(len(encoded)))
        strings.extend(encoded + (b'\0' if utf8 else b'\0\0'))
    strings.extend(b'\0' * (-len(strings) % 4))
    out = bytearray(data[offset:offset + start])
    for i, value in enumerate(offsets):
        struct.pack_into('<I', out, header + i * 4, value)
    if styles:
        struct.pack_into('<I', out, 24, start + len(strings))
    out.extend(strings)
    if styles:
        out.extend(data[offset + style_start:offset + size])
    struct.pack_into('<I', out, 4, len(out))
    return data[:offset] + out + data[offset + size:]


def manifest(data):
    data = bytearray(pool(data, 8, {
        OLD: NEW,
        OLD + '.androidx-startup': NEW + '.androidx-startup',
        OLD + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION': NEW + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
    }))
    # targetSdkVersion is a typed integer identified by its Android resource ID.
    p = 8 + u32(data, 12)
    assert struct.unpack_from('<H', data, p)[0] == 0x180
    resource_ids = [u32(data, i) for i in range(p + 8, p + u32(data, p + 4), 4)]
    p += u32(data, p + 4)
    while p < len(data):
        kind, _, size = struct.unpack_from('<HHI', data, p)
        if kind == 0x102:
            start, width, count = struct.unpack_from('<HHH', data, p + 24)
            for j in range(count):
                a = p + 16 + start + j * width
                name = u32(data, a + 4)
                if name < len(resource_ids) and resource_ids[name] == 0x01010270:
                    struct.pack_into('<I', data, a + 16, 34)
        p += size
    struct.pack_into('<I', data, 4, len(data))
    return data


def repack(source, target):
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(target, 'w') as dst:
        assert src.testzip() is None
        for entry in src.infolist():
            if re.match(r'META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))$', entry.filename, re.I):
                continue
            data = src.read(entry)
            if entry.filename == 'AndroidManifest.xml':
                data = manifest(data)
            elif entry.filename == 'resources.arsc':
                data = bytearray(pool(data, 12, {OLD + '.fileprovider': NEW + '.fileprovider'}))
                struct.pack_into('<I', data, 4, len(data))
                p = 12
                while p < len(data):
                    kind, _, size = struct.unpack_from('<HHI', data, p)
                    if kind == 0x200:
                        name = bytes(data[p + 12:p + 268]).decode('utf-16le').rstrip('\0')
                        if name == OLD:
                            data[p + 12:p + 268] = NEW.encode('utf-16le').ljust(256, b'\0')
                    p += size
            dst.writestr(entry, data)


if __name__ == '__main__':
    repack(*sys.argv[1:])
