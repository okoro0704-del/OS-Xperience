#!/usr/bin/env node
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { ASSET_MEDIA_TYPES, SpacePackageError, type TrustedPackagePublisher } from "./format.js";
import { importSpacePackage, listSpaces, openSpace, type RuntimeEnvironment } from "./install.js";
import { FileInstallationStore } from "./node-store.js";
import { inspectSpacePackage, packSpace, verifySpacePackage, type PackDeclaration, type PackFile } from "./package.js";
import type { PackageSigner } from "./crypto.js";
import { runLifecycle } from "./cli-lifecycle.js";

/**
 * space — portable Space packages (SP1).
 *
 *   space pack    <source-dir> --key <signer.json> --out <file.space>
 *   space inspect <file.space>
 *   space verify  <file.space> --publishers <trust.json> [--runtime <version>]
 *   space import  <file.space> --state <dir> --publishers <trust.json> [--runtime <version>]
 *   space list    --state <dir>
 *   space open    <package-id> --state <dir> [--experience <id>] [--online] [--route <permission>]… [--request <permission>]…
 *
 * A source dir holds space.source.json (the declaration) and content/ (the assets). Output is JSON.
 * Exit codes: 0 ok, 2 rejected by verification or policy, 1 usage error.
 */
export const RUNTIME_VERSION = "1.0.0";
/** Flags that take no value; every other --name consumes the next argument. */
const FLAGS = new Set(["--online", "--launch-failed", "--no-rollback", "--requires-current-revocation"]);

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}
function options(args: string[], name: string): string[] {
  return args.flatMap((value, index) => (value === name && args[index + 1] ? [args[index + 1]!] : []));
}
function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new UsageError(`missing ${name}`);
  return value;
}
class UsageError extends Error {}

const MEDIA_BY_EXTENSION = new Map(Object.entries(ASSET_MEDIA_TYPES).flatMap(([type, extensions]) => extensions.map((extension) => [extension, type] as const)));

async function collect(dir: string, base: string, out: PackFile[]): Promise<void> {
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    const info = await lstat(path);
    // Symlinks are never followed into a package.
    if (info.isSymbolicLink()) throw new SpacePackageError("SYMLINK_NOT_ALLOWED", relative(base, path));
    if (info.isDirectory()) { await collect(path, base, out); continue; }
    if (!info.isFile()) throw new SpacePackageError("UNSAFE_PATH", relative(base, path));
    const archivePath = relative(base, path).split(sep).join("/");
    const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
    const mediaType = MEDIA_BY_EXTENSION.get(extension);
    if (!mediaType) throw new SpacePackageError("DISALLOWED_MEDIA_TYPE", archivePath);
    out.push({ path: archivePath, mediaType, bytes: new Uint8Array(await readFile(path)) });
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function run(argv: string[]): Promise<unknown> {
  const [command, target, ...rest] = argv;
  const args = [target ?? "", ...rest];
  const runtime = { version: option(args, "--runtime") ?? RUNTIME_VERSION };
  switch (command) {
    case "pack": {
      if (!target) throw new UsageError("pack <source-dir>");
      const declaration = await readJson<PackDeclaration>(join(target, "space.source.json"));
      const files: PackFile[] = [];
      await collect(join(target, "content"), target, files);
      const signer = await readJson<PackageSigner>(required(args, "--key"));
      const { bytes, manifest } = await packSpace({ declaration, files, signer });
      const out = required(args, "--out");
      await writeFile(out, bytes);
      return { packed: out, bytes: bytes.length, packageId: manifest.package.id, version: manifest.package.version, integrityRoot: manifest.integrity.root };
    }
    case "inspect": {
      const inspection = await inspectSpacePackage(new Uint8Array(await readFile(target!)));
      return inspection;
    }
    case "verify": {
      const publishers = await readJson<TrustedPackagePublisher[]>(required(args, "--publishers"));
      const verified = await verifySpacePackage(new Uint8Array(await readFile(target!)), { publishers, runtime });
      return { verified: true, trust: verified.trust, packageId: verified.manifest.package.id, version: verified.manifest.package.version, publisher: verified.publisher.publisherId, integrityRoot: verified.integrityRoot, assets: verified.assets.size };
    }
    case "import": {
      const publishers = await readJson<TrustedPackagePublisher[]>(required(args, "--publishers"));
      const store = new FileInstallationStore(required(args, "--state"));
      const result = await importSpacePackage(new Uint8Array(await readFile(target!)), { publishers, runtime, store });
      return { status: result.status, packageId: result.record.packageId, version: result.record.version, installationId: result.record.installationId, authority: result.record.authority };
    }
    case "list": {
      return listSpaces(new FileInstallationStore(required(argv, "--state")));
    }
    case "open": {
      const store = new FileInstallationStore(required(args, "--state"));
      const environment: RuntimeEnvironment = { online: args.includes("--online"), routes: options(args, "--route") as RuntimeEnvironment["routes"] };
      const opened = await openSpace(store, target!, { environment, experienceId: option(args, "--experience"), requested: options(args, "--request") });
      return { ...opened, runtime: { currentSpaceId: opened.runtime.currentSpaceId, currentExperienceId: opened.runtime.currentExperienceId, presentationState: opened.runtime.presentationState } };
    }
    default: {
      // SP2 lifecycle commands: exact syntax in cli-lifecycle.ts.
      if (command && ["install", "status", "launch", "state", "update", "keys"].includes(command)) {
        const rest = argv.slice(1);
        const positional = rest.filter((value, index) => !value.startsWith("--") && !(index > 0 && rest[index - 1]!.startsWith("--") && !FLAGS.has(rest[index - 1]!)));
        return runLifecycle(command, positional, {
          option: (name) => option(argv, name),
          options: (name) => options(argv, name),
          required: (name) => required(argv, name),
          has: (name) => argv.includes(name),
        }, option(argv, "--runtime") ?? RUNTIME_VERSION);
      }
      throw new UsageError("commands: pack, inspect, verify, import, list, open, install, status, launch, state, update, keys");
    }
  }
}

const invokedDirectly = process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => {
      if (error instanceof SpacePackageError) {
        process.stdout.write(`${JSON.stringify({ rejected: true, error: error.code, detail: error.detail ?? null }, null, 2)}\n`);
        process.exitCode = 2;
      } else {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    },
  );
}
