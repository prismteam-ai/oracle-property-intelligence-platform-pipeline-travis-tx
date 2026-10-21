"""Publish a run's CAR files as a GitHub Release of this repository, checked against the run's pinned manifest.

README.md lines 68 and 70; decisions.md sections 7.2, 28.6 and 33. The manifest names each CAR's release asset, size,
SHA-256 and root CID. A next run's manifest marks the CARs it carries from the earlier run (`release_tag` of that run);
only the CARs first published by this run go into this run's release.

  /usr/bin/python3 -I scripts/release-cars.py <run id>

stage   -> symlinks named by release_asset, each target's size and sha256 equal to the manifest
create  -> a draft release on the fork at the commit that added the manifest
upload  -> missing or wrong assets only (idempotent; run the same command again to resume)
verify  -> every asset uploaded, its size and GitHub's sha256 digest equal to the manifest
publish -> undraft only when every asset verifies; result in data/releases/<run id>.json (gitignored data/)
"""
import glob, hashlib, json, os, subprocess, sys, time

GH = "/opt/homebrew/bin/gh"
REPO = "xucian/oracle-property-intelligence-platform-pipeline-travis-tx"
ASSIGN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = "/Users/luti/dev/ateam/role1-prism/kit-travis/skills/use-oracle/runtime/data/travis"
RUN_ID = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: release-cars.py <run id>")
MANIFEST = f"{ASSIGN}/publish/{RUN_ID}/manifest.json"
WORK = f"{ASSIGN}/data/releases/{RUN_ID}"
STAGE = f"{WORK}/stage"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(8 << 20), b""):
            h.update(b)
    return h.hexdigest()


def gh(*args, check=True):
    r = subprocess.run([GH, *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args[:3])} failed: {r.stderr.strip()[:500]}")
    return r


def own_cars(m):
    """This run's own CARs: all of run 1's; for a next run, those whose release_tag is this run's."""
    tag = m["release"]["tag"]
    return {c["release_asset"]: c for c in m["cars"] if c.get("release_tag", tag) == tag}


def notes(m, cars):
    previous = m.get("previous_run")
    total = sum(c["size"] for c in cars.values())
    kinds = {k: sum(1 for c in cars.values() if c["kind"] == k) for k in ("archive", "tables")}
    lines = [
        f"CAR exports of the directory roots that Travis County run `{RUN_ID}` first published to IPFS (README.md lines 68 and 70).",
        "",
        f"- {kinds['archive']} archive CARs (`travis-<group>-<shard>.car`) and {kinds['tables']} full tables CARs (`travis-<group>-<shard>-tables.car`), {total:,} bytes in all.",
        f"- Every asset is listed in the run's manifest, [`publish/{RUN_ID}/manifest.json`](https://github.com/{REPO}/blob/assignment/publish/{RUN_ID}/manifest.json), under `cars[]` with its `release_asset` name, `size`, `sha256` and `root_cid`. Each asset's size and SHA-256 were checked against that entry before this release was published.",
        "- Any IPFS node can import a CAR without re-encoding, for example `ipfs dag import <file>.car`; the imported root equals the entry's `root_cid`.",
    ]
    if previous:
        lines.append(f"- This run is the next run of `{previous['run_id']}`. The roots it carries unchanged keep their CIDs; their CARs are assets of release `{m['release'].get('previous_tag') or 'run-' + previous['run_id']}` (the manifest names the release of every CAR in `release_tag`).")
    lines += ["", 'The manifest\'s `release.status` reads "not created" because the manifest was pinned before this release existed. The tag and the asset names are the ones it lists.']
    return "\n".join(lines) + "\n"


def stage(cars):
    os.makedirs(STAGE, exist_ok=True)
    for name, c in sorted(cars.items()):
        if c["kind"] == "tables":
            cands = [f"{DATA}/publish/{RUN_ID}/tables-cars/{name}"]
        else:
            cands = sorted(glob.glob(f"{DATA}/runs/{RUN_ID}/shards/{c['shard']}/{c['group']}-a*/{name}"))
        hit = next((p for p in cands if os.path.exists(p) and os.path.getsize(p) == c["size"] and sha256(p) == c["sha256"]), None)
        if not hit:
            raise RuntimeError(f"no file matches {name} (candidates {cands})")
        link = f"{STAGE}/{name}"
        if os.path.islink(link):
            os.unlink(link)
        os.symlink(hit, link)
    log(f"staged {len(cars)} assets, every size and sha256 equal to the manifest")


def release_id(tag):
    for page in json.loads(gh("api", f"repos/{REPO}/releases?per_page=100").stdout):
        if page["tag_name"] == tag:
            return page["id"], page["draft"]
    return None, None


def assets(rid):
    out = gh("api", "--paginate", f"repos/{REPO}/releases/{rid}/assets?per_page=100").stdout
    rows = []
    for chunk in out.replace("][", "]\n[").splitlines():
        if chunk.strip():
            rows += json.loads(chunk)
    return {a["name"]: a for a in rows}


def good(a, c):
    return a["state"] == "uploaded" and a["size"] == c["size"] and a.get("digest") in (None, f"sha256:{c['sha256']}")


def main():
    m = json.load(open(MANIFEST))
    tag = m["release"]["tag"]
    cars = own_cars(m)
    stage(cars)
    rid, draft = release_id(tag)
    if rid is None:
        commit = subprocess.run(["git", "-C", ASSIGN, "log", "--format=%H", "-1", "--", MANIFEST], capture_output=True, text=True, check=True).stdout.strip()
        if not commit or subprocess.run(["git", "-C", ASSIGN, "branch", "-r", "--contains", commit], capture_output=True, text=True).stdout.strip() == "":
            raise RuntimeError("the manifest is not in a commit on GitHub yet; commit and push it first")
        with open(f"{WORK}/notes.md", "w") as f:
            f.write(notes(m, cars))
        gh("release", "create", tag, "--repo", REPO, "--draft", "--target", commit, "--title", f"Run {RUN_ID}: CAR files", "--notes-file", f"{WORK}/notes.md")
        for _ in range(30):
            rid, draft = release_id(tag)
            if rid:
                break
            time.sleep(2)
        if not rid:
            raise RuntimeError(f"release {tag} created but not listed after 60 s; run again to resume")
        log(f"draft release {rid} created for {tag} at {commit}")
    for attempt in range(1, 9):
        have = assets(rid)
        todo = [n for n in sorted(cars) if n not in have or not good(have[n], cars[n])]
        log(f"pass {attempt}: {len(cars) - len(todo)} of {len(cars)} uploaded, {len(todo)} to go")
        if not todo:
            break
        for i in range(0, len(todo), 10):
            batch = todo[i:i + 10]
            mb = sum(cars[n]["size"] for n in batch) / 1e6
            t0 = time.time()
            r = gh("release", "upload", tag, "--repo", REPO, "--clobber", *[f"{STAGE}/{n}" for n in batch], check=False)
            s = max(time.time() - t0, 0.001)
            log(f"  batch {i // 10 + 1} of {(len(todo) + 9) // 10}: {mb:.0f} MB in {s:.0f} s ({mb / s:.1f} MB/s) {'ok' if r.returncode == 0 else 'failed: ' + r.stderr.strip()[:200]}")
        time.sleep(5)
    have = assets(rid)
    rows = []
    for n, c in sorted(cars.items()):
        a = have.get(n)
        rows.append({"release_asset": n, "root_cid": c["root_cid"], "size": c["size"], "sha256": c["sha256"], "uploaded": bool(a and a["state"] == "uploaded"), "size_equal": bool(a and a["size"] == c["size"]), "digest": a.get("digest") if a else None, "digest_equal": bool(a and a.get("digest") == f"sha256:{c['sha256']}")})
    ok = all(r["uploaded"] and r["size_equal"] and r["digest_equal"] for r in rows)
    if ok and draft:
        gh("release", "edit", tag, "--repo", REPO, "--draft=false")
        log("published")
    url = json.loads(gh("api", f"repos/{REPO}/releases/{rid}").stdout)["html_url"]
    res = {"run_id": RUN_ID, "tag": tag, "repo": REPO, "release_url": url, "assets": len(rows), "bytes": sum(r["size"] for r in rows), "all_equal": ok, "published": ok, "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "rows": rows}
    os.makedirs(f"{ASSIGN}/data/releases", exist_ok=True)
    json.dump(res, open(f"{ASSIGN}/data/releases/{RUN_ID}.json", "w"), indent=1)
    log(f"done: all_equal={ok} {url}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
