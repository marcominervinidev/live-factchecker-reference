#!/usr/bin/env python3
"""Tool images are pinned once: the workflows and make ci-local run the same image (ticket #68, review round 2, A1).

Reads every `.github/workflows/*.yml` and `*.yaml` (YAML comments left out) and `scripts/ci/local.sh` and collects the
pins `<name>:<tag>@sha256:<digest>`; `docker.io/` and `library/` in front of a name are dropped (Docker Hub's defaults).
A problem is
  1. an image name with more than one pin (another tag or another digest) across these files;
  2. a pinned image that also appears as `<name>:<tag>` without a digest;
  3. GITLEAKS_VERSION (the release tarball of ci.yml) other than the tag of the gitleaks image of ci-local (`v<version>`).
Bump a pin in every file at once; Dependabot bumps only the workflows, so its PR stays red until local.sh follows.

Usage: python3 -I tools/check_ci_pins.py [--root DIR]
Exit 1 with one line per problem. Stdlib only; runs in ci.yml repo-checks, the pre-commit hook and make ci-local.
"""
import pathlib, re, sys

LOCAL = "scripts/ci/local.sh"
PIN = re.compile(r"(?<![\w./-])([a-z0-9][a-z0-9._/-]*):([\w.-]+)@sha256:([0-9a-f]{64})")
HUB = r"(?:docker\.io/)?(?:library/)?"
YAML_COMMENT = re.compile(r"(^|\s)#.*$", re.M)
GITLEAKS_VERSION = re.compile(r"^\s*GITLEAKS_VERSION:\s*['\"]?([\w.-]+)", re.M)


def canonical(name: str) -> str:
    return re.sub(rf"^{HUB}", "", name, count=1)


def sources(root: pathlib.Path):
    workflows = root / ".github" / "workflows"
    files = sorted([*workflows.glob("*.yml"), *workflows.glob("*.yaml")])
    local = root / LOCAL
    return files + [local] if local.is_file() else files


def read(path: pathlib.Path) -> str:
    text = path.read_text(encoding="utf-8")
    return YAML_COMMENT.sub(r"\1", text) if path.suffix in (".yml", ".yaml") else text


def check(root: pathlib.Path):
    problems = []
    if not (root / LOCAL).is_file():
        problems.append(f"{LOCAL} missing: make ci-local keeps its pins there")
    texts = {f.relative_to(root).as_posix(): read(f) for f in sources(root)}
    pins = {}  # name -> {"tag@digest": [file, ...]}
    for rel, text in texts.items():
        for name, tag, digest in PIN.findall(text):
            files = pins.setdefault(canonical(name), {}).setdefault(f"{tag}@sha256:{digest}", [])
            if rel not in files:
                files.append(rel)
    for name, seen in sorted(pins.items()):
        if len(seen) > 1:
            where = "; ".join(f"{pin[:24]}… in {', '.join(files)}" for pin, files in sorted(seen.items()))
            problems.append(f"{name}: {len(seen)} different pins ({where})")
        bare = re.compile(rf"(?<![\w./-]){HUB}{re.escape(name)}:([\w.-]+)(?![\w.-]|@sha256:)")
        for rel, text in texts.items():
            for tag in bare.findall(text):
                problems.append(f"{rel}: {name}:{tag} without a digest (pinned elsewhere)")
    ci = texts.get(".github/workflows/ci.yml", "")
    version = GITLEAKS_VERSION.search(ci)
    if version:
        tags = sorted({pin.split("@")[0] for name, seen in pins.items() if name.endswith("/gitleaks") for pin in seen})
        if not tags:
            problems.append(f"GITLEAKS_VERSION {version.group(1)} in ci.yml, but no gitleaks image pinned in {LOCAL}")
        elif any(tag not in (version.group(1), f"v{version.group(1)}") for tag in tags):
            problems.append(f"GITLEAKS_VERSION {version.group(1)} in ci.yml, gitleaks image tag {', '.join(tags)}")
    return problems


def main(argv):
    root = pathlib.Path(__file__).resolve().parents[1]
    if "--root" in argv:
        at = argv.index("--root") + 1
        if at >= len(argv) or argv[at].startswith("-"):
            print("usage: python3 -I tools/check_ci_pins.py [--root DIR]", file=sys.stderr)
            return 2
        root = pathlib.Path(argv[at])
    problems = check(root)
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} pin problem(s)", file=sys.stderr)
        return 1
    print("ci pins ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
