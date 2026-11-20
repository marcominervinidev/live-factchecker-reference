"""Issue #182 (44-12), Task 1: the owner target that reports and, on confirmation, removes the images of finished
throwaway Compose projects and the old build cache.

Criteria (ticket #182, quoted):
- AC1: "Without confirmation the target only reports: per throwaway project its images and their size, whether a
  container of it exists, and the size of the build cache; it removes nothing."
- AC2: "With confirmation it removes the images of every throwaway project that has no container, and the build
  cache older than seven days."
- AC3 (negative): "It never removes an image of the owner's stack, an image of a project with a container (running
  or stopped), or a third-party image (Redis, Caddy, Node, distroless, the tool images)."
- AC4 (negative): "It refuses inside a Claude Code session, like the other owner targets, before it reads anything."
  The other owner targets say: "owner targets refuse inside a Claude Code session (CLAUDECODE is set); run them in
  your own terminal" (Makefile, owner-session).
- AC5: "`make help` lists the target with one line."
- Which images (ticket, Task 1, Shape): "throwaway projects are recognised by the project name rule of `ci-guard`
  (`Makefile:30`: `'xlfc-[a-z0-9][a-z0-9_-]*$$'`, never `lfc-owner`); images by the Compose project label and by the
  project's tag. Never `docker system prune`, never `--all` without a filter."

Owner decisions (Marco, 2026-11-06: "c-q9 ja", then "c ja": every question of block C with its recommendation;
quoted from the decision page, block C):
- C-Q3: "Gilt: Befehl `make docker-clean`; Bestätigung `CONFIRM=1`, getippt oder als exportierte Variable; jeder
  andere Wert zeigt nur an; Größen so, wie Docker sie ausgibt?" ja. The report shows each image of a throwaway
  project on one line with the size Docker prints for it (`docker image ls`, column SIZE), on the lines that name a
  project whether it has a container, and the size of the build cache as Docker prints it; the wording is free
  otherwise.
- C-Q4: "Bleibt es bei sieben Tagen?" ja: 168 hours.
- C-Q5: "Gilt: alte Builds ohne Namen mit dem Label eines fertigen Projekts gehen; `lfc/detection:<projekt>` geht auch
  ohne Label; ein Image mit mehreren Namen verliert nur die Namen des Projekts?" ja. An image belongs to a project
  through its label or through a tag that names the project (`<registry>/<service>:<project>`,
  `<project>-<service>`); the owner's machine holds one image id with the tags lfc/detection:local and
  lfc/detection:lfc-25-acc and the label of lfc-25-acc (critic, gate 1). An untagged image with the label of a
  finished project goes by id.
- C-Q9: "Soll `docker-clean` diese Projekte nie räumen, auch `lfc-eval` und `lfc-test`?" ja ("feste Ausnahmeliste,
  der Bericht zeigt sie als „bleibt“. `lfc-eval` und `lfc-test` gelten als genaue Namen."): `lfc-eval` and
  `lfc-test` exactly, every name starting with `lfc-toolbox`, `lfc-agent` or `lfc-probe`, never cleared; the report
  marks them with the word "bleibt". The finished projects lfc-test-1 and lfc-eval-2 are cleared like any other.
- C-Q11: "Ein Image eines fertigen Projekts wird noch von einem Container außerhalb des Projekts benutzt. Bleibt es
  liegen, und der Lauf endet trotzdem ohne Fehler?" ja (Docker refuses the removal; never `-f`).
- C-Q6 (gate 1 for this ticket) and C-Q7 (no acceptance case, no canary; the proof is the owner's real run): ja.
- E-F4 with P1 (#166 Task 1 renames the local registry to a prefix that cannot be a Docker Hub namespace; the test
  designer named it `lfc.invalid`): the owner's machine keeps the images built under `lfc` and gets new ones under
  `lfc.invalid`, so a tag that names a project counts under both names (RENAMED_REGISTRY).
- The script, if the target has one, is scripts/docker-clean.sh and refuses by itself when CLAUDECODE is set.
Never asserted, because the ticket is silent: the exit code when a removal fails for another reason, a report after
the removal, and an image whose label and tag name two different throwaway projects.

Every case runs make in a throwaway copy (Makefile, *.mk, .nvmrc, scripts/, compose*.yml) under the system temp
directory with a fake `docker` first on a PATH that holds nothing but the system directories. The fake keeps a
Docker of its own in a JSON file (images with tags, labels and ids, containers, volumes, build cache records with
their age), answers a set of calls as Docker does and records every call; the cases assert on what is left in that
file and on the target's output, never on the wording of a call. The real Docker daemon, the owner's stacks and the
secrets directory are never touched: DOCKER_HOST points at a socket that does not exist, LFC_SECRETS_DIR and HOME
into the throwaway copy; CLAUDECODE is removed from the environment except in the AC4 cases.

The calls the fake models are listed in the header of tools/tests/fake_docker.py; a call it does not model exits 64
and fails the case. Forbidden here (recorded, without effect, the case fails): `system prune`, `volume rm|prune`,
`image prune` without a label filter, `compose down|up|run|build|stop|rm` and the like, every other change to the
daemon.
Stdlib only. Run: python3 -I -m unittest discover -s tools/tests -p test_docker_clean.py
"""
import hashlib, json, os, pathlib, re, shutil, stat, subprocess, sys, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
TMP = pathlib.Path(tempfile.gettempdir()).resolve()
FAKE_DOCKER = pathlib.Path(__file__).resolve().with_name("fake_docker.py")
TARGET, SCRIPT = "docker-clean", "scripts/docker-clean.sh"
LOCAL_REGISTRY = "lfc"  # compose.yml: `${LFC_REGISTRY:-lfc}`
RENAMED_REGISTRY = "lfc.invalid"  # the same registry after #166 Task 1 (E-F4, named under P1)
KEPT = "bleibt"  # C-Q9: the word the report marks an excluded project with
PROJECT_LABEL, SERVICE_LABEL = "com.docker.compose.project", "com.docker.compose.service"
FORBIDDEN = "system-prune volume-change image-prune-unfiltered daemon-change compose-down compose-change"
UNSET = ("MAKEFLAGS", "MFLAGS", "MAKELEVEL", "MAKEOVERRIDES", "CI", "CLAUDECODE", "CONFIRM", "COMPOSE_PROJECT_NAME",
         "COMPOSE_FILE", "COMPOSE_PROFILES", "LFC_REGISTRY", "LFC_TAG", "LFC_SECRETS_DIR", "SECRETS_DIR", "DOCKER_CONTEXT",
         "LFC_FAKE_FAIL")
# Source: ticket #182 AC1 ("Without confirmation"); the proposal above: only CONFIRM=1 confirms. One class per row.
NOT_A_CONFIRMATION = {"empty": "", "zero": "0", "another number": "2", "a word": "yes"}


def size(mb):
    """The size as the fake prints it, like Docker: 412MB, 1.3GB."""
    return "%.4gGB" % (mb / 1000.0) if mb >= 1000 else "%dMB" % mb


def image(*tags, project=None, service=None, mb, key=None):
    labels = {PROJECT_LABEL: project, SERVICE_LABEL: service} if project else {}
    return {"id": "sha256:" + hashlib.sha256((key or tags[0]).encode()).hexdigest(), "tags": list(tags), "labels": labels, "mb": mb}


def container(name, of, state, project=None, service=None):
    labels = {PROJECT_LABEL: project, SERVICE_LABEL: service} if project else {}
    return {"id": hashlib.sha256(name.encode()).hexdigest(), "name": name, "image": of["id"], "state": state, "labels": labels}


def service_tag(project, registry=LOCAL_REGISTRY):
    return f"{registry}/detection:{project}"


def project_images(project, *services, first_mb):
    """The images a throwaway project leaves: lfc/detection:<project> and <project>-<service> for the built-only ones."""
    out = [image(service_tag(project), project=project, service="detection", mb=first_mb)]
    return out + [image(f"{project}-{s}:latest", project=project, service=s, mb=first_mb + 1000 + 7 * n)
                  for n, s in enumerate(services, 1)]


def own(project, tag):
    """Whether the tag names the project: <registry>/detection:<project> under either name, or <project>-<service>."""
    return tag in (service_tag(project), service_tag(project, RENAMED_REGISTRY)) or tag.startswith(project + "-")


# Throwaway projects without a container (AC2: their images go). Sizes are unique, so a size identifies its image.
# One image id with the tag and the label of the finished lfc-31-1 and the tag of the owner's stack, as on the owner's
# machine: only the reference that names the project may go.
SHARED_WITH_OWNER = image(service_tag("lfc-31-1"), f"{LOCAL_REGISTRY}/detection:local", project="lfc-31-1", service="detection", mb=418)
# The same after #166 Task 1, under the renamed registry (E-F4): `make acceptance` and `make up` can again leave one id.
SHARED_RENAMED = image(service_tag("lfc-50-acc", RENAMED_REGISTRY), f"{RENAMED_REGISTRY}/detection:local", project="lfc-50-acc",
                       service="detection", mb=428)
FINISHED = {
    "lfc-27-2": project_images("lfc-27-2", "toolbox", "stack-client", first_mb=401)
    + [image(project="lfc-27-2", service="detection", mb=399, key="dangling lfc-27-2")],  # an older build, untagged
    "lfc-48-acc": project_images("lfc-48-acc", "stack-client", first_mb=431),
    "lfc-ci-77": [image(service_tag("lfc-ci-77"), mb=441)],  # known by its tag only, no Compose label
    "lfc-29": project_images("lfc-29", "toolbox", first_mb=451),  # lfc-29-1 below still has a container
    "lfc-31-1": [SHARED_WITH_OWNER],
    "lfc-50-acc": [SHARED_RENAMED],
    "lfc-test-1": project_images("lfc-test-1", "toolbox", first_mb=541),  # C-Q9: lfc-test is excluded as an exact name
    "lfc-eval-2": project_images("lfc-eval-2", first_mb=551),  # C-Q9: lfc-eval is excluded as an exact name
}
# Q11: lfc-33-1 has no container of its own, but a container outside the project still runs from its toolbox image
# (on the owner's machine lfc-agent-toolbox-1 uses lfc-toolbox:local of the project lfc-toolbox). The service image
# goes, the used image stays with its tag.
USED_ELSEWHERE = project_images("lfc-33-1", "toolbox", first_mb=531)
# Throwaway projects with a container (AC3: every image of theirs stays, also one no container uses). lfc-27-20
# starts with the name of the finished lfc-27-2, lfc-29-1 with that of the finished lfc-29.
ACTIVE = {
    "lfc-28-3": ("running", "toolbox", project_images("lfc-28-3", "toolbox", first_mb=461)),
    "lfc-29-1": ("exited", "detection", project_images("lfc-29-1", "toolbox-it", first_mb=471)
                 + [image(project="lfc-29-1", service="detection", mb=469, key="dangling lfc-29-1")]),
    "lfc-30-1": ("created", "detection", project_images("lfc-30-1", first_mb=481)),
    "lfc-27-20": ("running", "toolbox", project_images("lfc-27-20", "toolbox", first_mb=491)),
}
# C-Q9: names that match the rule but are the owner's (his repository live-factcheck, foreign toolboxes, agents and
# probes). Only lfc-toolbox-5a has a container here, so nothing but the exclusion list protects the others; lfc-agent-3,
# lfc-toolbox-7b and lfc-probe-1 hold the prefixes, lfc-test-1 and lfc-eval-2 in FINISHED the exact names. The images
# are fixtures, not a copy of the owner's machine: there lfc-agent has no image of its own, lfc-toolbox has an exited
# container, lfc-eval and lfc-test also have untagged older builds (critic, gate 1, round 2).
EXCLUDED = {
    "lfc-eval": [image(f"{LOCAL_REGISTRY}/gateway:eval", project="lfc-eval", service="gateway", mb=521),
                 image(f"{LOCAL_REGISTRY}/web:eval", project="lfc-eval", service="web", mb=522)],
    "lfc-test": [image(f"{LOCAL_REGISTRY}/web:test", project="lfc-test", service="web", mb=523)],
    "lfc-toolbox": [image("lfc-toolbox:local", project="lfc-toolbox", service="toolbox", mb=1524)],
    "lfc-toolbox-5a": [image("lfc-toolbox-5a-toolbox:latest", project="lfc-toolbox-5a", service="toolbox", mb=1525)],
    "lfc-agent": [image("lfc-agent-toolbox:latest", project="lfc-agent", service="toolbox", mb=1526)],
    "lfc-agent-3": [image("lfc-agent-3-toolbox:latest", project="lfc-agent-3", service="toolbox", mb=1529),
                    image(project="lfc-agent-3", service="toolbox", mb=1530, key="dangling lfc-agent-3")],
    "lfc-toolbox-7b": [image("lfc-toolbox-7b-toolbox:latest", project="lfc-toolbox-7b", service="toolbox", mb=1531)],
    "lfc-probe-1": [image(service_tag("lfc-probe-1"), project="lfc-probe-1", service="detection", mb=527),
                    image(project="lfc-probe-1", service="detection", mb=528, key="dangling lfc-probe-1")],
}
OWNER = {
    "the owner's stack, service image (one id with a finished project's tag and label)":
        dict(SHARED_WITH_OWNER, tags=[f"{LOCAL_REGISTRY}/detection:local"]),
    "the owner's stack, service image after #166 (one id with a finished project's tag and label)":
        dict(SHARED_RENAMED, tags=[f"{RENAMED_REGISTRY}/detection:local"]),
    "the owner's stack, toolbox image, no container": image("live-factchecker-v2-toolbox:latest", project="live-factchecker-v2",
                                                             service="toolbox", mb=1501),
    "the owner's stack, dev image, no container": image("live-factchecker-v2-detection:latest", project="live-factchecker-v2",
                                                         service="detection", mb=502),
    "lfc-owner, service image": image(service_tag("lfc-owner"), project="lfc-owner", service="detection", mb=503),
    "lfc-owner, toolbox image": image("lfc-owner-toolbox:latest", project="lfc-owner", service="toolbox", mb=1504),
    "the owner's project live-factcheck": image("live-factcheck-api:latest", project="live-factcheck", service="api", mb=505),
    "the owner's lab project": image("lab-whisper-stt:latest", project="lab-whisper", service="stt", mb=3506),
    "the owner's MCP project": image("docker-brave-mcp-server:latest", project="docker-brave-mcp-1", service="server", mb=507),
    "the owner's minikube": image("gcr.io/k8s-minikube/kicbase:v0.0.48", mb=1508),
}
# Source: the name rule quoted in the ticket (`lfc-[a-z0-9][a-z0-9_-]*`, anchored, never lfc-owner). One class per
# row, each project without a container; lfc-owner is in OWNER.
NOT_THROWAWAY = {
    "no letter or digit after lfc-": image("lfc-_tmp-toolbox:latest", project="lfc-_tmp", service="toolbox", mb=1511),
    "no letter or digit after lfc-, by tag": image(service_tag("lfc-_tmp"), project="lfc-_tmp", service="detection", mb=512),
    "lfc- is not at the start": image("xlfc-1-toolbox:latest", project="xlfc-1", service="toolbox", mb=1513),
    "lfc without the dash": image("lfcx-1-toolbox:latest", project="lfcx-1", service="toolbox", mb=1514),
    "lfc alone": image("lfc-toolbox:latest", project="lfc", service="toolbox", mb=1515),
}
THIRD_PARTY = {
    "Redis": image("redis:8.10.3-alpine", mb=61),
    "Caddy": image("caddy:2.11.7-alpine", mb=77),
    "Node": image("node:24.22.1-bookworm-slim", mb=233),
    "distroless": image("gcr.io/distroless/nodejs24-debian13:nonroot", mb=172),
    "tool image gitleaks": image("zricethezav/gitleaks:v8.30.1", mb=81),
    "tool image hadolint": image("hadolint/hadolint:v2.15.1", mb=12),
    "tool image Semgrep": image("semgrep/semgrep:1.178.0", mb=1620),
    "tool image Python": image("python:3.12.3-bookworm", mb=1021),
    "an untagged image without a Compose label": image(mb=97, key="dangling, no label"),
}
VOLUMES = ["lfc-27-2_scratch", "lfc-28-3_scratch", "live-factchecker-v2_pgdata", "minikube"]
# Source: ticket #182 AC2 ("older than seven days"), 7 days = 168 hours; the two records next to the boundary, one
# far on each side. Together 38.21GB.
CACHE = [{"id": "young", "hours": 1, "mb": 800}, {"id": "just-inside", "hours": 167, "mb": 2100},
         {"id": "just-outside", "hours": 169, "mb": 12300}, {"id": "old", "hours": 720, "mb": 23010}]
OLDER_THAN_SEVEN_DAYS = ["just-outside", "old"]


def docker_with(finished=True, cache=CACHE, without_container_of=None):
    """A Docker as the owner's looks after a week of local checks; `finished` adds the projects without a container."""
    images = [i for group in FINISHED.values() for i in group] + USED_ELSEWHERE if finished else []
    containers = [container("minikube", OWNER["the owner's minikube"], "running"),
                  container("tmp-redis", THIRD_PARTY["Redis"], "exited"),
                  container("lfc-toolbox-5a-toolbox-1", EXCLUDED["lfc-toolbox-5a"][0], "exited", "lfc-toolbox-5a", "toolbox")]
    if finished:
        containers.append(container("scratch-shell", USED_ELSEWHERE[1], "exited"))
    for project, (state, service, group) in ACTIVE.items():
        images += group
        if project != without_container_of:
            wanted = f"{project}-toolbox:latest" if service == "toolbox" else service_tag(project)
            used = next(i for i in group if wanted in i["tags"])
            containers.append(container(f"{project}-{service}-1", used, state, project, service))
    images += [i for group in EXCLUDED.values() for i in group]
    images += [*OWNER.values(), *NOT_THROWAWAY.values(), *THIRD_PARTY.values()]
    by_id = {}
    for i in images:  # the images shared with the owner's stack are listed twice; the first entry carries both tags
        by_id.setdefault(i["id"], i)
    return {"images": list(by_id.values()), "containers": containers, "volumes": list(VOLUMES), "cache": [dict(r) for r in cache]}


def words(line):
    return set(re.split(r"[\s,;|()]+", line))


def shows(line, tag):
    """Whether the line shows the image: as repository:tag, or repository and tag as two words (docker image ls)."""
    repo, _, version = tag.rpartition(":")
    return tag in words(line) or {repo, version} <= words(line)


def names(line, project):
    """Whether the line carries the project name as a word of its own (not as part of a longer name)."""
    return re.search(rf"(?<![A-Za-z0-9_./:-]){re.escape(project)}(?![A-Za-z0-9_-])", line) is not None


class DockerClean(unittest.TestCase):
    def setUp(self):
        self.work = pathlib.Path(tempfile.mkdtemp(prefix="lfc-182-make-")).resolve()
        self.addCleanup(shutil.rmtree, self.work, True)
        if TMP not in self.work.parents or ROOT in self.work.parents:
            self.fail(f"refusing to run make outside a throwaway directory: {self.work}")
        for name in ["Makefile", ".nvmrc", *[p.name for p in [*ROOT.glob("compose*.yml"), *ROOT.glob("*.mk")]]]:
            shutil.copy2(ROOT / name, self.work / name)
        shutil.copytree(ROOT / "scripts", self.work / "scripts", ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
        fake = self.work / ".fake"
        (fake / "bin").mkdir(parents=True)
        (fake / "home").mkdir()
        (fake / "secrets").mkdir(mode=0o700)
        shutil.copy2(FAKE_DOCKER, fake / "docker.py")
        docker = fake / "bin" / "docker"
        docker.write_text(f'#!/bin/sh\nexec "{sys.executable}" -I "{fake / "docker.py"}" "$@"\n', encoding="utf-8")
        docker.chmod(docker.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        self.state_file, self.log_file = fake / "state.json", fake / "calls.log"
        self.log_file.touch()
        env = {k: v for k, v in os.environ.items() if k not in UNSET}
        env.update({"PATH": f"{fake / 'bin'}:/usr/bin:/bin:/usr/sbin:/sbin", "HOME": str(fake / "home"),
                    "DOCKER_HOST": f"unix://{fake / 'no-daemon.sock'}", "LFC_SECRETS_DIR": str(fake / "secrets"),
                    "LFC_FAKE_STATE": str(self.state_file), "LFC_FAKE_LOG": str(self.log_file), "LFC_FAKE_FORBID": FORBIDDEN,
                    "LFC_FAKE_REGISTRY": LOCAL_REGISTRY})
        self.env = env
        self.docker(docker_with())

    # helpers -------------------------------------------------------------------------------------------------
    def docker(self, state):
        self.before = json.loads(json.dumps(state))
        self.state_file.write_text(json.dumps(state), encoding="utf-8")
        self.log_file.write_text("", encoding="utf-8")

    def state(self):
        return json.loads(self.state_file.read_text(encoding="utf-8"))

    def left(self, wanted):
        """Whether the image is still there: every tag it had, or its id when it never had one."""
        after = self.state()["images"]
        if not wanted["tags"]:
            return any(i["id"] == wanted["id"] for i in after)
        return all(any(t in i["tags"] for i in after) for t in wanted["tags"])

    def calls(self, result=None):
        lines = [json.loads(line) for line in self.log_file.read_text(encoding="utf-8").splitlines() if line]
        return [" ".join(c["argv"]) for c in lines if result in (None, c["result"])]

    def run_in_copy(self, command, **extra):
        result = subprocess.run(command, cwd=self.work, env=dict(self.env, **extra), stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(self.calls("unsupported"), [], "a docker call the fake does not model (header of fake_docker.py)")
        return result

    def make(self, *args, **extra):
        return self.run_in_copy(["make", "--no-print-directory", "-C", str(self.work), *args], **extra)

    def report(self, **extra):
        result = self.make(TARGET, **extra)
        self.assertEqual(result.returncode, 0, f"make {TARGET} without confirmation:\n{result.stdout}{result.stderr}")
        return result.stdout + result.stderr

    def confirmed(self):
        """`make docker-clean CONFIRM=1` as the owner types it; control: it ran and removed a finished project's image."""
        result = self.make(TARGET, "CONFIRM=1")
        self.assertEqual(result.returncode, 0, f"make {TARGET} CONFIRM=1:\n{result.stdout}{result.stderr}")
        self.assertFalse(self.left(FINISHED["lfc-27-2"][0]), "control: the removal did not run")
        return result


class Report(DockerClean):
    # AC1 -----------------------------------------------------------------------------------------------------
    def test_without_confirmation_it_removes_nothing_and_only_reads(self):
        self.report()
        self.assertEqual(self.state(), self.before, "images, containers, volumes and build cache as before")
        self.assertEqual(self.calls("forbidden"), [])
        self.assertTrue(self.calls(), "control: the report asked Docker")

    def test_any_value_but_1_is_no_confirmation(self):
        for kind, value in NOT_A_CONFIRMATION.items():
            with self.subTest(kind, CONFIRM=value):
                self.docker(docker_with())
                self.report(CONFIRM=value)
                self.assertEqual(self.state(), self.before)

    def test_the_report_shows_every_image_of_a_throwaway_project_with_its_size(self):
        output = self.report()
        groups = {**FINISHED, "lfc-33-1": USED_ELSEWHERE, **{project: images for project, (_, _, images) in ACTIVE.items()}}
        for project, images in groups.items():
            for tag in [t for i in images for t in i["tags"] if own(project, t)]:
                with self.subTest(project=project, image=tag):
                    wanted = size(next(i["mb"] for i in images if tag in i["tags"]))
                    self.assertTrue([line for line in output.splitlines() if wanted in words(line) and shows(line, tag)],
                                    f"no line shows {tag} with its size {wanted}:\n{output}")

    def test_the_report_lists_the_images_of_throwaway_projects_only(self):
        # "per throwaway project its images": not every image on the machine, and of an image with two tags only the
        # reference that names the project (what the report shows is what a confirmation would take).
        output = self.report()
        self.assertTrue([line for line in output.splitlines() if shows(line, service_tag("lfc-27-2"))], "control: the report lists images")
        for group in (OWNER, NOT_THROWAWAY, THIRD_PARTY):
            for kind, foreign in group.items():
                for tag in foreign["tags"]:
                    with self.subTest(kind, image=tag):
                        self.assertFalse([line for line in output.splitlines() if shows(line, tag)], f"the report lists {tag}")

    def test_the_report_tells_per_project_whether_a_container_of_it_exists(self):
        # The wording is free; the lines that name lfc-28-3 must read differently once its one container is gone, and
        # the lines of another project must not.
        def lines(output, project):
            return sorted(line for line in output.splitlines() if project in line)
        with_container = self.report()
        self.docker(docker_with(without_container_of="lfc-28-3"))
        without = self.report()
        self.assertTrue(lines(with_container, "lfc-28-3"), "no line names lfc-28-3")
        self.assertNotEqual(lines(without, "lfc-28-3"), lines(with_container, "lfc-28-3"),
                            "the lines of lfc-28-3 do not depend on its container")
        self.assertEqual(lines(without, "lfc-30-1"), lines(with_container, "lfc-30-1"), "the lines of another project changed")

    def test_the_report_shows_the_size_of_the_build_cache(self):
        total = size(sum(r["mb"] for r in CACHE))
        self.assertIn(total, self.report())
        self.docker(docker_with(cache=CACHE[:1]))
        output = self.report()
        self.assertIn(size(CACHE[0]["mb"]), output)
        self.assertNotIn(total, output)

    def test_q9_the_report_marks_the_excluded_projects_and_no_project_it_would_clear(self):
        output = self.report().splitlines()
        self.assertTrue([line for line in output if names(line, "lfc-27-2")], "control: the report names the projects")
        for project in EXCLUDED:
            with self.subTest(project=project):
                marked = [line for line in output if names(line, project) and KEPT in words(line)]
                self.assertTrue(marked, f"no line names {project} with the word {KEPT}")
        for project in FINISHED:
            with self.subTest(project=project):
                self.assertFalse([line for line in output if names(line, project) and KEPT in words(line)])


class Removal(DockerClean):
    # AC2 -----------------------------------------------------------------------------------------------------
    def test_with_confirmation_it_removes_the_images_of_every_throwaway_project_without_a_container(self):
        self.confirmed()
        for project, images in FINISHED.items():
            for gone in images:
                tag = next((t for t in gone["tags"] if own(project, t)), None)
                with self.subTest(project=project, image=tag or "an untagged older build with the project's label"):
                    after = self.state()["images"]
                    left = any(tag in i["tags"] for i in after) if tag else any(i["id"] == gone["id"] for i in after)
                    self.assertFalse(left)

    def test_with_confirmation_it_removes_the_build_cache_older_than_seven_days(self):
        # CONFIRM exported in the environment here, on the command line in every other case.
        result = self.make(TARGET, CONFIRM="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([r["id"] for r in self.state()["cache"]], [r["id"] for r in CACHE if r["id"] not in OLDER_THAN_SEVEN_DAYS])

    def test_with_confirmation_and_nothing_to_remove_it_exits_0_and_changes_nothing(self):
        self.docker(docker_with(finished=False, cache=CACHE[:2]))
        result = self.make(TARGET, "CONFIRM=1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.state(), self.before)  # the C-Q9 projects are in this Docker and stay
        self.assertTrue(self.calls(), "control: the target asked Docker")


class Protected(DockerClean):
    # AC3 -----------------------------------------------------------------------------------------------------
    def assert_left(self, group):
        self.confirmed()
        for kind, kept in group.items():
            with self.subTest(kind, image=(kept["tags"] or ["untagged"])[-1]):
                self.assertTrue(self.left(kept))

    def test_it_never_removes_an_image_of_the_owner_s_projects(self):
        self.assert_left(OWNER)

    def test_it_never_removes_an_image_of_a_project_with_a_container(self):
        self.assert_left({f"{state} container: {(i['tags'] or ['an untagged older build of ' + project])[0]}": i
                          for project, (state, _, images) in ACTIVE.items() for i in images})

    def test_it_never_removes_a_third_party_image(self):
        self.assert_left(THIRD_PARTY)

    def test_it_never_removes_an_image_of_a_project_whose_name_misses_the_throwaway_rule(self):
        self.assert_left(NOT_THROWAWAY)

    def test_q9_the_owner_s_projects_that_match_the_name_rule(self):
        # C-Q9 ja: the exclusion list protects them; without it every image here but those of lfc-toolbox-5a (its
        # container), lfc/gateway:eval, lfc/web:eval, lfc/web:test and lfc-toolbox:local (no reference names the
        # project) would go. The finished lfc-test-1 and lfc-eval-2 next to them go (the AC2 case).
        self.confirmed()
        for project, images in EXCLUDED.items():
            for kept in images:
                with self.subTest(project=project, image=(kept["tags"] or ["an untagged older build"])[0]):
                    self.assertTrue(self.left(kept))

    def test_q11_an_image_a_container_outside_the_project_still_uses_stays_and_the_run_exits_0(self):
        self.confirmed()  # exit 0 is asserted there
        service, toolbox = USED_ELSEWHERE
        self.assertTrue(self.left(toolbox), "the image under the container scratch-shell lost its tag or is gone")
        self.assertFalse(self.left(service), "the unused image of the same finished project is left")

    def test_it_touches_no_volume_no_container_and_no_stack(self):
        self.confirmed()
        after = self.state()
        self.assertEqual(after["volumes"], self.before["volumes"], "volumes, also the one of the finished lfc-27-2")
        self.assertEqual(after["containers"], self.before["containers"])
        self.assertEqual(self.calls("forbidden"), [], "system prune, volume, compose down and other daemon changes")


class OwnerOnly(DockerClean):
    # AC4 -----------------------------------------------------------------------------------------------------
    def test_it_refuses_inside_a_claude_code_session_before_any_docker_call(self):
        for args in ([], ["CONFIRM=1"]):
            with self.subTest(args=args):
                self.docker(docker_with())
                result = self.make(TARGET, *args, CLAUDECODE="1")
                output = result.stdout + result.stderr
                self.assertNotEqual(result.returncode, 0, output)
                self.assertIn("CLAUDECODE", output, "the refusal names the reason like the other owner targets")
                self.assertEqual(self.calls(), [], "no docker call at all")
                self.assertEqual(self.state(), self.before)

    def test_the_script_refuses_by_itself_inside_a_claude_code_session(self):
        # The hook owner-stack does not know the target (ticket: "Whether the hook `owner-stack` should also know the
        # new target is an owner file question ... and not part of this ticket"), so a script that relied on make's
        # owner-session could be started directly in a session. Passes when the target has no script.
        if not (self.work / SCRIPT).exists():
            return
        for extra in ({}, {"CONFIRM": "1"}):
            with self.subTest(**extra):
                self.docker(docker_with())
                result = self.run_in_copy(["sh", SCRIPT], CLAUDECODE="1", **extra)
                output = result.stdout + result.stderr
                self.assertNotEqual(result.returncode, 0, output)
                self.assertIn("CLAUDECODE", output)
                self.assertEqual(self.calls(), [], "no docker call at all")
                self.assertEqual(self.state(), self.before)

    def test_its_dry_run_exits_0_without_any_docker_call(self):
        for extra in ({}, {"CLAUDECODE": "1"}, {"CONFIRM": "1"}):
            with self.subTest(**extra):
                result = self.make("-n", TARGET, **extra)
                self.assertEqual(result.returncode, 0, f"make -n {TARGET}:\n{result.stdout}{result.stderr}")
                self.assertEqual(self.calls(), [], "a dry run asks Docker nothing")
                self.assertEqual(self.state(), self.before)


class Help(DockerClean):
    # AC5 -----------------------------------------------------------------------------------------------------
    def test_make_help_has_exactly_one_line_for_the_target(self):
        result = self.make("help")
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = [line for line in result.stdout.splitlines() if re.match(rf"^\s*{re.escape(TARGET)}\s", line)]
        self.assertEqual(len(lines), 1, f"make help lines for {TARGET}: {lines}")
        self.assertTrue(lines[0].split(None, 1)[1:], f"{TARGET} has no description in make help")


if __name__ == "__main__":
    unittest.main()
