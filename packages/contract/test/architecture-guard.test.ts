import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LIFEOS_PRIMITIVE_IDS } from "../src/index.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const SCAN_ROOTS = [
  join(repoRoot, "apps", "web", "src"),
  join(repoRoot, "apps", "demo-notes", "src"),
  join(repoRoot, "packages", "contract", "src"),
  join(repoRoot, "packages", "runtime", "src"),
  join(repoRoot, "packages", "sdk", "src"),
];

const PACKAGE_JSONS = [
  join(repoRoot, "package.json"),
  join(repoRoot, "apps", "web", "package.json"),
  join(repoRoot, "apps", "demo-notes", "package.json"),
  join(repoRoot, "packages", "contract", "package.json"),
  join(repoRoot, "packages", "runtime", "package.json"),
  join(repoRoot, "packages", "sdk", "package.json"),
];

const FORBIDDEN = [
  { id: "bullmq", re: /from\s+["']bullmq["']|require\(["']bullmq["']\)/ },
  { id: "prisma", re: /from\s+["']@prisma\/client["']|datasource\s+db\b/ },
  { id: "lifeos-shell-core", re: /from\s+["']@lifeos\/shell-core["']/ },
  { id: "lifeos-bridge", re: /class\s+LifeOSBridge\b|window\.LifeOSBridge/ },
  { id: "shell-primitive", re: /class\s+(ShellPrimitive|OsShellEngine|CapabilityPrimitive|AppStorePrimitive)\b/ },
  { id: "fake-browser", re: /class\s+(FakeBrowser|InProcessWebViewServer|LocalStreamingBackend)\b/ },
  { id: "device-clone", re: /class\s+(DeviceService|DeviceBackend|ShellDeviceEngine|FakeDeviceBridge)\b/ },
  { id: "wallet-ledger", re: /class\s+(WalletLedger|LocalWalletEngine|PaymentPrimitive|CheckoutPrimitive)\b/ },
  { id: "local-queue", re: /class\s+(LocalQueue|InMemoryQueue|BullWorker|JobWorker)\b/ },
  { id: "credential-sharing", re: /class\s+(SharedOwnerCredentials|CredentialRelay)\b/ },
  { id: "production-models", re: /model\s+(ProductionSession|ProductionDevice|VideoAsset|CameraAsset)\b/ },
  { id: "url-token", re: /searchParams\.set\(\s*["'](trustId|token)["']/ },
  { id: "allow-all", re: /\ballow_all\b\s*[:=]\s*true|\bsuper_app\b\s*[:=]\s*true/ },
  { id: "github-primitive", re: /class\s+(GitHubPrimitive|NetlifyPrimitive|GitHubEngine|NetlifyEngine)\b/ },
  { id: "token-vault", re: /class\s+(TokenVault|CredentialVault|ShellSecretStore|IdentityDatabase)\b/ },
  { id: "biometric-engine", re: /class\s+(BiometricEngine|ShellWalletEngine|CommerceEngine|LiveEngine|ShellIdentityEngine|ShellFileStore|ShellMessagingEngine|ShellQueue|ShellDatabase)\b/ },
  { id: "camera-service", re: /class\s+(ShellCameraService|CameraBackend|DeviceCameraEngine|ShellMediaStreamStore|ShellAssetEngine|UniversalAssetApi)\b/ },
  { id: "app-installer", re: /class\s+(AppInstaller|AppMarketplace|PackageManager|AppSigningService|AppStoreBackend|AppBillingEngine|RecommendationEngine)\b/ },
  { id: "first-party-only-api", re: /class\s+FirstPartyShellAPI\b|function\s+firstPartyLaunch\s*\(/ },
  { id: "shell-getusermedia", re: /getUserMedia\s*\(/ },
  { id: "wildcard-post", re: /\.postMessage\([^,]+,\s*["']\*["']\s*\)/ },
  { id: "digiconomy-internal-import", re: /from\s+["']@(?:mybrandos|lifeos)\// },
  { id: "permission-inheritance", re: /inherit(?:Grants|Permissions)\s*\(|transferGrants\s*\(/ },
  { id: "interop-backend", re: /class\s+(IntentBroker|ContextDatabase|InteropServer|ApplicationMessageQueue)\b/ },
  { id: "session-backend", re: /class\s+(SessionEngine|SessionDatabase|WorkflowEngine|StateEngine|ContextEngine|InteroperabilityEngine)\b/ },
  { id: "object-action-backend", re: /class\s+(ActionEngine|ObjectEngine|SearchEngine|UniversalObjectApi|ObjectDatabase|ActionServer)\b/ },
  { id: "search-backend", re: /class\s+(ElasticSearch|OpenSearch|VectorDatabase|GlobalSearchIndex|DigitalLifeSearchDatabase|SearchCrawler)\b/ },
  { id: "task-workflow-backend", re: /class\s+(TaskEngine|WorkflowEngine|UniversalWorkflowDB|GlobalTaskDB|AIPlanner|AnalyticsEngine|ApplicationDataMirror|UniversalObjectDB|ObjectiveEngine|ProcessEngine|AutomationEngine)\b/ },
  { id: "preference-backend", re: /class\s+(PreferenceBackend|UniversalPreferenceDB|RoutingEngine|BehaviorEngine|RecommendationEngine|PersonalizationEngine|CredentialStore|ShellPaymentEngine|ShellMessagingEngine|UniversalAppBackend)\b/ },
  { id: "continuity-backend", re: /class\s+(WorkflowEngine|WorkflowBackend|TaskEngine|UniversalWorkflowDB|ActivityGraph|BehaviorGraph|CloudContextBackend|CrossAppStateDatabase|CredentialHandoff|UniversalSessionBackend|ShellExecutionEngine|ShellMediaEngine|ShellCameraEngine|ShellAudioEngine)\b/ },
  { id: "shell-owned-objects", re: /class\s+(PublicAsset|ShellAsset|ShellProject|UniversalDocument|UniversalMedia)\b/ },
  { id: "personal-context-backend", re: /class\s+(UniversalContextDB|CloudContextBackend|PersonalDataLake|DigitalTwin|BehaviorGraph|ActivityGraph|RecommendationEngine|AIPlanner|UniversalStateStore|CrossAppDatabase|ShellAssetStore|ShellProjectStore|ShellMediaEngine|ShellDeviceEngine|ShellRecordingEngine|ContextEngine|PersonalizationEngine)\b/ },
  { id: "fake-shell-assets", re: /class\s+(PublicAsset|ShellAsset|UniversalAsset|WebsiteAsset|ContextAsset)\b/ },
  { id: "marketplace-installer", re: /class\s+(MarketplaceBackend|AppStoreBackend|AppInstallationEngine|UniversalInstaller|ShellFilesystem|ShellNotificationBackend|ShellCommerceEngine|ShellDeviceEngine)\b/ },
];

const FORBIDDEN_DEPS = [
  "bullmq",
  "prisma",
  "@prisma/client",
  "@lifeos/shell-core",
  "ioredis",
  "redis",
  "ws",
  "socket.io",
  "minio",
  "@aws-sdk/client-s3",
];

function walk(dir: string, files: string[] = []): string[] {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full, files);
      else if (extname(full) === ".ts" || extname(full) === ".tsx") files.push(full);
    }
  } catch {
    /* missing root is a scan miss later */
  }
  return files;
}

test("OS Shell does not recreate primitives, engines, or a backend", () => {
  const hits: string[] = [];
  const shellOwnedRoots = SCAN_ROOTS.filter((root) => !root.includes(`${join("apps", "demo-notes")}`));
  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8");
      for (const rule of FORBIDDEN) {
        // External demo apps own browser camera execution; Shell/SDK must not.
        if (rule.id === "shell-getusermedia" && !shellOwnedRoots.includes(root)) continue;
        if (rule.re.test(source)) hits.push(`${rule.id}: ${file}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

test("package manifests do not own forbidden infrastructure", () => {
  const hits: string[] = [];
  for (const file of PACKAGE_JSONS) {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of FORBIDDEN_DEPS) {
      if (name in deps) hits.push(`${name}: ${file}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("still exactly six primitives after the Shell exists", () => {
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});
