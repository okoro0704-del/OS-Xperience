import { spawnSync } from "node:child_process";

function aaptDump(aapt, args) {
  const r = spawnSync(aapt, ["dump", ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`aapt dump ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

/**
 * Problems with an APK's packaged network security config; empty when no host may use cleartext.
 * Release resource paths are shortened (res/xml/… → res/8G.xml), so the file is found through the resource table.
 */
export function cleartextPolicyProblems(aapt, apk) {
  const table = aaptDump(aapt, ["--values", "resources", apk]);
  const entry = table.match(/:xml\/network_security_config: t=0x03[^\n]*\r?\n\s*\(string8\) "([^"]+)"/);
  if (!entry) return ["APK carries no network_security_config"];
  const xml = aaptDump(aapt, ["xmltree", apk, entry[1]]);
  const flags = [...xml.matchAll(/cleartextTrafficPermitted[^=]*=\(type 0x12\)(0x[0-9a-f]+)/g)].map((m) => m[1]);
  const problems = [];
  if (!flags.length) problems.push("network_security_config declares no cleartext policy");
  if (flags.some((value) => value !== "0x0")) problems.push("network_security_config permits cleartext traffic");
  if (/E: domain-config/.test(xml)) problems.push("network_security_config carries a domain-config exception");
  return problems;
}
