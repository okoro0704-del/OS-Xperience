import {
  generateCatalogSigningKeyPair,
  importCatalogPrivateKey,
  importCatalogPublicKey,
  type CatalogKeyPairExport,
} from "@digiconomy/xperience-contract";

let cached: {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeySpkiBase64: string;
} | null = null;

/**
 * Server-only catalog signing keys (Ed25519).
 * Private key never leaves the process / env — clients receive publicKeySpkiBase64 only.
 */
export async function getCatalogSigningKeys(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeySpkiBase64: string;
}> {
  if (cached) return cached;
  const priv = process.env.XPERIENCE_CATALOG_PRIVATE_KEY_PKCS8?.trim();
  const pub = process.env.XPERIENCE_CATALOG_PUBLIC_KEY_SPKI?.trim();
  if (priv && pub) {
    cached = {
      privateKey: await importCatalogPrivateKey(priv),
      publicKey: await importCatalogPublicKey(pub),
      publicKeySpkiBase64: pub,
    };
    return cached;
  }
  const generated = await generateCatalogSigningKeyPair();
  cached = {
    privateKey: generated.privateKey,
    publicKey: generated.publicKey,
    publicKeySpkiBase64: generated.publicKeySpkiBase64,
  };
  // Surface public key for ops in non-production so clients can be configured.
  if (process.env.NODE_ENV !== "production") {
    process.env.XPERIENCE_CATALOG_PUBLIC_KEY_SPKI = generated.publicKeySpkiBase64;
  }
  return cached;
}

export async function exportGeneratedCatalogKeysForTests(): Promise<CatalogKeyPairExport> {
  cached = null;
  delete process.env.XPERIENCE_CATALOG_PRIVATE_KEY_PKCS8;
  delete process.env.XPERIENCE_CATALOG_PUBLIC_KEY_SPKI;
  const generated = await generateCatalogSigningKeyPair();
  process.env.XPERIENCE_CATALOG_PRIVATE_KEY_PKCS8 = generated.privateKeyPkcs8Base64;
  process.env.XPERIENCE_CATALOG_PUBLIC_KEY_SPKI = generated.publicKeySpkiBase64;
  cached = {
    privateKey: generated.privateKey,
    publicKey: generated.publicKey,
    publicKeySpkiBase64: generated.publicKeySpkiBase64,
  };
  return {
    publicKeySpkiBase64: generated.publicKeySpkiBase64,
    privateKeyPkcs8Base64: generated.privateKeyPkcs8Base64,
  };
}

export function resetCatalogSigningKeysForTests(): void {
  cached = null;
}
