import { LIMITS, SpacePackageError, type PackageLimits } from "./format.js";

/**
 * Strict ZIP subset (PKWARE APPNOTE 6.3) for Space packages.
 *
 * Written: STORED entries only, fixed timestamps, UTF-8 names, sorted order — byte-for-byte
 * reproducible for the same inputs. Read: STORED or DEFLATE, no encryption, no ZIP64, no data
 * descriptors, no multi-disk, no trailing or overlapping data, no symlinks or special files,
 * case-insensitively unique paths, bounded sizes and compression ratios, CRC-checked.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const UNIX = 3;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const DOS_DATE_1980 = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const DOS_TIME_0 = 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipInputEntry {
  path: string;
  bytes: Uint8Array;
}

/** Deterministic STORED archive in the given entry order. Callers fix the order. */
export function writeZip(entries: readonly ZipInputEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, 0, true); // STORED
    lv.setUint16(10, DOS_TIME_0, true);
    lv.setUint16(12, DOS_DATE_1980, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.bytes.length, true);
    lv.setUint32(22, entry.bytes.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const header = new Uint8Array(46 + name.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, CENTRAL, true);
    cv.setUint16(4, (UNIX << 8) | 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME_0, true);
    cv.setUint16(14, DOS_DATE_1980, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.bytes.length, true);
    cv.setUint32(24, entry.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, ((S_IFREG | 0o644) << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    header.set(name, 46);
    parts.push(local, entry.bytes);
    central.push(header);
    offset += local.length + entry.bytes.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...parts, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export interface ZipEntry {
  path: string;
  method: 0 | 8;
  compressedSize: number;
  size: number;
  crc: number;
  dataOffset: number;
}

export interface ZipArchive {
  entries: ZipEntry[];
  /** Decompresses and CRC-checks one entry, within the package limits. */
  read(entry: ZipEntry): Promise<Uint8Array>;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Safe relative path: no absolute, drive, UNC, traversal, empty, dot or reserved segments, no control characters. */
export function checkSafePath(path: string, limits: PackageLimits = LIMITS): void {
  if (!path || path.length > limits.maxPathLength) throw new SpacePackageError("UNSAFE_PATH", "path length");
  if (path !== path.normalize("NFC")) throw new SpacePackageError("UNSAFE_PATH", "path is not NFC");
  if (/[\u0000-\u001f\u007f\\:*?"<>|]/.test(path)) throw new SpacePackageError("UNSAFE_PATH", "forbidden character");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) throw new SpacePackageError("UNSAFE_PATH", "absolute path");
  for (const segment of path.split("/")) {
    if (!segment || segment === "." || segment === "..") throw new SpacePackageError("UNSAFE_PATH", "empty, dot or traversal segment");
    if (segment.endsWith(".") || segment.endsWith(" ") || WINDOWS_RESERVED.test(segment)) throw new SpacePackageError("UNSAFE_PATH", "segment not portable");
  }
}

export function readZip(bytes: Uint8Array, limits: PackageLimits = LIMITS): ZipArchive {
  if (bytes.length > limits.maxArchiveBytes) throw new SpacePackageError("ARCHIVE_TOO_LARGE");
  if (bytes.length < 22) throw new SpacePackageError("NOT_A_SPACE_PACKAGE", "too small");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record must be the last 22 bytes: archive comments and trailing data are not allowed.
  const endAt = bytes.length - 22;
  if (view.getUint32(endAt, true) !== END) {
    if (view.getUint32(0, true) !== LOCAL) throw new SpacePackageError("NOT_A_SPACE_PACKAGE", "not a ZIP container");
    throw new SpacePackageError("MALFORMED_ARCHIVE", "end record not at end (comment, trailing data or ZIP64)");
  }
  const disk = view.getUint16(endAt + 4, true);
  const cdDisk = view.getUint16(endAt + 6, true);
  const countDisk = view.getUint16(endAt + 8, true);
  const count = view.getUint16(endAt + 10, true);
  const cdSize = view.getUint32(endAt + 12, true);
  const cdOffset = view.getUint32(endAt + 16, true);
  if (disk !== 0 || cdDisk !== 0 || countDisk !== count) throw new SpacePackageError("UNSUPPORTED_ARCHIVE_FEATURE", "multi-disk");
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new SpacePackageError("UNSUPPORTED_ARCHIVE_FEATURE", "ZIP64");
  if (count > limits.maxEntries) throw new SpacePackageError("TOO_MANY_ENTRIES");
  if (cdOffset + cdSize !== endAt) throw new SpacePackageError("MALFORMED_ARCHIVE", "central directory bounds");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  const ranges: Array<[number, number]> = [];
  let at = cdOffset;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > endAt || view.getUint32(at, true) !== CENTRAL) throw new SpacePackageError("MALFORMED_ARCHIVE", "central header");
    const madeBy = view.getUint16(at + 4, true) >> 8;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const external = view.getUint32(at + 38, true);
    const localOffset = view.getUint32(at + 42, true);
    if (at + 46 + nameLength + extraLength + commentLength > endAt) throw new SpacePackageError("MALFORMED_ARCHIVE", "central header bounds");
    if (flags & 0x0001) throw new SpacePackageError("UNSUPPORTED_ARCHIVE_FEATURE", "encrypted entry");
    if (flags & 0x0008) throw new SpacePackageError("UNSUPPORTED_ARCHIVE_FEATURE", "data descriptor");
    if (method !== 0 && method !== 8) throw new SpacePackageError("UNSUPPORTED_ARCHIVE_FEATURE", `compression method ${method}`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new SpacePackageError("UNSUPPORTED_ARCHIVE_FEATURE", "ZIP64");
    let path: string;
    try {
      path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    } catch {
      throw new SpacePackageError("UNSAFE_PATH", "name is not UTF-8");
    }
    if (path.endsWith("/")) throw new SpacePackageError("UNSAFE_PATH", "directory entries are not allowed");
    checkSafePath(path, limits);
    if (madeBy === UNIX) {
      const mode = (external >>> 16) & S_IFMT;
      if (mode === 0o120000) throw new SpacePackageError("SYMLINK_NOT_ALLOWED", path);
      if (mode !== 0 && mode !== S_IFREG) throw new SpacePackageError("UNSAFE_PATH", "not a regular file");
    }
    const key = path.toLowerCase();
    if (seen.has(key)) throw new SpacePackageError("DUPLICATE_PATH", path);
    seen.add(key);
    if (size > limits.maxEntryBytes) throw new SpacePackageError("ENTRY_TOO_LARGE", path);
    total += size;
    if (total > limits.maxTotalBytes) throw new SpacePackageError("DECOMPRESSION_BOMB", "total uncompressed size");
    if (method === 0 && compressedSize !== size) throw new SpacePackageError("MALFORMED_ARCHIVE", "stored size mismatch");
    if (method === 8 && size > Math.max(1, compressedSize) * limits.maxCompressionRatio) throw new SpacePackageError("DECOMPRESSION_BOMB", path);

    // The local header must agree with the central directory.
    if (localOffset + 30 > cdOffset || view.getUint32(localOffset, true) !== LOCAL) throw new SpacePackageError("MALFORMED_ARCHIVE", "local header");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (view.getUint16(localOffset + 6, true) !== flags || view.getUint16(localOffset + 8, true) !== method
      || view.getUint32(localOffset + 14, true) !== crc || view.getUint32(localOffset + 18, true) !== compressedSize
      || view.getUint32(localOffset + 22, true) !== size || localNameLength !== nameLength
      || !localName.every((value, index) => value === bytes[at + 46 + index])) {
      throw new SpacePackageError("MALFORMED_ARCHIVE", `local header disagrees for ${path}`);
    }
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > cdOffset) throw new SpacePackageError("MALFORMED_ARCHIVE", "entry data bounds");
    ranges.push([localOffset, dataEnd]);
    entries.push({ path, method: method as 0 | 8, compressedSize, size, crc, dataOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== endAt) throw new SpacePackageError("MALFORMED_ARCHIVE", "central directory size");
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i]![0] < ranges[i - 1]![1]) throw new SpacePackageError("MALFORMED_ARCHIVE", "overlapping entries");
  }

  return {
    entries,
    async read(entry) {
      const raw = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
      const data = entry.method === 0 ? raw.slice() : await inflateRaw(raw, entry.size);
      if (data.length !== entry.size) throw new SpacePackageError("MALFORMED_ARCHIVE", `size mismatch for ${entry.path}`);
      if (crc32(data) !== entry.crc) throw new SpacePackageError("CRC_MISMATCH", entry.path);
      return data;
    },
  };
}

/** DEFLATE with a hard output cap: stops as soon as the declared size is exceeded. */
async function inflateRaw(input: Uint8Array, declaredSize: number): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > declaredSize) {
        await reader.cancel();
        throw new SpacePackageError("DECOMPRESSION_BOMB", "inflated beyond declared size");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SpacePackageError) throw error;
    throw new SpacePackageError("MALFORMED_ARCHIVE", "invalid DEFLATE data");
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
