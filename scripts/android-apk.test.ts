import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

it("Android APK: native resources, source provenance, alignment and cryptographic v1/v2/v3 signatures", () => {
  execFileSync("python3", [fileURLToPath(new URL("./android-apk.test.py", import.meta.url))], {
    stdio: "pipe",
  });
});
