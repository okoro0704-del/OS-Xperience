import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { build } from "esbuild";
import type { BrowserContext, Page } from "playwright";
import {
  SPACE_PACKAGE_STORES,
  inspectSpacePackage,
  signStatement,
  trustStoreFromPublishers,
  type KeyRotationStatement,
  type RevocationList,
  type TrustStore,
} from "../../packages/space-package/src/index.js";
import { assemble, craftZip } from "../../packages/space-package/test/helpers.js";
import { makeUpdate, newKey, pack, releaseSource, signerFor, type Key, type Release } from "../../packages/space-package/test/lifecycle-helpers.js";

/**
 * SP3 browser-test harness: synthetic Lantern releases signed with disposable keys (never shipped),
 * the built OS Xperience served locally, and a test-only engine bundle served from the same origin
 * so a test can drive the real IndexedDB lifecycle directly (crash failpoints, racing tabs).
 */
export const PUBLISHER = "digiconomy.demo";
export const LANTERN = "org.digiconomy.demo.lantern";
const encoder = new TextEncoder();

export interface Fixtures {
  dir: string;
  k1: Key;
  k2: Key;
  trust: TrustStore;
  files: Record<string, string>;
  v1: Release;
  v2: Release;
}

export async function buildFixtures(dir: string): Promise<Fixtures> {
  await mkdir(dir, { recursive: true });
  const k1 = await newKey("demo-key-1");
  const k2 = await newKey("demo-key-2");
  const signer = signerFor(PUBLISHER, k1);
  const s1 = releaseSource("v1");
  const s2 = releaseSource("v2");
  const v1 = await pack(s1.declaration, s1.files, signer, 1);
  const v2 = await pack(s2.declaration, s2.files, signer, 2);
  const files: Record<string, string> = {};
  const put = async (name: string, bytes: Uint8Array | string) => { const path = join(dir, name); await writeFile(path, bytes); files[name] = path; return path; };

  await put("lantern-1.0.0.space", v1.bytes);
  await put("lantern-2.0.0.space", v2.bytes);
  // The same package under a misleading name: identification must follow the contents.
  await put("lantern-renamed.json", v1.bytes);
  await put("lantern-2.0.0.update.json", await makeUpdate(v1, v2, { publisherId: PUBLISHER, key: k1 }));

  // Tampered: the signed manifest is intact, one image byte inside the archive is not.
  const inspection = await inspectSpacePackage(v1.bytes);
  const png = s1.files.find((file) => file.path.endsWith(".png"))!;
  const changed = png.bytes.slice(); const at = changed.length - 20; changed[at] = changed[at]! ^ 0xff;
  await put("lantern-tampered.space", await assemble(inspection.manifest, signer, s1.files.map((file) => (file === png ? { path: file.path, bytes: changed } : file))));

  // Signed by a publisher this device has never trusted.
  const stranger = await newKey("stranger-1");
  await put("lantern-stranger.space", (await pack(s1.declaration, s1.files, signerFor("stranger.pub", stranger), 1)).bytes);

  // Decompression attacks.
  const mimetype = { path: "mimetype", bytes: encoder.encode("application/vnd.digiconomy.space-package") };
  await put("bomb-ratio.space", craftZip([mimetype, { path: "content/bomb.txt", bytes: new Uint8Array(64 * 1024 * 1024), method: 8 }]));
  await put("bomb-liar.space", craftZip([mimetype, { path: "META-INF/space.json", bytes: new Uint8Array(4 * 1024 * 1024).fill(32), method: 8, declaredSize: 4000 }]));

  // A JSON launch-file-looking document with a ZIP directory appended: ambiguous, refused.
  const launch = await readFile(resolve("apps/os-experience/public/spaces/mrfundzman.space"));
  const end = new Uint8Array(22); end.set([0x50, 0x4b, 0x05, 0x06]);
  await put("polyglot.space", new Uint8Array([...launch, ...end]));
  await put("not-a-space.space", "hello, this is plain text");

  // A package whose text item looks like markup: it must render as text, never execute.
  const isolation = { ...s1.declaration, package: { ...s1.declaration.package, id: "org.digiconomy.demo.isolation", name: "Isolation Probe" }, space: { ...s1.declaration.space, spaceId: "org.digiconomy.demo.isolation" } };
  const markup = "<script>window.__pwned = 1</script><img src=x onerror=\"window.__pwned = 2\"><iframe src=\"https://evil.test\"></iframe>";
  const isolationFiles = [
    ...s1.files.filter((file) => file.path !== "content/index.json"),
    { path: "content/notes.txt", mediaType: "text/plain", bytes: encoder.encode(markup) },
    { path: "content/index.json", mediaType: "application/json", bytes: encoder.encode(JSON.stringify({ format: "space.content-index/v1", title: "Probe", items: [
      { id: "lantern", title: "Lantern glow", asset: "content/media/lantern.png", kind: "image" },
      { id: "chime", title: "Evening chime", asset: "content/media/chime.wav", kind: "audio" },
      { id: "notes", title: "Notes", asset: "content/notes.txt", kind: "text" },
    ] })) },
  ];
  await put("isolation.space", (await pack(isolation, isolationFiles, signer, 1)).bytes);

  // A larger package (2 MB of pseudo-random padding, so it does not compress away) for storage-quota tests.
  const largeId = "org.digiconomy.demo.large";
  const padding = new Uint8Array(2 * 1024 * 1024);
  for (let i = 0, x = 2463534242; i < padding.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; padding[i] = x & 0x7f | 0x20; }
  const large = { ...s1.declaration, package: { ...s1.declaration.package, id: largeId, name: "Large Probe" }, space: { ...s1.declaration.space, spaceId: largeId } };
  await put("large.space", (await pack(large, [...s1.files, { path: "content/padding.txt", mediaType: "text/plain", bytes: padding }], signer, 1)).bytes);

  // V2 asking for an extra permission, and a security-sensitive V2 needing CURRENT revocation evidence.
  const wider = await pack({ ...s2.declaration, permissions: [...s2.declaration.permissions, "storage.local"] }, s2.files, signer, 2);
  await put("lantern-2.0.0-wider.space", wider.bytes);
  await put("lantern-2.0.0-wider.update.json", await makeUpdate(v1, wider, { publisherId: PUBLISHER, key: k1 }, { permissions: ["content.read", "media.playback", "network.sync", "storage.local"] }));
  await put("lantern-2.0.0-sensitive.update.json", await makeUpdate(v1, v2, { publisherId: PUBLISHER, key: k1 }, { security: { requiresRevocationSequence: null, requiresCurrentRevocation: true } }));

  // Key lifecycle: k1 introduces k2, then k2 revokes k1.
  const rotation = await signStatement<KeyRotationStatement>({ format: "digiconomy.space-key-rotation", formatVersion: 1, publisherId: PUBLISHER, sequence: 1, retiringKeyId: k1.keyId, newKey: { keyId: k2.keyId, publicKeySpkiBase64: k2.publicKeySpkiBase64 }, authorizedBy: { keyId: k1.keyId } }, k1);
  await put("rotation-k1-k2.json", JSON.stringify(rotation));
  const revocation = await signStatement<RevocationList>({ format: "digiconomy.space-key-revocations", formatVersion: 1, publisherId: PUBLISHER, sequence: 1, issuedAt: new Date().toISOString(), revokedKeyIds: [k1.keyId], authorizedBy: { keyId: k2.keyId } }, k2);
  await put("revoke-k1.json", JSON.stringify(revocation));

  const trust = trustStoreFromPublishers([{ publisherId: PUBLISHER, name: "Lantern Test Publisher (synthetic)", keys: [{ keyId: k1.keyId, publicKeySpkiBase64: k1.publicKeySpkiBase64 }], packagePrefixes: ["org.digiconomy.demo."] }]);
  return { dir, k1, k2, trust, files, v1, v2 };
}

/** The built app plus the test-only engine bundle, served from one local origin. */
export async function serveApp() {
  const dist = resolve("apps/os-experience/dist");
  const harness = await build({ entryPoints: [resolve("packages/space-package/src/index.ts")], bundle: true, format: "iife", globalName: "SpacePackage", platform: "browser", target: "es2022", write: false, logLevel: "silent" });
  const harnessJs = harness.outputFiles[0]!.contents;
  const requests: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => void (async () => {
    const pathname = (req.url ?? "/").split("?")[0]!;
    requests.push(pathname);
    if (pathname === "/__space-harness.js") { res.setHeader("content-type", "text/javascript"); res.end(harnessJs); return; }
    const target = join(dist, pathname === "/" ? "index.html" : pathname);
    try {
      const body = await readFile(target);
      const extension = extname(target);
      res.setHeader("content-type", extension === ".js" ? "text/javascript" : extension === ".css" ? "text/css" : extension === ".html" ? "text/html" : extension === ".json" || extension === ".webmanifest" ? "application/json" : extension === ".svg" ? "image/svg+xml" : "application/octet-stream");
      res.end(body);
    } catch {
      res.setHeader("content-type", "text/html");
      res.end(await readFile(join(dist, "index.html")));
    }
  })());
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    base: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); },
  };
}

/** Every external host is unreachable: nothing in these tests may depend on a live server. */
export async function hermetic(context: BrowserContext) {
  const external: string[] = [];
  await context.route((url) => url.hostname !== "127.0.0.1", (route) => { external.push(route.request().url()); return route.abort("internetdisconnected"); });
  return external;
}

/** Writes the synthetic trust anchors into the app's IndexedDB, exactly where a provisioned device keeps them. */
export async function seedTrust(page: Page, trust: TrustStore | null) {
  await page.evaluate(async ({ stores, trust }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("digiconomy-space-packages", 1);
      request.onupgradeneeded = () => { for (const store of stores) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: "key" }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("trust", "readwrite");
      if (trust) tx.objectStore("trust").put({ key: "trust-store", trust }); else tx.objectStore("trust").delete("trust-store");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { stores: [...SPACE_PACKAGE_STORES], trust });
}

export async function openSpaceScreen(page: Page) {
  await page.locator('[data-testid="nav-xperience"]:visible').first().click();
  await page.getByTestId("xperience-choice-space").click();
  await page.getByTestId("xperience-space").waitFor();
  await page.getByTestId("portable-spaces").waitFor();
}

/** Picks a file with the existing Import Space control and lands on the installer's trust screen. */
export async function importToTrust(page: Page, path: string) {
  await page.getByTestId("space-import-input").setInputFiles(path);
  await page.getByTestId("space-installer").waitFor();
  await page.getByTestId("inspect-continue").click();
  await page.locator('[data-testid="check-eligibility"]').waitFor({ timeout: 20_000 });
}

export async function check(page: Page, name: string) {
  const row = page.getByTestId(`check-${name}`);
  return { status: await row.getAttribute("data-status"), code: await row.getAttribute("data-code") };
}

export async function loadHarness(page: Page) {
  await page.addScriptTag({ url: "/__space-harness.js" });
}
