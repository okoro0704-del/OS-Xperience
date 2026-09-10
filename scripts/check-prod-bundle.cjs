const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const dir = path.join("apps", "web", "dist", "assets");
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
  const t = fs.readFileSync(path.join(dir, f), "utf8");
  const loopback = [...t.matchAll(/https?:\/\/127\.0\.0\.1:\d+/g)].map((m) => m[0]);
  const uniq = [...new Set(loopback)];
  console.log(f, "loopback", uniq);
  const prod = [...t.matchAll(/https:\/\/[a-z0-9.-]*digiconomy[^"'\\\s]*/gi)].map((m) => m[0]);
  console.log(f, "digiconomy", [...new Set(prod)].slice(0, 20));
}

try {
  const apk = execSync("cmd /c dir /s /b android\\app\\build\\outputs\\apk\\*.apk", { encoding: "utf8" });
  console.log("APKs:\n" + apk);
} catch (e) {
  console.log("APK search failed", e.message);
}
