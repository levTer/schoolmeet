"""Offline structural regression checks; cryptographic verification uses apksigner."""
import pathlib
import struct
import unittest
import zipfile

APK = pathlib.Path(__file__).resolve().parents[1] / 'public/eduflow.apk'


def u32(b, p):
    return struct.unpack_from('<I', b, p)[0]


def manifest_nodes(b):
    assert struct.unpack_from('<H', b)[0] == 3, 'Manifest must be compiled AXML'
    count = u32(b, 16)
    assert not u32(b, 24) & 256, 'Expected UTF-16 manifest string pool'
    base = 8 + u32(b, 28)
    strings = []
    for i in range(count):
        p = base + u32(b, 36 + i * 4)
        n = struct.unpack_from('<H', b, p)[0]
        strings.append(b[p + 2:p + 2 + n * 2].decode('utf-16le'))
    p = 8 + u32(b, 12)
    stack = []
    nodes = []
    while p < len(b):
        kind, _, size = struct.unpack_from('<HHI', b, p)
        assert size >= 8 and p + size <= len(b)
        if kind == 0x102:
            name = strings[u32(b, p + 20)]
            start, width, count = struct.unpack_from('<HHH', b, p + 24)
            attrs = {}
            for j in range(count):
                a = p + 16 + start + j * width
                value = u32(b, a + 16)
                attrs[strings[u32(b, a + 4)]] = strings[value] if b[a + 15] == 3 else value
            node = (name, attrs, tuple(stack))
            nodes.append(node)
            stack.append(len(nodes) - 1)
        elif kind == 0x103:
            stack.pop()
        p += size
    assert not stack
    return nodes


class AndroidApkTests(unittest.TestCase):
    def test_zip_payload_and_alignment(self):
        self.assertTrue(APK.is_file())
        raw = APK.read_bytes()
        with zipfile.ZipFile(APK) as z:
            self.assertIsNone(z.testzip(), 'ZIP CRC/decompression failure')
            names = z.namelist()
            self.assertEqual(len(names), len(set(names)), 'Duplicate ZIP entries')
            for name in ('AndroidManifest.xml', 'classes.dex', 'resources.arsc',
                         'META-INF/MANIFEST.MF', 'META-INF/EDUFLOW.RSA', 'META-INF/EDUFLOW.SF'):
                self.assertGreater(len(z.read(name)), 0, name)
            self.assertTrue(z.read('classes.dex').startswith(b'dex\n'))
            self.assertIn(b'SHA-256-Digest:', z.read('META-INF/EDUFLOW.SF'))
            for entry in z.infolist():
                p = entry.header_offset
                self.assertEqual(raw[p:p + 4], b'PK\x03\x04')
                name_size, extra_size = struct.unpack_from('<HH', raw, p + 26)
                if entry.compress_type == zipfile.ZIP_STORED:
                    self.assertEqual((p + 30 + name_size + extra_size) % 4, 0, entry.filename)

    def test_manifest_identity_sdk_and_launcher(self):
        with zipfile.ZipFile(APK) as z:
            nodes = manifest_nodes(z.read('AndroidManifest.xml'))
        self.assertEqual(nodes[0][1]['package'], 'ru.eduflow.app')
        sdk = next(attrs for name, attrs, _ in nodes if name == 'uses-sdk')
        self.assertEqual(sdk['minSdkVersion'], 24)
        self.assertEqual(sdk['targetSdkVersion'], 34)
        main = next(node for node in nodes if node[0] == 'action' and node[1].get('name') == 'android.intent.action.MAIN')
        activity = nodes[main[2][-2]]
        self.assertEqual(activity[0], 'activity')
        self.assertEqual(activity[1]['exported'], 0xffffffff)
        self.assertTrue(any(name == 'category' and attrs.get('name') == 'android.intent.category.LAUNCHER'
                            and parents == main[2] for name, attrs, parents in nodes))
        self.assertTrue(any(attrs.get('authorities') == 'ru.eduflow.app.androidx-startup' for _, attrs, _ in nodes))

    def test_v2_v3_signing_block_present(self):
        b = APK.read_bytes()
        eocd = b.rfind(b'PK\x05\x06')
        self.assertGreater(eocd, 0)
        central = u32(b, eocd + 16)
        self.assertEqual(b[central - 16:central], b'APK Sig Block 42')
        size = struct.unpack_from('<Q', b, central - 24)[0]
        start = central - size - 8
        self.assertEqual(struct.unpack_from('<Q', b, start)[0], size)
        ids = []
        p = start + 8
        while p < central - 24:
            length = struct.unpack_from('<Q', b, p)[0]
            self.assertGreaterEqual(length, 4)
            ids.append(u32(b, p + 8))
            p += 8 + length
        self.assertEqual(p, central - 24)
        self.assertIn(0x7109871a, ids, 'Missing v2 signature')
        self.assertIn(0xf05368c0, ids, 'Missing v3 signature')


if __name__ == '__main__':
    unittest.main()
