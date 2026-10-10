import { readFile, writeFile } from "node:fs/promises";
import type { PackageSigner } from "./crypto.js";
import { SpacePackageError, type PackagePermission, type TrustedPackagePublisher } from "./format.js";
import type { RuntimeEnvironment } from "./install.js";
import { SpaceLifecycle } from "./lifecycle.js";
import { FileLifecycleBackend } from "./node-backend.js";
import { inspectSpacePackage } from "./package.js";
import { addPendingOperation, completeOperation, type LocalState, type MigrationStep, type PendingOperation } from "./state.js";
import {
  applyKeyRotation,
  applyRevocationList,
  completeKeyRotation,
  describeTrust,
  parseTrustStore,
  signStatement,
  trustStoreFromPublishers,
  type KeyRotationStatement,
  type RevocationList,
  type TrustStore,
} from "./trust.js";
import { serializeUpdateDocument, signUpdateDocument, type UpdateDocument } from "./update.js";

/**
 * SP2 commands (lifecycle state under --state, trust store in --trust):
 *
 *   space install  <file.space> --state <dir> --trust <trust.json>
 *   space status   <package-id> --state <dir> --trust <trust.json>
 *   space launch   <package-id> --state <dir> --trust <trust.json> [--online] [--route p]… [--request p]…
 *   space state show  <package-id> --state <dir> --trust <trust.json>
 *   space state merge <package-id> <patch.json> --state <dir> --trust <trust.json>
 *
 *   space update create   --from <old.space> --to <new.space> --key <signer.json> --from-sequence <n> --to-sequence <m>
 *                         [--migration <migration.json>] [--no-rollback] [--security-floor <n>]
 *                         [--requires-revocation <n>] [--requires-current-revocation] --out <update.json>
 *   space update inspect  <update.json> [<new.space>] --state <dir> --trust <trust.json> [--approve p]…
 *   space update stage    <update.json> <new.space> --state <dir> --trust <trust.json>
 *   space update verify   <package-id> <tx-id> --state <dir> --trust <trust.json> [--approve p]…
 *   space update activate <package-id> <tx-id> --state <dir> --trust <trust.json>
 *   space update abort    <package-id> <tx-id> --state <dir> --trust <trust.json>
 *   space update rollback <package-id> --state <dir> --trust <trust.json> [--reason <text>] [--launch-failed]
 *   space update history  <package-id> --state <dir> --trust <trust.json>
 *
 *   space keys init            --publishers <publishers.json> --out <trust.json>
 *   space keys inspect         --trust <trust.json> [--max-age-days <n>]
 *   space keys sign-rotation   --key <authorizing-signer.json> --retire <key-id> --new-key-id <id> --new-public <spki-base64> --sequence <n> --out <rotation.json>
 *   space keys rotate          --trust <trust.json> --statement <rotation.json> | --complete <publisher-id>
 *   space keys sign-revocation --key <authorizing-signer.json> --revoke <key-id>… --sequence <n> --out <revocations.json>
 *   space keys revoke          --trust <trust.json> --list <revocations.json>
 *
 * Signing commands read a private key from a file; it is used in memory and never printed, logged or written.
 */
export interface CliArgs {
  option(name: string): string | undefined;
  options(name: string): string[];
  required(name: string): string;
  has(name: string): boolean;
}

const DAY = 24 * 3600 * 1000;

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}
async function loadTrust(path: string): Promise<TrustStore> {
  return parseTrustStore(await readJson(path));
}
async function saveTrust(path: string, trust: TrustStore) {
  await writeFile(path, `${JSON.stringify(trust, null, 2)}\n`);
}
async function engine(args: CliArgs, runtimeVersion: string) {
  const trust = await loadTrust(args.required("--trust"));
  return new SpaceLifecycle(new FileLifecycleBackend(args.required("--state")), { trust: () => trust, runtime: { version: runtimeVersion } });
}
const bytesOf = async (path: string) => new Uint8Array(await readFile(path));
const withoutManifest = <T extends { manifest: unknown }>(value: T | null) => {
  if (!value) return null;
  const { manifest: _manifest, ...rest } = value;
  return rest;
};

export async function runLifecycle(command: string, positional: string[], args: CliArgs, runtimeVersion: string): Promise<unknown> {
  switch (command) {
    case "install": {
      const result = await (await engine(args, runtimeVersion)).install(await bytesOf(positional[0]!));
      return { status: result.status, packageId: result.record.packageId, version: result.record.version, installationId: result.record.installationId, authority: result.record.authority };
    }
    case "status": {
      const record = await (await engine(args, runtimeVersion)).record(positional[0]!);
      return { ...record, active: withoutManifest(record.active), previous: withoutManifest(record.previous) };
    }
    case "launch": {
      const environment: RuntimeEnvironment = { online: args.has("--online"), routes: args.options("--route") as RuntimeEnvironment["routes"] };
      const opened = await (await engine(args, runtimeVersion)).open(positional[0]!, { environment, requested: args.options("--request") });
      return {
        installation: opened.installation,
        experience: { id: opened.experience.id, state: opened.experience.state, items: opened.experience.content?.items.map((item) => `${item.id} (${item.kind}): ${item.title}`) ?? [] },
        permissions: opened.permissions,
        owner: opened.definition.owner,
        network: opened.network,
      };
    }
    case "state": {
      const lifecycle = await engine(args, runtimeVersion);
      const [action, packageId, patchPath] = positional;
      if (action === "show") return lifecycle.readState(packageId!);
      if (action === "merge") {
        const patch = await readJson<{
          preferences?: LocalState["preferences"];
          settings?: LocalState["settings"];
          playlists?: LocalState["playlists"];
          userContent?: LocalState["userContent"];
          addOperations?: Array<Omit<PendingOperation, "status">>;
          completeOperations?: string[];
        }>(patchPath!);
        const now = new Date();
        return lifecycle.writeState(packageId!, (state) => {
          let next: LocalState = {
            ...state,
            preferences: { ...state.preferences, ...patch.preferences },
            settings: { ...state.settings, ...patch.settings },
            playlists: patch.playlists ?? state.playlists,
            userContent: [...state.userContent, ...(patch.userContent ?? [])],
          };
          for (const op of patch.addOperations ?? []) next = addPendingOperation(next, op, now);
          for (const opId of patch.completeOperations ?? []) next = completeOperation(next, opId, now);
          return next;
        });
      }
      throw new SpacePackageError("UPDATE_INVALID", "state show|merge");
    }
    case "update": {
      const [action, a, b] = positional;
      if (action === "create") {
        const signer = await readJson<PackageSigner>(args.required("--key"));
        const from = await inspectSpacePackage(await bytesOf(args.required("--from")));
        const to = await inspectSpacePackage(await bytesOf(args.required("--to")));
        const migrationPath = args.option("--migration");
        const migration = migrationPath
          ? await readJson<{ fromDataVersion: number; toDataVersion: number; migration: MigrationStep[]; backwardCompatible: boolean }>(migrationPath)
          : { fromDataVersion: 1, toDataVersion: 1, migration: [], backwardCompatible: true };
        const fromSequence = Number(args.required("--from-sequence"));
        const requiresRevocation = args.option("--requires-revocation");
        const body: Omit<UpdateDocument, "signature" | "format" | "formatVersion"> = {
          lineage: { packageId: to.manifest.package.id },
          publisher: { publisherId: signer.publisherId, keyId: signer.keyId },
          from: { version: from.manifest.package.version, packageDigest: from.signature.manifestSha256, sequence: fromSequence },
          to: { version: to.manifest.package.version, packageDigest: to.signature.manifestSha256, sequence: Number(args.required("--to-sequence")) },
          compatibility: { spaceContractVersion: to.manifest.runtime.spaceContractVersion, minimumRuntimeVersion: to.manifest.runtime.minimumRuntimeVersion },
          permissions: to.manifest.permissions,
          state: migration,
          rollback: { eligible: !args.has("--no-rollback"), minimumSequence: Number(args.option("--security-floor") ?? fromSequence) },
          security: { requiresRevocationSequence: requiresRevocation ? Number(requiresRevocation) : null, requiresCurrentRevocation: args.has("--requires-current-revocation") },
          issuedAt: new Date().toISOString(),
        };
        const doc = await signUpdateDocument(body, signer.privateKeyPkcs8Base64);
        await writeFile(args.required("--out"), serializeUpdateDocument(doc));
        return { created: args.required("--out"), lineage: doc.lineage.packageId, from: doc.from, to: doc.to, publisher: doc.publisher };
      }
      const lifecycle = await engine(args, runtimeVersion);
      const approve = { approvedPermissions: args.options("--approve") as PackagePermission[] };
      switch (action) {
        case "inspect": return lifecycle.inspectUpdate(await bytesOf(a!), b ? await bytesOf(b) : undefined, approve);
        case "stage": return lifecycle.stageUpdate(await bytesOf(a!), await bytesOf(b!));
        case "verify": return lifecycle.verifyUpdate(a!, b!, approve);
        case "activate": {
          const tx = await lifecycle.transaction(a!, b!);
          if (tx.state === "VERIFIED") await lifecycle.prepareMigration(a!, b!);
          return lifecycle.activate(a!, b!);
        }
        case "abort": return lifecycle.abortUpdate(a!, b!);
        case "rollback": return lifecycle.rollback(a!, args.option("--reason") ?? "requested", { launchFailed: args.has("--launch-failed") });
        case "history":
          return (await lifecycle.history(a!)).map((tx) => ({ txId: tx.txId, kind: tx.kind, from: tx.from.version, to: tx.to.version, state: tx.state, reason: tx.reason, path: tx.history.map((item) => item.state).join(" → ") }));
        default: throw new SpacePackageError("UPDATE_INVALID", "update create|inspect|stage|verify|activate|abort|rollback|history");
      }
    }
    case "keys": {
      const [action] = positional;
      switch (action) {
        case "init": {
          const trust = trustStoreFromPublishers(await readJson<TrustedPackagePublisher[]>(args.required("--publishers")));
          await saveTrust(args.required("--out"), trust);
          return describeTrust(trust, new Date(), 7 * DAY);
        }
        case "inspect": return describeTrust(await loadTrust(args.required("--trust")), new Date(), Number(args.option("--max-age-days") ?? 7) * DAY);
        case "sign-rotation": {
          const signer = await readJson<PackageSigner>(args.required("--key"));
          const statement = await signStatement<KeyRotationStatement>({
            format: "digiconomy.space-key-rotation", formatVersion: 1, publisherId: signer.publisherId, sequence: Number(args.required("--sequence")),
            retiringKeyId: args.required("--retire"), newKey: { keyId: args.required("--new-key-id"), publicKeySpkiBase64: args.required("--new-public") }, authorizedBy: { keyId: signer.keyId },
          }, signer);
          await writeFile(args.required("--out"), `${JSON.stringify(statement, null, 2)}\n`);
          return { signed: args.required("--out"), publisherId: statement.publisherId, retiring: statement.retiringKeyId, newKeyId: statement.newKey.keyId, authorizedBy: statement.authorizedBy };
        }
        case "rotate": {
          const path = args.required("--trust");
          const current = await loadTrust(path);
          const complete = args.option("--complete");
          const next = complete ? completeKeyRotation(current, complete) : await applyKeyRotation(current, await readJson<KeyRotationStatement>(args.required("--statement")));
          await saveTrust(path, next);
          return describeTrust(next, new Date(), 7 * DAY);
        }
        case "sign-revocation": {
          const signer = await readJson<PackageSigner>(args.required("--key"));
          const list = await signStatement<RevocationList>({
            format: "digiconomy.space-key-revocations", formatVersion: 1, publisherId: signer.publisherId, sequence: Number(args.required("--sequence")),
            issuedAt: new Date().toISOString(), revokedKeyIds: args.options("--revoke"), authorizedBy: { keyId: signer.keyId },
          }, signer);
          await writeFile(args.required("--out"), `${JSON.stringify(list, null, 2)}\n`);
          return { signed: args.required("--out"), publisherId: list.publisherId, sequence: list.sequence, revokedKeyIds: list.revokedKeyIds, authorizedBy: list.authorizedBy };
        }
        case "revoke": {
          const path = args.required("--trust");
          const next = await applyRevocationList(await loadTrust(path), await readJson<RevocationList>(args.required("--list")), new Date());
          await saveTrust(path, next);
          return describeTrust(next, new Date(), 7 * DAY);
        }
        default: throw new SpacePackageError("UPDATE_INVALID", "keys init|inspect|sign-rotation|rotate|sign-revocation|revoke");
      }
    }
    default:
      return undefined;
  }
}
