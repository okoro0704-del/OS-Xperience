import { LIMITS, SpacePackageError } from "./format.js";

/**
 * SP3 content-based format detection. The file name and extension are never consulted: `.space`
 * names both an SP1 portable package (a ZIP) and a Space Launch File V1 (JSON), and either can be
 * renamed. Bytes that could be read as both are refused as AMBIGUOUS rather than guessed.
 */
export type SpaceFileKind = "PACKAGE" | "LAUNCH_FILE";

/** Space Launch File V1 limit (docs/space-launch-file-v1.md); a larger JSON file is not a launch file. */
const LAUNCH_FILE_MAX_BYTES = 16 * 1024;
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_END = [0x50, 0x4b, 0x05, 0x06];

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) => signature.every((value, index) => bytes[at + index] === value);

export function detectSpaceFormat(bytes: Uint8Array): SpaceFileKind {
  if (bytes.length === 0) throw new SpacePackageError("UNSUPPORTED_FORMAT", "the file is empty");
  if (bytes.length > LIMITS.maxArchiveBytes) throw new SpacePackageError("ARCHIVE_TOO_LARGE", `${bytes.length} bytes`);
  const hasZipEnd = bytes.length >= 22 && startsWith(bytes, ZIP_END, bytes.length - 22);
  if (startsWith(bytes, ZIP_LOCAL)) return "PACKAGE";
  let at = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (at < bytes.length && (bytes[at] === 0x20 || bytes[at] === 0x09 || bytes[at] === 0x0a || bytes[at] === 0x0d)) at += 1;
  if (bytes[at] === 0x7b /* { */) {
    // A JSON document that is also a valid ZIP container (a polyglot) is never guessed at.
    if (hasZipEnd) throw new SpacePackageError("AMBIGUOUS_FORMAT", "JSON with a ZIP directory appended");
    if (bytes.length > LAUNCH_FILE_MAX_BYTES) throw new SpacePackageError("UNSUPPORTED_FORMAT", "JSON larger than a Space Launch File may be");
    return "LAUNCH_FILE";
  }
  if (hasZipEnd) throw new SpacePackageError("AMBIGUOUS_FORMAT", "ZIP directory without a leading entry (prepended data)");
  throw new SpacePackageError("UNSUPPORTED_FORMAT", "not a Space package or a Space Launch File");
}

/* ───────────── platform support ───────────── */

export interface PlatformSupport {
  /** Ed25519 verification proven against the RFC 8032 test vector (not merely present). */
  ed25519: boolean;
  sha256: boolean;
  deflateRaw: boolean;
  indexedDb: boolean;
  /** Web Locks: serialized lifecycle mutation across tabs. Without it, mutation is disabled. */
  webLocks: boolean;
  broadcastChannel: boolean;
  storageEstimate: boolean;
  persistentStorage: boolean;
  /** Everything required to verify and install packages. */
  canVerify: boolean;
  canInstall: boolean;
  missing: string[];
}

const hex = (value: string) => Uint8Array.from(value.match(/../g)!.map((pair) => parseInt(pair, 16)));
// RFC 8032 §7.1, TEST 1: empty message.
const RFC8032_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const RFC8032_SIGNATURE = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

async function ed25519Works(): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", hex(RFC8032_PUBLIC) as BufferSource, "Ed25519" as AlgorithmIdentifier, false, ["verify"]);
    const signature = hex(RFC8032_SIGNATURE);
    if (!(await crypto.subtle.verify("Ed25519" as AlgorithmIdentifier, key, signature as BufferSource, new Uint8Array(0) as BufferSource))) return false;
    signature[0] = signature[0]! ^ 1; // a broken signature must be refused, or verification proves nothing
    return !(await crypto.subtle.verify("Ed25519" as AlgorithmIdentifier, key, signature as BufferSource, new Uint8Array(0) as BufferSource));
  } catch {
    return false;
  }
}

async function sha256Works(): Promise<boolean> {
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc") as BufferSource));
    return [...digest.slice(0, 4)].map((value) => value.toString(16).padStart(2, "0")).join("") === "ba7816bf";
  } catch {
    return false;
  }
}

function deflateRawWorks(): boolean {
  try {
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

export async function detectPlatformSupport(scope: typeof globalThis = globalThis): Promise<PlatformSupport> {
  const nav = (scope as { navigator?: Navigator }).navigator;
  const support = {
    ed25519: typeof crypto?.subtle !== "undefined" && (await ed25519Works()),
    sha256: typeof crypto?.subtle !== "undefined" && (await sha256Works()),
    deflateRaw: typeof DecompressionStream !== "undefined" && deflateRawWorks(),
    indexedDb: typeof (scope as { indexedDB?: unknown }).indexedDB !== "undefined",
    webLocks: typeof nav?.locks?.request === "function",
    broadcastChannel: typeof (scope as { BroadcastChannel?: unknown }).BroadcastChannel === "function",
    storageEstimate: typeof nav?.storage?.estimate === "function",
    persistentStorage: typeof nav?.storage?.persist === "function",
  };
  const missing: string[] = [];
  if (!support.ed25519) missing.push("Ed25519 signature verification (WebCrypto)");
  if (!support.sha256) missing.push("SHA-256 (WebCrypto)");
  if (!support.deflateRaw) missing.push("DEFLATE decompression (DecompressionStream)");
  if (!support.indexedDb) missing.push("IndexedDB storage");
  if (!support.webLocks) missing.push("Web Locks (safe updates across tabs)");
  const canVerify = support.ed25519 && support.sha256 && support.deflateRaw;
  return { ...support, canVerify, canInstall: canVerify && support.indexedDb && support.webLocks, missing };
}
