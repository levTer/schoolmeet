"""Regression checks for the native APK, including actual v1/v2/v3 verification.

Uses Python's stdlib and OpenSSL. Android apksigner is also run when APKSIGNER is
provided; OpenSSL checks here are not a replacement for device/SDK testing.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
APK = ROOT / 'public/eduflow.apk'
CERT_FINGERPRINT = (ROOT / 'android/release-certificate.sha256').read_text().strip()
V2_ID, V3_ID = 0x7109871a, 0xf05368c0
RSA_PKCS1_SHA256 = 0x0103


def u32(data, pos=0):
    return struct.unpack_from('<I', data, pos)[0]


def length_prefixed(data, pos=0):
    if pos + 4 > len(data):
        raise ValueError('Truncated length')
    length = u32(data, pos)
    end = pos + 4 + length
    if end > len(data):
        raise ValueError('Truncated length-prefixed field')
    return data[pos + 4:end], end


def read_records(data):
    result = []
    pos = 0
    while pos < len(data):
        item, pos = length_prefixed(data, pos)
        result.append(item)
    return result


def manifest_nodes(data):
    """Read enough AXML to inspect manifest and compiled drawable roots."""
    if struct.unpack_from('<H', data)[0] != 3:
        raise ValueError('Expected compiled AXML')
    pool = 8
    kind, header, size = struct.unpack_from('<HHI', data, pool)
    if kind != 1:
        raise ValueError('Expected AXML string pool')
    count = u32(data, pool + 8)
    utf8 = bool(u32(data, pool + 16) & 0x100)
    base = pool + u32(data, pool + 20)

    def read_length(pos, wide):
        if wide:
            first = struct.unpack_from('<H', data, pos)[0]
            if first & 0x8000:
                return ((first & 0x7fff) << 16) | struct.unpack_from('<H', data, pos + 2)[0], pos + 4
            return first, pos + 2
        first = data[pos]
        if first & 0x80:
            return ((first & 0x7f) << 8) | data[pos + 1], pos + 2
        return first, pos + 1

    strings = []
    for i in range(count):
        pos = base + u32(data, pool + header + i * 4)
        length, pos = read_length(pos, not utf8)
        if utf8:
            length, pos = read_length(pos, False)  # UTF-8 byte length follows UTF-16 length.
        strings.append(data[pos:pos + length * (1 if utf8 else 2)].decode('utf-8' if utf8 else 'utf-16le'))
    pos = pool + size
    stack, nodes = [], []
    while pos < len(data):
        chunk_type, _, size = struct.unpack_from('<HHI', data, pos)
        if size < 8 or pos + size > len(data):
            raise ValueError('Invalid AXML chunk')
        if chunk_type == 0x102:
            name = strings[u32(data, pos + 20)]
            start, width, count = struct.unpack_from('<HHH', data, pos + 24)
            attrs = {}
            for j in range(count):
                attr = pos + 16 + start + j * width
                value = u32(data, attr + 16)
                attrs[strings[u32(data, attr + 4)]] = strings[value] if data[attr + 15] == 3 else value
            nodes.append((name, attrs, tuple(stack)))
            stack.append(len(nodes) - 1)
        elif chunk_type == 0x103:
            stack.pop()
        pos += size
    if stack:
        raise ValueError('Unbalanced AXML')
    return nodes


def signing_block(data):
    eocd = data.rfind(b'PK\x05\x06')
    if eocd < 0 or eocd + 22 + struct.unpack_from('<H', data, eocd + 20)[0] != len(data):
        raise ValueError('Invalid ZIP EOCD')
    central = u32(data, eocd + 16)
    if data[central - 16:central] != b'APK Sig Block 42':
        raise ValueError('Missing APK signing block')
    size = struct.unpack_from('<Q', data, central - 24)[0]
    start = central - size - 8
    if start < 0 or struct.unpack_from('<Q', data, start)[0] != size:
        raise ValueError('Bad signing-block size')
    pairs = {}
    pos = start + 8
    while pos < central - 24:
        length = struct.unpack_from('<Q', data, pos)[0]
        if length < 4 or pos + 8 + length > central - 24:
            raise ValueError('Bad signing-block entry')
        ident = u32(data, pos + 8)
        if ident in pairs:
            raise ValueError('Duplicate signing-block entry')
        pairs[ident] = data[pos + 12:pos + 8 + length]
        pos += 8 + length
    if pos != central - 24:
        raise ValueError('Bad signing-block boundary')
    return pairs, start, central, eocd


def apk_content_digest(data, start, central, eocd):
    # Android's chunked digest excludes the signing block and rewrites the EOCD
    # central-directory offset to point where that block began.
    end = bytearray(data[eocd:])
    struct.pack_into('<I', end, 16, start)
    digests = []
    for part in (data[:start], data[central:eocd], end):
        for pos in range(0, len(part), 1024 * 1024):
            chunk = part[pos:pos + 1024 * 1024]
            digests.append(hashlib.sha256(b'\xa5' + struct.pack('<I', len(chunk)) + chunk).digest())
    return hashlib.sha256(b'\x5a' + struct.pack('<I', len(digests)) + b''.join(digests)).digest()


def parse_signer(value, v3):
    signers, end = length_prefixed(value)
    if end != len(value):
        raise ValueError('Trailing signer data')
    signers = read_records(signers)
    if len(signers) != 1:
        raise ValueError('Expected exactly one signer')
    signer = signers[0]
    signed, pos = length_prefixed(signer)
    outer_sdk = None
    if v3:
        outer_sdk = (u32(signer, pos), u32(signer, pos + 4))
        pos += 8
    signatures, pos = length_prefixed(signer, pos)
    public_key, pos = length_prefixed(signer, pos)
    if pos != len(signer):
        raise ValueError('Trailing signer fields')
    digests, pos = length_prefixed(signed)
    certs, pos = length_prefixed(signed, pos)
    if v3:
        inner_sdk = (u32(signed, pos), u32(signed, pos + 4))
        if outer_sdk != inner_sdk:
            raise ValueError('v3 SDK ranges do not match')
        if outer_sdk[0] > 28 or outer_sdk[1] < 34:
            raise ValueError('v3 signer does not cover Android 9–14')
        pos += 8
    _, pos = length_prefixed(signed, pos)  # additional attributes
    # apksig can pad v2 signed-data with an empty field for scheme evolution.
    if signed[pos:] not in (b'', b'\0\0\0\0'):
        raise ValueError('Unexpected signed-data fields')
    certs = read_records(certs)
    if len(certs) != 1:
        raise ValueError('Expected one certificate')

    def algorithms(records):
        values = {}
        for record in read_records(records):
            alg = u32(record)
            value, end = length_prefixed(record, 4)
            if end != len(record) or alg in values:
                raise ValueError('Bad signature/digest record')
            values[alg] = value
        return values

    return signed, algorithms(signatures), algorithms(digests), certs[0], public_key


def run_openssl(*args, input_data=None, check=True):
    return subprocess.run(['openssl', *args], input=input_data, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=check)


def manifest_sections(data):
    # Unfold JAR manifest continuation lines, then parse each section.
    data = data.replace(b'\r\n ', b'').replace(b'\n ', b'')
    return [dict(line.split(': ', 1) for line in section.decode('utf-8').splitlines() if ': ' in line)
            for section in re.split(b'\r?\n\r?\n', data) if section]


class AndroidApkTests(unittest.TestCase):
    def test_zip_payload_and_alignment(self):
        self.assertTrue(APK.is_file(), 'Missing public/eduflow.apk')
        raw = APK.read_bytes()
        with zipfile.ZipFile(APK) as archive:
            self.assertIsNone(archive.testzip(), 'ZIP CRC/decompression failure')
            names = archive.namelist()
            self.assertEqual(len(names), len(set(names)), 'Duplicate ZIP entries')
            for name in ('AndroidManifest.xml', 'classes.dex', 'resources.arsc',
                         'assets/native-build.json', 'META-INF/MANIFEST.MF'):
                self.assertGreater(len(archive.read(name)), 0, name)
            dex = archive.read('classes.dex')
            self.assertTrue(dex.startswith(b'dex\n'))
            for token in (b'Lru/eduflow/app/MainActivity;', b'Lru/eduflow/app/WebWorkspace;',
                          b'Lru/eduflow/app/EduFlowApi;', b'requestPermissions',
                          b'setStatusBarColor', b'setNavigationBarColor', b'schoolmeet-vb96.onrender.com'):
                self.assertIn(token, dex)
            self.assertNotIn(b'com/google/androidbrowserhelper', dex, 'Old TWA launcher must not remain')
            for entry in archive.infolist():
                pos = entry.header_offset
                self.assertEqual(raw[pos:pos + 4], b'PK\x03\x04')
                name_size, extra_size = struct.unpack_from('<HH', raw, pos + 26)
                if entry.compress_type == zipfile.ZIP_STORED:
                    self.assertEqual((pos + 30 + name_size + extra_size) % 4, 0, entry.filename)

    def test_manifest_identity_sdk_permissions_and_launcher(self):
        with zipfile.ZipFile(APK) as archive:
            nodes = manifest_nodes(archive.read('AndroidManifest.xml'))
        self.assertEqual(nodes[0][1]['package'], 'ru.eduflow.app')
        self.assertEqual(nodes[0][1]['versionCode'], 2)
        sdk = next(attrs for name, attrs, _ in nodes if name == 'uses-sdk')
        self.assertEqual(sdk['minSdkVersion'], 24)
        self.assertEqual(sdk['targetSdkVersion'], 34)
        permissions = {attrs.get('name') for name, attrs, _ in nodes if name == 'uses-permission'}
        for permission in ('INTERNET', 'CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS'):
            self.assertIn('android.permission.' + permission, permissions)
        app = next(attrs for name, attrs, _ in nodes if name == 'application')
        self.assertEqual(app['usesCleartextTraffic'], 0)
        self.assertEqual(app['allowBackup'], 0)
        main = next(node for node in nodes if node[0] == 'action' and node[1].get('name') == 'android.intent.action.MAIN')
        activity = nodes[main[2][-2]]
        self.assertEqual(activity[0], 'activity')
        self.assertEqual(activity[1]['name'], 'ru.eduflow.app.MainActivity')
        self.assertEqual(activity[1]['exported'], 0xffffffff)
        self.assertTrue(any(name == 'category' and attrs.get('name') == 'android.intent.category.LAUNCHER'
                            and parents == main[2] for name, attrs, parents in nodes))

    def test_splash_and_logo_resources_are_in_the_apk(self):
        sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
        res = ROOT / 'android/app/src/main/res'
        with zipfile.ZipFile(APK) as archive:
            for density, size in sizes.items():
                for name, expected in (('ic_launcher.png', size), ('ic_launcher_foreground.png', int(size * 2.25))):
                    png = archive.read(f'res/mipmap-{density}-v4/{name}')
                    self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
                    self.assertEqual(struct.unpack_from('>II', png, 16), (expected, expected))
                    self.assertEqual(png, (res / f'mipmap-{density}/{name}').read_bytes())
            splash = archive.read('res/drawable-nodpi-v4/splash_logo.png')
            self.assertEqual(splash, (res / 'drawable-nodpi/splash_logo.png').read_bytes())
            self.assertEqual(struct.unpack_from('>II', splash, 16), (432, 432))
            self.assertEqual(manifest_nodes(archive.read('res/drawable/splash_background.xml'))[0][0], 'layer-list')
            for api in (26, 33):
                nodes = manifest_nodes(archive.read(f'res/mipmap-anydpi-v{api}/ic_launcher.xml'))
                self.assertEqual(nodes[0][0], 'adaptive-icon')
                self.assertTrue({'background', 'foreground'} <= {node[0] for node in nodes})
                if api == 33:
                    self.assertIn('monochrome', {node[0] for node in nodes})
            table = archive.read('resources.arsc')
            # Framework attributes: Android 12 splash background and animated icon.
            self.assertIn(struct.pack('<I', 0x0101062c), table)
            self.assertIn(struct.pack('<I', 0x0101062d), table)
            self.assertIn(struct.pack('<I', 0xff0f172a), table)

    def test_native_navigation_permissions_and_origin_policy(self):
        source = ROOT / 'android/app/src/main/java/ru/eduflow/app'
        activity = (source / 'MainActivity.java').read_text()
        web = (source / 'WebWorkspace.java').read_text()
        api = (source / 'EduFlowApi.java').read_text()
        for token in ('moveTaskToBack(true)', 'workspace.canGoBack()', 'requestPermissions(',
                      'checkSelfPermission(', 'request.getOrigin()', 'finishMediaRequest()',
                      'setStatusBarColor(SLATE)', 'setNavigationBarColor(SLATE)',
                      'setOnExitAnimationListener', 'showSplashOverlay()', 'Screen.SCHEDULE', 'Screen.HOMEWORK'):
            self.assertIn(token, activity)
        for token in ('MIXED_CONTENT_NEVER_ALLOW', 'setAllowFileAccess(false)',
                      'setAcceptThirdPartyCookies(web, false)', 'uri.getUserInfo() == null',
                      'EduFlowApi.HOST.equalsIgnoreCase(host)', 'activity.requestMedia(request)',
                      'onShowFileChooser', 'activity.saveDownload'):
            self.assertIn(token, web)
        self.assertNotIn('addJavascriptInterface', web)
        self.assertIn('conn.setInstanceFollowRedirects(false)', api)
        self.assertIn('connection.setInstanceFollowRedirects(false)', activity)

    def test_apk_matches_checked_in_native_sources(self):
        expected = json.loads(subprocess.check_output(['python3', str(ROOT / 'scripts/android-build-info.py')]))
        with zipfile.ZipFile(APK) as archive:
            embedded = json.loads(archive.read('assets/native-build.json'))
        self.assertEqual(embedded, expected, 'Android sources/resources changed without rebuilding the APK')

    def test_v1_cryptographic_signature_and_all_payload_digests(self):
        with zipfile.ZipFile(APK) as archive:
            names = archive.namelist()
            rsa = [name for name in names if re.fullmatch(r'META-INF/[A-Z0-9_-]+\.RSA', name)]
            self.assertEqual(len(rsa), 1)
            sf = rsa[0][:-4] + '.SF'
            signature, signed_file = archive.read(rsa[0]), archive.read(sf)
            manifest = archive.read('META-INF/MANIFEST.MF')
            with tempfile.TemporaryDirectory() as temp:
                path = Path(temp)
                (path / 'signature.der').write_bytes(signature)
                (path / 'signature.sf').write_bytes(signed_file)
                # Checks the PKCS#7 signature, not just the presence of META-INF files.
                run_openssl('cms', '-verify', '-binary', '-inform', 'DER', '-in', str(path / 'signature.der'),
                            '-content', str(path / 'signature.sf'), '-noverify', '-out', os.devnull)
                cert_pem = run_openssl('pkcs7', '-inform', 'DER', '-in', str(path / 'signature.der'), '-print_certs').stdout
                cert_der = run_openssl('x509', '-outform', 'DER', input_data=cert_pem).stdout
                self.assertEqual(hashlib.sha256(cert_der).hexdigest(), CERT_FINGERPRINT)
                key_details = run_openssl('x509', '-noout', '-text', input_data=cert_pem).stdout
                self.assertIn(b'Public-Key: (2048 bit)', key_details)
                self.assertIn(b'sha256WithRSAEncryption', key_details)
                # A modified .SF must fail PKCS#7 verification.
                (path / 'tampered.sf').write_bytes(signed_file + b'x')
                failed = run_openssl('cms', '-verify', '-binary', '-inform', 'DER', '-in', str(path / 'signature.der'),
                                     '-content', str(path / 'tampered.sf'), '-noverify', '-out', os.devnull, check=False)
                self.assertNotEqual(failed.returncode, 0)
            sf_main = manifest_sections(signed_file)[0]
            self.assertEqual(base64.b64decode(sf_main['SHA-256-Digest-Manifest']), hashlib.sha256(manifest).digest())
            self.assertIn('2', sf_main['X-Android-APK-Signed'])
            self.assertIn('3', sf_main['X-Android-APK-Signed'])
            sections = manifest_sections(manifest)
            entries = {section['Name']: section for section in sections[1:]}
            payload = {name for name in names if not name.startswith('META-INF/') and not name.endswith('/')}
            self.assertEqual(set(entries), payload)
            for name in payload:
                self.assertEqual(base64.b64decode(entries[name]['SHA-256-Digest']), hashlib.sha256(archive.read(name)).digest(), name)

    def test_v2_and_v3_cryptographic_signatures_and_content_digests(self):
        raw = APK.read_bytes()
        pairs, start, central, eocd = signing_block(raw)
        calculated = apk_content_digest(raw, start, central, eocd)
        certificates = []
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            for scheme in (V2_ID, V3_ID):
                self.assertIn(scheme, pairs)
                signed, signatures, digests, cert, key = parse_signer(pairs[scheme], scheme == V3_ID)
                certificates.append(cert)
                self.assertEqual(hashlib.sha256(cert).hexdigest(), CERT_FINGERPRINT)
                self.assertEqual(set(signatures), {RSA_PKCS1_SHA256})
                self.assertEqual(set(digests), {RSA_PKCS1_SHA256})
                self.assertEqual(digests[RSA_PKCS1_SHA256], calculated)
                # Also ensure that the signed public key is the certificate's public key.
                cert_key = run_openssl('x509', '-inform', 'DER', '-pubkey', '-noout', input_data=cert).stdout
                cert_key_der = run_openssl('pkey', '-pubin', '-outform', 'DER', input_data=cert_key).stdout
                self.assertEqual(cert_key_der, key)
                (path / 'key.pem').write_bytes(cert_key)
                (path / 'signed').write_bytes(signed)
                (path / 'signature').write_bytes(signatures[RSA_PKCS1_SHA256])
                run_openssl('dgst', '-sha256', '-verify', str(path / 'key.pem'), '-signature',
                            str(path / 'signature'), str(path / 'signed'))
            self.assertEqual(certificates[0], certificates[1])
            tampered = bytearray(raw)
            tampered[40] ^= 1
            self.assertNotEqual(apk_content_digest(tampered, start, central, eocd), calculated)

    def test_android_sdk_verification_when_available(self):
        apksigner = os.environ.get('APKSIGNER')
        if not apksigner:
            self.skipTest('Set APKSIGNER to also run Android SDK verification')
        result = subprocess.run([apksigner, 'verify', '--verbose', '--print-certs', '--min-sdk-version', '23', str(APK)],
                                check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for scheme in ('v1', 'v2', 'v3'):
            self.assertRegex(result.stdout, rf'Verified using {scheme} scheme .*: true')
        self.assertIn(CERT_FINGERPRINT, result.stdout)
        self.assertIn('key size (bits): 2048', result.stdout)


if __name__ == '__main__':
    unittest.main()
