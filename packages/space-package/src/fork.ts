import type { PackageSigner } from "./crypto.js";
import { SpacePackageError, type TrustedPackagePublisher } from "./format.js";
import { packSpace, verifySpacePackage, type PackDeclaration, type PackFile } from "./package.js";

/**
 * SP2 duplication semantics, made explicit:
 *
 *   COPY     identical package bytes in another place — same package digest, nothing else changes.
 *   INSTALL  a new installation: new installation id, new state id, empty state, no authority.
 *   UPDATE   the same installation moving to a newer verified release of the same lineage.
 *   FORK     a NEW lineage (new package id) with explicit provenance and its own publisher authority,
 *            only when the parent's licence permits it. Possessing a file is never ownership.
 */
export function forkPermitted(license: { duplication: string; redistribution: boolean }): boolean {
  return license.redistribution === true && license.duplication === "ALLOWED";
}

export async function forkSpace(input: {
  parent: Uint8Array;
  parentPublishers: readonly TrustedPackagePublisher[];
  runtime: { version: string };
  declaration: PackDeclaration;
  /** Defaults to the parent's verified assets. */
  files?: readonly PackFile[];
  /** The fork's own publisher key — never the parent publisher's. */
  signer: PackageSigner;
}): Promise<{ bytes: Uint8Array; parent: { packageId: string; version: string; integrityRoot: string } }> {
  const parent = await verifySpacePackage(input.parent, { publishers: input.parentPublishers, runtime: input.runtime });
  if (!forkPermitted(parent.manifest.license)) throw new SpacePackageError("FORK_NOT_PERMITTED", `licence ${parent.manifest.license.spdx}: duplication ${parent.manifest.license.duplication}, redistribution ${parent.manifest.license.redistribution}`);
  if (input.declaration.package.id === parent.manifest.package.id) throw new SpacePackageError("WRONG_LINEAGE", "a fork needs its own package id");
  if (input.signer.publisherId === parent.manifest.publisher.publisherId) throw new SpacePackageError("PUBLISHER_CHANGED", "a fork is published under the forker's own authority");
  const provenanceParent = { packageId: parent.manifest.package.id, version: parent.manifest.package.version, integrityRoot: parent.integrityRoot };
  const files = input.files ?? parent.manifest.assets.map((asset) => ({ path: asset.path, mediaType: asset.mediaType, bytes: parent.assets.get(asset.path)! }));
  const declaration: PackDeclaration = { ...input.declaration, provenance: { ...input.declaration.provenance, parent: provenanceParent } };
  const { bytes } = await packSpace({ declaration, files, signer: input.signer });
  return { bytes, parent: provenanceParent };
}
