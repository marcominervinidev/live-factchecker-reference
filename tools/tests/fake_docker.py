"""A fake `docker` for the Make target tests of #168 (test_ci_stack_down_images.py) and #182 (test_docker_clean.py).

The tests put a wrapper named `docker` first on PATH that runs this file. It keeps a Docker of its own in the JSON
file LFC_FAKE_STATE (images with id, tags, labels and size, containers with state and labels, volumes, build cache
records with their age in hours), answers the calls below as Docker does, changes that file as Docker would change
its store and appends one line per call to LFC_FAKE_LOG (argv, class, result ok | failed | forbidden | unsupported).
It never talks to a Docker daemon. The tests assert on what is left in the state file, not on the wording of a call.

Modelled calls; anything else, an unknown option or template field included, exits 64 with "fake docker: this call
is not modelled by the test" and the test fails on it:
- `image ls`, `images`: `-a`, `-q` (one id per tag line, as Docker: an id with two tags shows twice), `--no-trunc`,
  `--filter label=<key>[=<value>]`, `reference=<pattern>` (`*` stops at `/` as in Docker), `dangling=true|false`, one
  REPOSITORY[:TAG], `--format` with `.Repository`, `.Tag`, `.ID`, `.Size`, `.CreatedSince`, `json`, an optional
  leading `table`; an untagged image shows as `<none>:<none>`.
- `image inspect <ref|id>...`: JSON (`Id`, `RepoTags`, `Size` in bytes, `Config.Labels`), or `--format` with `.Id`,
  `.Size`, `.RepoTags`, `json .RepoTags`, `range .RepoTags`, `json .Config.Labels`, `index .Config.Labels "<key>"`.
- `image rm`, `rmi`: by reference or id, `-f`. As in Docker it fails (exit 1) without an argument, for a missing
  image, for an image a container uses (a running one also with `-f`) and for an id with several tags without `-f`;
  removing one of several tags only untags; with `-f` an image that only stopped containers use loses the tag (by
  id: every tag) and stays untagged here (see the last paragraph); with `-f` an id with several tags and no container
  goes with all its tags.
  LFC_FAKE_FAIL=image-rm makes every removal fail.
- `image prune`: `-a`, `-f`, `--filter label=`; without `-f` it asks on stdin. Without a label filter it is the class
  image-prune-unfiltered.
- `ps`, `container ls`: `-a`, `-q`, `--no-trunc`, `--filter label=`, `status=`, `name=`, `ancestor=<ref|id>`,
  `--format` with `.ID`, `.Names`, `.Image`, `.State`, `.Status`, `.Labels`, `.Label "<key>"`, `json`.
- `compose [-p <name>] [--profile <p>] [-f <file>] [--project-directory <dir>] <command>` for the services of this
  repository's compose.yml; the project is `-p`, COMPOSE_PROJECT_NAME or live-factchecker-v2. `config --images` (the
  pinned Redis and Caddy, `<registry>/detection:${LFC_TAG:-local}` with LFC_REGISTRY or, unset, the local registry
  the test names in LFC_FAKE_REGISTRY, `<project>-<service>` for toolbox, toolbox-it and stack-client when their
  profile is on); `down` (`-v`, `--remove-orphans`, `--rmi local|all`, `-t`):
  removes the project's containers of the active services, with `-v` its volumes, with `--rmi` those images, and
  fails as a whole with LFC_FAKE_FAIL=compose-down; `ls` (`-a`, `-q`, `--format json`, `--filter name=`); `ps` (`-a`,
  `-q`, `--status`, `--format`); `build`, `up`, `run`, `exec` (prints a dummy PEM, the edge root CA), `start`, `stop`,
  `restart`, `rm`, `kill`, `pull`, `create` change nothing (class compose-change).
- `system df`: `-v`, `--format` with `.Type`, `.TotalCount`, `.Active`, `.Size`, `.Reclaimable`, `json`.
- `builder du`, `buildx du`; `builder prune`, `buildx prune`: `-a`, `-f`, `--filter until=<hours, minutes, seconds>`
  (records used longer ago than that go; no filter: all); without `-f` it asks on stdin.
- `volume ls`, `version`, `info`.
- Never modelled, only recorded (classes system-prune, volume-change, daemon-change): `system prune`, every other
  `volume` call, `rm`, `stop`, `kill`, `run`, `build`, `pull`, `tag`, `network`, `container <change>` and the like.
A test names the classes it forbids in LFC_FAKE_FORBID: such a call is recorded as forbidden, changes nothing and
exits 0, and the test fails on the record.
Where the fake decides and the real Docker may differ (a real run has to show these, the tests cannot):
- `compose down --rmi`: here it exits 1 when an image removal fails; the real Compose may only warn and exit 0.
- `builder prune` without `-a`: here every record older than the filter goes; the real BuildKit may keep some.
- `image rm -f` of an image that only stopped containers use: here the tag goes and the image stays untagged. What
  the real Docker does depends on its image store (the classic store removes the image, containerd keeps it
  untagged) and is not proven. The tag is gone either way, the cases do not depend on which of the two happens, and
  no real run shows it, because `-f` is forbidden for both targets.
- Nothing changes between two calls: there is no race between listing and removing.
Stdlib only; not a test module (unittest discovers test*.py only).
"""
import json, os, re, sys

STATE, LOG = os.environ["LFC_FAKE_STATE"], os.environ["LFC_FAKE_LOG"]
FORBID = set(os.environ.get("LFC_FAKE_FORBID", "").split())
FAIL = set(os.environ.get("LFC_FAKE_FAIL", "").split())
PROJECT, SERVICE = "com.docker.compose.project", "com.docker.compose.service"
CORE = ["redis", "detection", "edge"]
BY_PROFILE = {"toolbox": ["toolbox"], "integration": ["toolbox-it"], "client": ["stack-client"]}
PINNED = {"redis": "redis:8.10.3-alpine@sha256:" + "21" * 32, "edge": "caddy:2.11.7-alpine@sha256:" + "e7" * 32}
PEM = "-----BEGIN CERTIFICATE-----\nTUZD\n-----END CERTIFICATE-----"
CHANGES = {"rm", "stop", "kill", "start", "restart", "run", "exec", "create", "build", "pull", "push", "tag",
           "load", "save", "import", "commit", "rename", "update", "cp", "network", "container", "swarm", "stack"}


class Unsupported(Exception):
    pass


def size(mb):
    return "%.4gGB" % (mb / 1000.0) if mb >= 1000 else "%dMB" % mb


def parse(args, spec):
    """spec: option -> (name, takes a value). Returns the options (values as lists) and the positional arguments."""
    opts, rest, i = {}, [], 0
    while i < len(args):
        a = args[i]
        if a.startswith("--") and "=" in a and a.split("=", 1)[0] in spec and spec[a.split("=", 1)[0]][1]:
            opts.setdefault(spec[a.split("=", 1)[0]][0], []).append(a.split("=", 1)[1])
        elif a in spec and spec[a][1]:
            i += 1
            if i >= len(args):
                raise Unsupported("option without a value: " + a)
            opts.setdefault(spec[a][0], []).append(args[i])
        elif a in spec:
            opts[spec[a][0]] = True
        elif re.fullmatch(r"-[A-Za-z]{2,}", a) and all("-" + c in spec and not spec["-" + c][1] for c in a[1:]):
            for c in a[1:]:
                opts[spec["-" + c][0]] = True
        elif a.startswith("-"):
            raise Unsupported("option " + a)
        else:
            rest.append(a)
        i += 1
    return opts, rest


def render(fmt, rows, columns):
    """The docker --format subset: json, {{json .}}, {{.Field}}, {{.Label "key"}}, an optional leading `table`."""
    public = [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]
    if fmt is None:
        widths = [max([len(c)] + [len(str(r[c])) for r in public]) for c in columns]
        head = [re.sub(r"(?<=[a-z])(?=[A-Z])", " ", c).upper() for c in columns]
        return ["   ".join(str(v).ljust(w) for v, w in zip(line, widths)).rstrip()
                for line in [head] + [[r[c] for c in columns] for r in public]]
    if fmt.strip() in ("json", "{{json .}}"):
        return [json.dumps(r) for r in public]
    table = fmt.startswith("table")
    fmt = (fmt[5:].lstrip() if table else fmt).replace("\\t", "\t").replace("\\n", "\n")
    token = re.compile(r'\{\{\s*(?:\.(\w+)|\.Label\s+"([^"]*)")\s*\}\}')

    def one(row):
        def sub(m):
            if m.group(2) is not None:
                return row.get("_labels", {}).get(m.group(2), "")
            if m.group(1) not in row or m.group(1).startswith("_"):
                raise Unsupported("template field ." + m.group(1))
            return str(row[m.group(1)])
        text = token.sub(sub, fmt)
        if "{{" in text:
            raise Unsupported("template " + fmt)
        return text
    lines = [one(r) for r in rows]
    return ([token.sub(lambda m: (m.group(1) or m.group(2)).upper(), fmt)] if table else []) + lines


def labelled(labels, filters):
    for f in filters:
        key, _, value = f.partition("=")
        if key not in labels or ("=" in f and labels[key] != value):
            return False
    return True


def split_filters(values, known):
    out = {k: [] for k in known}
    for v in values or []:
        key, _, value = v.partition("=")
        if key not in known:
            raise Unsupported("filter " + v)
        out[key].append(value)
    return out


def glob(pattern, text, slash):
    rx = "".join((".*" if slash else "[^/]*") if c == "*" else "." if c == "?" else re.escape(c) for c in pattern)
    return re.fullmatch(rx, text) is not None


def by_reference(tag, pattern):
    repo, _, version = tag.rpartition(":")
    last = pattern.rsplit("/", 1)[-1]
    if ":" in last:
        want_repo, _, want_version = pattern.rpartition(":")
        return glob(want_repo, repo, False) and glob(want_version, version, True)
    return glob(pattern, repo, False)


def find(state, ref):
    name = ref.split("@", 1)[0]
    if name:
        wanted = name if ":" in name.rsplit("/", 1)[-1] else name + ":latest"
        for image in state["images"]:
            if wanted in image["tags"]:
                return image, wanted
    digest = ref[7:] if ref.startswith("sha256:") else ref
    if re.fullmatch(r"[0-9a-f]{4,64}", digest):
        hits = [i for i in state["images"] if i["id"][7:].startswith(digest)]
        if len(hits) == 1:
            return hits[0], None
    return None, None


def remove(state, ref, force):
    """docker image rm for one reference; returns the daemon's error or None."""
    if "image-rm" in FAIL:
        return "Error response from daemon: fake docker: removing %s fails in this test" % ref
    image, tag = find(state, ref)
    if image is None:
        return "Error response from daemon: No such image: " + ref
    if tag is not None and len(image["tags"]) > 1:
        image["tags"].remove(tag)
        return None
    users = [c for c in state["containers"] if c["image"] == image["id"]]
    if users and (not force or any(c["state"] == "running" for c in users)):
        return "Error response from daemon: conflict: unable to delete %s - image is being used by a container" % ref
    if tag is None and len(image["tags"]) > 1 and not force:
        return ("Error response from daemon: conflict: unable to delete %s (must be forced) - image is referenced "
                "in multiple repositories" % ref)
    if users:  # forced, stopped containers only: the tag goes (by id: every tag); whether Docker keeps the image: header
        image["tags"] = [] if tag is None else [t for t in image["tags"] if t != tag]
        return None
    state["images"].remove(image)
    return None


def image_rows(state, images, full):
    rows = []
    for image in images:
        for tag in image["tags"] or ["<none>:<none>"]:
            repo, _, version = tag.rpartition(":")
            rows.append({"Repository": repo, "Tag": version, "ID": image["id"] if full else image["id"][7:19],
                         "CreatedSince": "%d days ago" % image.get("days", 3), "Size": size(image["mb"]),
                         "Digest": "<none>", "_id": image["id"]})
    return rows


def container_rows(state, containers, full):
    status = {"running": "Up 2 hours", "exited": "Exited (0) 3 days ago", "created": "Created"}
    rows = []
    for c in containers:
        image = next((i for i in state["images"] if i["id"] == c["image"]), None)
        rows.append({"ID": c["id"] if full else c["id"][:12], "Image": (image["tags"] or [image["id"][7:19]])[0]
                     if image else c["image"][7:19], "Command": '"run"', "CreatedAt": "2026-11-01 08:00:00 +0100 CET",
                     "RunningFor": "3 days ago", "Status": status[c["state"]], "Ports": "", "Names": c["name"],
                     "State": c["state"], "Labels": ",".join("%s=%s" % kv for kv in sorted(c["labels"].items())),
                     "_labels": c["labels"]})
    return rows


def confirmed(opts):
    if opts.get("force"):
        return True
    sys.stdout.write("Are you sure you want to continue? [y/N] ")
    return sys.stdin.readline().strip().lower() == "y"


def hours(duration):
    if not re.fullmatch(r"(\d+(\.\d+)?(h|m|s))+", duration):
        raise ValueError(duration)
    return sum(float(n) * {"h": 1, "m": 1 / 60.0, "s": 1 / 3600.0}[u] for n, _, u in re.findall(r"(\d+(\.\d+)?)(h|m|s)", duration))


def images_cmd(state, args):
    opts, rest = parse(args, {"-a": ("all", False), "--all": ("all", False), "-q": ("quiet", False),
                              "--quiet": ("quiet", False), "--no-trunc": ("full", False), "-f": ("filter", True),
                              "--filter": ("filter", True), "--format": ("format", True)})
    filters = split_filters(opts.get("filter"), ("label", "reference", "dangling"))
    if len(rest) > 1 or any(d not in ("true", "false") for d in filters["dangling"]):
        raise Unsupported("image ls " + " ".join(args))
    rows = []
    for row in image_rows(state, state["images"], opts.get("full")):
        image = next(i for i in state["images"] if i["id"] == row["_id"])
        tag = None if row["Repository"] == "<none>" else row["Repository"] + ":" + row["Tag"]
        if not labelled(image["labels"], filters["label"]):
            continue
        if filters["reference"] and not (tag and any(by_reference(tag, p) for p in filters["reference"])):
            continue
        if any((d == "true") != (tag is None) for d in filters["dangling"]):
            continue
        if rest and not (tag and (tag == rest[0] or (":" not in rest[0].rsplit("/", 1)[-1] and row["Repository"] == rest[0]))):
            continue
        rows.append(row)
    if opts.get("quiet"):
        return [r["ID"] for r in rows], 0
    return render(opts.get("format", [None])[-1], rows, ["Repository", "Tag", "ID", "CreatedSince", "Size"]), 0


def image_rm(state, args):
    opts, rest = parse(args, {"-f": ("force", False), "--force": ("force", False), "--no-prune": ("keep", False)})
    if not rest:
        return ['"docker image rm" requires at least 1 argument.'], 1
    errors = [e for e in (remove(state, ref, opts.get("force")) for ref in rest) if e]
    return errors, 1 if errors else 0


def image_inspect(state, args):
    opts, rest = parse(args, {"-f": ("format", True), "--format": ("format", True)})
    out, code = [], 0
    docs = []
    for ref in rest:
        image, _ = find(state, ref)
        if image is None:
            out.append("Error response from daemon: No such image: " + ref)
            code = 1
            continue
        docs.append({"Id": image["id"], "RepoTags": list(image["tags"]), "Size": image["mb"] * 1000000,
                     "Config": {"Labels": dict(image["labels"])}})
    if "format" not in opts:
        return [json.dumps(docs, indent=1)] + out, code
    fmt = opts["format"][-1].replace("\\t", "\t").replace("\\n", "\n")
    for doc in docs:
        text = re.sub(r"\{\{\s*range\s+\.RepoTags\s*\}\}(.*?)\{\{\s*end\s*\}\}",
                      lambda m: "".join(re.sub(r"\{\{\s*\.\s*\}\}", lambda _: t, m.group(1)) for t in doc["RepoTags"]),
                      fmt, flags=re.S)
        text = re.sub(r'\{\{\s*index\s+\.Config\.Labels\s+"([^"]*)"\s*\}\}',
                      lambda m: doc["Config"]["Labels"].get(m.group(1), ""), text)
        for field, value in (("json .RepoTags", json.dumps(doc["RepoTags"])), (".RepoTags", "[%s]" % " ".join(doc["RepoTags"])),
                             ("json .Config.Labels", json.dumps(doc["Config"]["Labels"])), (".Id", doc["Id"]),
                             (".ID", doc["Id"]), (".Size", str(doc["Size"]))):
            text = re.sub(r"\{\{\s*" + re.escape(field) + r"\s*\}\}", lambda _: value, text)
        if "{{" in text:
            raise Unsupported("template " + fmt)
        out.append(text)
    return out, code


def image_prune(state, args):
    opts, rest = parse(args, {"-a": ("all", False), "--all": ("all", False), "-f": ("force", False),
                              "--force": ("force", False), "--filter": ("filter", True)})
    filters = split_filters(opts.get("filter"), ("label",))
    if rest:
        raise Unsupported("image prune " + " ".join(args))
    if not confirmed(opts):
        return [], 0
    used = {c["image"] for c in state["containers"]}
    gone = [i for i in state["images"] if labelled(i["labels"], filters["label"]) and i["id"] not in used
            and (opts.get("all") or not i["tags"])]
    state["images"] = [i for i in state["images"] if i not in gone]
    return ["Total reclaimed space: " + size(sum(i["mb"] for i in gone))], 0


def ps_cmd(state, args):
    opts, rest = parse(args, {"-a": ("all", False), "--all": ("all", False), "-q": ("quiet", False),
                              "--quiet": ("quiet", False), "--no-trunc": ("full", False), "-f": ("filter", True),
                              "--filter": ("filter", True), "--format": ("format", True)})
    filters = split_filters(opts.get("filter"), ("label", "status", "name", "ancestor"))
    if rest:
        raise Unsupported("ps " + " ".join(args))
    ancestors = [(find(state, a)[0] or {}).get("id") for a in filters["ancestor"]]
    found = [c for c in state["containers"]
             if (opts.get("all") or filters["status"] or c["state"] == "running") and labelled(c["labels"], filters["label"])
             and (not filters["status"] or c["state"] in filters["status"])
             and all(n in c["name"] for n in filters["name"]) and (not ancestors or c["image"] in ancestors)]
    rows = container_rows(state, found, opts.get("full"))
    if opts.get("quiet"):
        return [r["ID"] for r in rows], 0
    return render(opts.get("format", [None])[-1], rows, ["ID", "Image", "Command", "RunningFor", "Status", "Ports", "Names"]), 0


def system_df(state, args):
    opts, rest = parse(args, {"-v": ("verbose", False), "--verbose": ("verbose", False), "--format": ("format", True)})
    if rest:
        raise Unsupported("system df " + " ".join(args))
    used = {c["image"] for c in state["containers"]}
    cache = sum(r["mb"] for r in state["cache"])
    rows = [{"Type": "Images", "TotalCount": len(state["images"]), "Active": len(used),
             "Size": size(sum(i["mb"] for i in state["images"])),
             "Reclaimable": size(sum(i["mb"] for i in state["images"] if i["id"] not in used))},
            {"Type": "Containers", "TotalCount": len(state["containers"]),
             "Active": len([c for c in state["containers"] if c["state"] == "running"]), "Size": "0B", "Reclaimable": "0B"},
            {"Type": "Local Volumes", "TotalCount": len(state["volumes"]), "Active": 0, "Size": "0B", "Reclaimable": "0B"},
            {"Type": "Build Cache", "TotalCount": len(state["cache"]), "Active": 0, "Size": size(cache), "Reclaimable": size(cache)}]
    if opts.get("verbose"):
        if "format" in opts:
            raise Unsupported("system df -v --format")
        return (["Images space usage:", ""] + render(None, image_rows(state, state["images"], False),
                                                      ["Repository", "Tag", "ID", "CreatedSince", "Size"])
                + ["", "Containers space usage:", ""] + render(None, container_rows(state, state["containers"], False),
                                                                ["ID", "Image", "Command", "Status", "Names"])
                + ["", "Local Volumes space usage:", ""] + ["VOLUME NAME"] + state["volumes"]
                + ["", "Build cache usage: " + size(cache), ""] + builder_du(state, [])[0][:-2]), 0
    return render(opts.get("format", [None])[-1], rows, ["Type", "TotalCount", "Active", "Size", "Reclaimable"]), 0


def builder_du(state, args):
    opts, rest = parse(args, {"--verbose": ("verbose", False)})
    if rest:
        raise Unsupported("builder du " + " ".join(args))
    rows = [{"ID": r["id"], "Reclaimable": "true", "Size": size(r["mb"]), "LastAccessed": "%d hours ago" % r["hours"]}
            for r in state["cache"]]
    total = size(sum(r["mb"] for r in state["cache"]))
    return render(None, rows, ["ID", "Reclaimable", "Size", "LastAccessed"]) + ["Reclaimable: " + total, "Total: " + total], 0


def builder_prune(state, args):
    opts, rest = parse(args, {"-a": ("all", False), "--all": ("all", False), "-f": ("force", False),
                              "--force": ("force", False), "--filter": ("filter", True)})
    filters = split_filters(opts.get("filter"), ("until",))
    if rest:
        raise Unsupported("builder prune " + " ".join(args))
    try:
        limits = [hours(u) for u in filters["until"]]
    except ValueError as e:
        return ["Error response from daemon: invalid filter 'until=%s'" % e], 1
    if not confirmed(opts):
        return [], 0
    gone = [r for r in state["cache"] if all(r["hours"] > limit for limit in limits)]
    state["cache"] = [r for r in state["cache"] if r not in gone]
    return ["Total reclaimed space: " + size(sum(r["mb"] for r in gone))], 0


def compose(state, args):
    opts, i = {"profile": [p for p in os.environ.get("COMPOSE_PROFILES", "").split(",") if p]}, 0
    valued = {"-p": "project", "--project-name": "project", "--profile": "profile", "-f": "file", "--file": "file",
              "--project-directory": "dir", "--env-file": "env", "--progress": "progress", "--ansi": "ansi"}
    while i < len(args) and args[i].startswith("-"):
        key, eq, value = args[i].partition("=")
        if key not in valued:
            raise Unsupported("compose option " + args[i])
        if not eq:
            i += 1
            value = args[i]
        opts.setdefault(valued[key], []).append(value)
        i += 1
    if i >= len(args):
        raise Unsupported("compose without a command")
    sub, rest = args[i], args[i + 1:]
    project = (opts.get("project") or [os.environ.get("COMPOSE_PROJECT_NAME") or "live-factchecker-v2"])[-1]
    services = CORE + [s for p, names in BY_PROFILE.items() if p in opts["profile"] or "*" in opts["profile"] for s in names]
    own = [c for c in state["containers"] if c["labels"].get(PROJECT) == project]

    def image_of(service):
        if service == "detection":
            registry = os.environ.get("LFC_REGISTRY") or os.environ.get("LFC_FAKE_REGISTRY")
            if not registry:
                raise Unsupported("the test names no local registry (LFC_FAKE_REGISTRY)")
            return "%s/detection:%s" % (registry, os.environ.get("LFC_TAG") or "local")
        return PINNED.get(service) or "%s-%s" % (project, service)

    if sub == "config":
        if rest != ["--images"]:
            raise Unsupported("compose config " + " ".join(rest))
        return "compose-read", [image_of(s) for s in services], 0
    if sub == "ls":
        o, more = parse(rest, {"-a": ("all", False), "--all": ("all", False), "-q": ("quiet", False),
                                 "--quiet": ("quiet", False), "--format": ("format", True), "--filter": ("filter", True)})
        names = split_filters(o.get("filter"), ("name",))["name"]
        if more or o.get("format", ["table"])[-1] not in ("table", "json"):
            raise Unsupported("compose ls " + " ".join(rest))
        found = {}
        for c in state["containers"]:
            if PROJECT in c["labels"] and (o.get("all") or c["state"] == "running") and all(n in c["labels"][PROJECT] for n in names):
                found.setdefault(c["labels"][PROJECT], []).append(c["state"])
        rows = [{"Name": n, "Status": ", ".join("%s(%d)" % (s, states.count(s)) for s in sorted(set(states))),
                 "ConfigFiles": "/work/%s/compose.yml" % n} for n, states in sorted(found.items())]
        if o.get("quiet"):
            return "compose-read", [r["Name"] for r in rows], 0
        if o.get("format", ["table"])[-1] == "json":
            return "compose-read", [json.dumps(rows)], 0
        return "compose-read", render(None, rows, ["Name", "Status", "ConfigFiles"]), 0
    if sub == "ps":
        o, wanted = parse(rest, {"-a": ("all", False), "--all": ("all", False), "-q": ("quiet", False),
                                   "--quiet": ("quiet", False), "--format": ("format", True), "--status": ("status", True)})
        found = [c for c in own if (o.get("all") or o.get("status") or c["state"] == "running")
                 and (not o.get("status") or c["state"] in o["status"])
                 and (not wanted or c["labels"].get(SERVICE) in wanted)]
        rows = [dict(r, Name=r["Names"], Service=r["_labels"].get(SERVICE, ""), Project=project)
                for r in container_rows(state, found, False)]
        if o.get("quiet"):
            return "compose-read", [c["id"] for c in found], 0
        return "compose-read", render(o.get("format", [None])[-1], rows, ["Name", "Image", "Service", "Status"]), 0
    if sub == "down":
        o, more = parse(rest, {"-v": ("volumes", False), "--volumes": ("volumes", False), "--remove-orphans": ("orphans", False),
                                 "--rmi": ("rmi", True), "-t": ("timeout", True), "--timeout": ("timeout", True)})
        if more or o.get("rmi", ["local"])[-1] not in ("local", "all"):
            raise Unsupported("compose down " + " ".join(rest))
        if "compose-down" in FORBID:
            return "compose-down", [], 0
        if "compose-down" in FAIL:
            return "compose-down", ["fake docker: compose down fails in this test"], 1
        known = CORE + [s for names in BY_PROFILE.values() for s in names]
        state["containers"] = [c for c in state["containers"] if c not in own
                               or not (c["labels"].get(SERVICE) in services or (o.get("orphans") and c["labels"].get(SERVICE) not in known))]
        if o.get("volumes"):
            state["volumes"] = [v for v in state["volumes"] if not v.startswith(project + "_")]
        errors = []
        if "rmi" in o:
            refs = [image_of(s) for s in services if o["rmi"][-1] == "all" or (s not in PINNED and s != "detection")]
            errors = [e for e in (remove(state, r, False) for r in refs if find(state, r)[0] or "image-rm" in FAIL) if e]
        return "compose-down", errors, 1 if errors else 0
    if sub in ("build", "up", "run", "exec", "start", "stop", "restart", "rm", "kill", "pull", "create"):
        return "compose-change", [PEM] if sub == "exec" and "compose-change" not in FORBID else [], 0
    raise Unsupported("compose " + sub)


def main(argv):
    state = json.load(open(STATE, encoding="utf-8"))
    cmd, rest = (argv[0], argv[1:]) if argv else ("", [])
    two = cmd + " " + (rest[0] if rest else "")
    if cmd == "compose":
        cls, out, code = compose(state, rest)
    elif cmd == "images" or two in ("image ls", "image list"):
        cls, (out, code) = "read", images_cmd(state, rest if cmd == "images" else rest[1:])
    elif cmd == "rmi" or two in ("image rm", "image remove"):
        cls, (out, code) = "image-rm", image_rm(state, rest if cmd == "rmi" else rest[1:])
    elif two == "image inspect":
        cls, (out, code) = "read", image_inspect(state, rest[1:])
    elif two == "image prune":
        cls = "image-prune" if any("label" in a for a in rest) else "image-prune-unfiltered"
        out, code = ([], 0) if cls in FORBID else image_prune(state, rest[1:])
    elif cmd == "ps" or two in ("container ls", "container list", "container ps"):
        cls, (out, code) = "read", ps_cmd(state, rest if cmd == "ps" else rest[1:])
    elif two == "system df":
        cls, (out, code) = "read", system_df(state, rest[1:])
    elif two in ("builder du", "buildx du"):
        cls, (out, code) = "read", builder_du(state, rest[1:])
    elif two in ("builder prune", "buildx prune"):
        cls = "builder-prune"
        out, code = ([], 0) if cls in FORBID else builder_prune(state, rest[1:])
    elif two == "volume ls":
        cls, out, code = "read", ["DRIVER    VOLUME NAME"] + ["local     " + v for v in state["volumes"]], 0
    elif two == "system prune":
        cls, out, code = "system-prune", [], 0
    elif cmd == "volume":
        cls, out, code = "volume-change", [], 0
    elif cmd in ("version", "info", "--version", "-v"):
        cls, out, code = "read", ["29.8.0"], 0
    elif cmd in CHANGES:
        cls, out, code = "daemon-change", [], 0
    else:
        raise Unsupported(" ".join(argv))
    if cls in FORBID:
        return cls, "forbidden", [], 0, None
    return cls, "ok" if code == 0 else "failed", out, code, state


def record(argv, cls, result):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({"argv": argv, "class": cls, "result": result}) + "\n")


try:
    cls, result, out, code, state = main(sys.argv[1:])
except Unsupported as e:
    record(sys.argv[1:], "unsupported", "unsupported")
    sys.stderr.write("fake docker: this call is not modelled by the test (%s): docker %s\n" % (e, " ".join(sys.argv[1:])))
    sys.exit(64)
record(sys.argv[1:], cls, result)
if state is not None:
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=1)
if out:
    (sys.stdout if code == 0 else sys.stderr).write("\n".join(out) + "\n")
sys.exit(code)
