import { spawnSync } from "node:child_process";
import { loadProject } from "./project.mjs";
import { descriptorFor } from "./sources/spec.mjs";

/**
 * Compare each lock pin with what its request points to now, like npm outdated.
 *   current  what the lock pins
 *   wanted   what `deck update <id>` would pin (the ref or range, resolved today)
 *   latest   the newest release: highest semver tag (git) or `latest` (npm)
 *
 * @typedef {{ id: string, type: string, current: string, wanted: string | null, latest: string | null, note?: string }} Row
 * @returns {Row[]}
 */
export function outdated(projectRoot) {
  const { lock } = loadProject(projectRoot);
  return lock.plugins.map((entry) => {
    const { request, resolved } = entry;
    try {
      if (resolved.type === "git") return gitRow(entry, descriptorFor(request));
      if (resolved.type === "npm") return npmRow(entry, descriptorFor(request));
      if (resolved.type === "path") {
        return { id: entry.id, type: "path", current: resolved.path, wanted: null, latest: null, note: "content is in the repo" };
      }
      return { id: entry.id, type: resolved.type, current: short(resolved.sha256 ?? resolved.sha), wanted: null, latest: null, note: "pinned by digest" };
    } catch (err) {
      return { id: entry.id, type: resolved.type, current: "?", wanted: null, latest: null, note: err.message.split("\n")[0] };
    }
  });
}

export function isOutdated(row) {
  if (row.wanted && row.wanted !== row.current) return true;
  return Boolean(row.latest && row.latest !== row.current);
}

function short(value) {
  return value ? String(value).slice(0, 12) : "?";
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error((r.stderr || `${cmd} failed`).trim());
  return r.stdout;
}

const SEMVER_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;

function compareSemver(a, b) {
  const pa = a.match(SEMVER_TAG).slice(1).map(Number);
  const pb = b.match(SEMVER_TAG).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function gitRow(entry, descriptor) {
  const ref = entry.request.ref;
  const row = { id: entry.id, type: "git", current: short(entry.resolved.sha), wanted: null, latest: null };
  if (ref && /^[0-9a-f]{40}$/.test(ref)) return { ...row, note: "pinned to a commit" };

  const lines = run("git", ["ls-remote", "--heads", "--tags", descriptor.url]).trim().split("\n").filter(Boolean);
  const refs = new Map(lines.map((line) => line.split("\t").reverse()));
  if (!ref) {
    const head = run("git", ["ls-remote", descriptor.url, "HEAD"]).trim().split("\t")[0];
    row.wanted = short(head);
  } else {
    const sha = refs.get(`refs/tags/${ref}^{}`) ?? refs.get(`refs/tags/${ref}`) ?? refs.get(`refs/heads/${ref}`);
    row.wanted = sha ? short(sha) : null;
    if (!sha) row.note = `ref "${ref}" no longer exists`;
  }

  const tags = [...refs.keys()]
    .filter((name) => name.startsWith("refs/tags/") && !name.endsWith("^{}"))
    .map((name) => name.slice("refs/tags/".length))
    .filter((tag) => SEMVER_TAG.test(tag))
    .sort(compareSemver);
  const newest = tags.at(-1);
  // A newer release only means something when the request follows a release tag.
  if (newest && ref && SEMVER_TAG.test(ref) && compareSemver(newest, ref) > 0) {
    row.latest = newest;
  }
  if (entry.nested) row.note = [row.note, "plugin pinned by its marketplace"].filter(Boolean).join("; ");
  return row;
}

function npmRow(entry, descriptor) {
  const spec = descriptor.version ? `${descriptor.package}@${descriptor.version}` : descriptor.package;
  const wantedRaw = JSON.parse(run("npm", ["view", spec, "version", "--json"]) || "null");
  const wanted = Array.isArray(wantedRaw) ? wantedRaw.at(-1) : wantedRaw;
  const latest = JSON.parse(run("npm", ["view", descriptor.package, "version", "--json"]) || "null");
  return { id: entry.id, type: "npm", current: entry.resolved.version, wanted: wanted ?? null, latest: latest ?? null };
}
