/**
 * Publisher-side signing for Space Launch Files (V1).
 *
 *   SPACE_PUBLISHER_KEY_FILE=<file holding a base64 PKCS#8 Ed25519 key>
 *   node scripts/sign-space-launch-file.mjs <payload.json> <keyId> <out.space>
 *
 * The private key is read from outside the repository and never printed. The signed result is
 * verified against the key's own public half before it is written.
 */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  serializeSpaceLaunchFile,
  signSpaceLaunchFile,
  verifySpaceLaunchFile,
} from "../packages/xperience-contract/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [payloadPath, keyId, outPath] = process.argv.slice(2);
const keyFile = process.env.SPACE_PUBLISHER_KEY_FILE?.trim();
if (!payloadPath || !keyId || !outPath || !keyFile) {
  console.error("usage: SPACE_PUBLISHER_KEY_FILE=<key> node scripts/sign-space-launch-file.mjs <payload.json> <keyId> <out.space>");
  process.exit(2);
}
if (!relative(root, resolve(keyFile)).startsWith("..")) {
  console.error("Refusing a publisher key stored inside the repository.");
  process.exit(2);
}

const privateKeyPkcs8Base64 = readFileSync(keyFile, "utf8").trim();
const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
const file = await signSpaceLaunchFile(payload, { keyId, privateKey: privateKeyPkcs8Base64 });
const publicKeySpkiBase64 = createPublicKey(createPrivateKey({ key: Buffer.from(privateKeyPkcs8Base64, "base64"), format: "der", type: "pkcs8" }))
  .export({ type: "spki", format: "der" })
  .toString("base64");

const text = serializeSpaceLaunchFile(file);
const check = await verifySpaceLaunchFile(text, {
  publishers: [{ publisherId: payload.publisherId, name: payload.publisherId, keys: [{ keyId, publicKeySpkiBase64 }], providers: [payload.providerId] }],
  xperienceVersion: payload.compatibility.minimumXperienceVersion,
});
if (!check.ok) {
  console.error(`Signed file failed verification: ${check.code}`);
  process.exit(1);
}
writeFileSync(outPath, text);
console.log(JSON.stringify({ out: outPath, bytes: Buffer.byteLength(text), keyId, publicKeySpkiBase64, digest: file.integrity.digest }));
