import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyWorkingTree } from "../worktree.mjs";
import { safeSegment } from "../paths.mjs";

/**
 * Fetch a descriptor into the deck cache and say exactly what was fetched.
 * @typedef {import("./spec.mjs").Descriptor} Descriptor
 * @typedef {{ type: "git", url: string, sha: string }
 *   | { type: "npm", package: string, version: string, integrity?: string }
 *   | { type: "archive", url: string, sha256: string }
 *   | { type: "local", path: string, sha: string }} Resolved
 * @returns {Promise<{ root: string, resolved: Resolved }>}
 */
export async function fetchSource(descriptor) {
  switch (descriptor.type) {
    case "git":
      return fetchGit(descriptor);
    case "npm":
      return fetchNpm(descriptor);
    case "archive":
      return fetchArchive(descriptor);
    case "local": {
      const { root, resolved } = copyWorkingTree(descriptor.path);
      return { root, resolved: { type: "local", path: path.resolve(descriptor.path), sha: resolved } };
    }
    default:
      throw new Error(`Cannot fetch source type "${descriptor.type}"`);
  }
}

export function cacheRoot() {
  return process.env.DECK_CACHE || path.join(os.homedir(), ".cache", "pinkpuma-deck");
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "").trim() || `${cmd} ${args.join(" ")} failed`);
  }
  return r.stdout;
}

function tryRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
  return r.status === 0;
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * `DECK_LOCAL_owner__repo` points a GitHub repository at a local checkout.
 * The current branch and `HEAD` read the working tree, including uncommitted
 * files; any other ref is checked out from a local clone.
 */
function localCheckout(repo) {
  if (!repo) return null;
  const key = `DECK_LOCAL_${repo.replaceAll("/", "__")}`;
  const value = process.env[key];
  if (!value) return null;
  if (!fs.existsSync(path.join(value, ".git"))) {
    throw new Error(`${key} does not point at a git checkout: ${value}`);
  }
  return value;
}

function headCommit(dir) {
  return run("git", ["-C", dir, "rev-parse", "HEAD"]).trim();
}

/**
 * Shallow fetch of one ref or commit. A commit already checked out is not
 * fetched again: a SHA never moves.
 */
async function fetchGit(descriptor) {
  const want = descriptor.sha || descriptor.ref || "HEAD";
  const local = localCheckout(descriptor.repo);
  if (local) {
    const branch = run("git", ["-C", local, "rev-parse", "--abbrev-ref", "HEAD"]).trim();
    if (!descriptor.sha && (want === "HEAD" || want === branch)) {
      const { root, resolved } = copyWorkingTree(local);
      return { root, resolved: { type: "git", url: descriptor.url, sha: resolved } };
    }
  }

  const dest = path.join(cacheRoot(), "git", safeSegment(descriptor.url), safeSegment(want));
  if (fs.existsSync(path.join(dest, ".git")) && SHA.test(want) && headCommit(dest) === want) {
    return { root: dest, resolved: { type: "git", url: descriptor.url, sha: want } };
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const origin = local ?? descriptor.url;
  run("git", ["-C", dest, "init", "-q"]);
  run("git", ["-C", dest, "remote", "add", "origin", origin]);
  const shallow = tryRun("git", ["-C", dest, "fetch", "-q", "--depth", "1", "origin", want]);
  if (shallow) {
    run("git", ["-C", dest, "checkout", "-q", "--force", "FETCH_HEAD"]);
  } else {
    // Servers that refuse a fetch by SHA, or a ref that is neither branch nor tag.
    run("git", ["-C", dest, "fetch", "-q", "--tags", "origin"]);
    run("git", ["-C", dest, "checkout", "-q", "--force", want]);
  }
  const sha = headCommit(dest);
  if (descriptor.sha && sha !== descriptor.sha) {
    throw new Error(`${descriptor.url}: expected commit ${descriptor.sha}, got ${sha}`);
  }
  return { root: dest, resolved: { type: "git", url: descriptor.url, sha } };
}

/** `npm pack` never runs the package's scripts; the tarball is unpacked as is. */
async function fetchNpm(descriptor) {
  const spec = descriptor.version ? `${descriptor.package}@${descriptor.version}` : descriptor.package;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "deck-npm-"));
  try {
    const args = ["pack", spec, "--json", "--ignore-scripts", "--pack-destination", work];
    if (descriptor.registry) args.push("--registry", descriptor.registry);
    const out = JSON.parse(run("npm", args, { cwd: work }));
    const info = Array.isArray(out) ? out[0] : out;
    const dest = path.join(
      cacheRoot(),
      "npm",
      safeSegment(`${info.name}@${info.version}`),
    );
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    run("tar", ["-xzf", path.join(work, info.filename), "-C", dest]);
    const root = path.join(dest, "package");
    return {
      root: fs.existsSync(root) ? root : dest,
      resolved: {
        type: "npm",
        package: info.name,
        version: info.version,
        ...(info.integrity ? { integrity: info.integrity } : {}),
      },
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function fetchArchive(descriptor) {
  const response = await fetch(descriptor.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${descriptor.url}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (descriptor.sha256 && descriptor.sha256.toLowerCase() !== sha256) {
    throw new Error(`${descriptor.url}: sha256 is ${sha256}, expected ${descriptor.sha256}`);
  }
  const dest = path.join(cacheRoot(), "archive", sha256);
  if (!fs.existsSync(dest)) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "deck-archive-"));
    try {
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const file = path.join(work, isZip ? "a.zip" : "a.tgz");
      fs.writeFileSync(file, bytes);
      const out = path.join(work, "out");
      fs.mkdirSync(out);
      if (isZip) run("unzip", ["-q", file, "-d", out]);
      else run("tar", ["-xzf", file, "-C", out]);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(out, dest);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  return { root: archiveRoot(dest), resolved: { type: "archive", url: descriptor.url, sha256 } };
}

/** The plugin may sit at the top of the archive or one directory down. */
function archiveRoot(dir) {
  const entries = fs.readdirSync(dir).filter((name) => name !== "__MACOSX" && !name.startsWith("."));
  if (entries.length === 1 && fs.statSync(path.join(dir, entries[0])).isDirectory()) {
    return path.join(dir, entries[0]);
  }
  return dir;
}

/** Pin a descriptor to what a previous fetch resolved, for a reproducible install. */
export function pinDescriptor(descriptor, resolved) {
  if (!resolved || resolved.type !== descriptor.type) return descriptor;
  switch (descriptor.type) {
    case "git":
      return { ...descriptor, sha: resolved.sha };
    case "npm":
      return { ...descriptor, package: resolved.package, version: resolved.version };
    case "archive":
      return { ...descriptor, sha256: resolved.sha256 };
    default:
      return descriptor;
  }
}
