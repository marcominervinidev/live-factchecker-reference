#!/bin/sh
# `make docker-clean` (owner target, ticket #182): reports the images of throwaway Compose projects and the size of
# the build cache; with CONFIRM=1 it also removes the images of every throwaway project without a container and the
# build cache older than seven days. Every other value of CONFIRM only reports.
# Throwaway project: the name rule of ci-guard (Makefile), never lfc-owner, never a project of the exclusion list.
# An image reference belongs to a project when it names it: <registry>/<service>:<project> (registry lfc or
# lfc.invalid); <project>-<service>[:tag] for the three services Compose names so (toolbox, toolbox-it,
# stack-client), and for any other service only with the project's Compose label; an untagged image (repository and
# tag <none>) when it carries the project's label. A label that names another project leaves the image alone. Only
# those references go, by reference (an untagged image by id), never with -f: an image with a second tag only loses
# the project's one, and Docker refuses an image a container still uses, which then stays.
# Never system prune, image prune, a volume, a container or compose down.
# Usage: sh scripts/docker-clean.sh   (CONFIRM=1 in the environment removes)
set -u
# Before the first docker call: the hook owner-stack does not know this script.
[ -z "${CLAUDECODE:-}" ] || {
  echo "owner targets refuse inside a Claude Code session (CLAUDECODE is set); run them in your own terminal" >&2
  exit 1
}

LABEL=com.docker.compose.project
fail() { echo "docker-clean: $1; nothing removed" >&2; exit 1; }
throwaway() { [ "$1" != lfc-owner ] && expr "x$1" : 'xlfc-[a-z0-9][a-z0-9_-]*$' >/dev/null; }
# The owner's projects from other repositories that match the name rule (owner decision C-Q9 of 2026-11-06).
excluded() { case "$1" in lfc-eval | lfc-test | lfc-toolbox* | lfc-agent* | lfc-probe*) return 0 ;; esac; return 1; }

# The daemon this run talks to (after `minikube docker-env` it is minikube's).
daemon=$(docker info --format '{{.Name}}') || fail "docker info failed"
echo "docker-clean: Docker daemon $daemon (DOCKER_HOST=${DOCKER_HOST:-unset}, DOCKER_CONTEXT=${DOCKER_CONTEXT:-unset})"
active=$(docker ps -a --format "{{.Label \"$LABEL\"}}") || fail "docker ps failed"
rows=$(docker image ls --no-trunc --format '{{.ID}} {{.Repository}} {{.Tag}} {{.Size}}') || fail "docker image ls failed"
ids=$(printf '%s\n' "$rows" | awk 'NF { print $1 }' | sort -u)
labels=
if [ -n "$ids" ]; then
  # A real tab in the template: docker/cli turns "\t" into a tab for list commands only, never for inspect. The line
  # "end" keeps a line break at the end of the last label from being cut off by $( ).
  tab=$(printf '\t')
  # shellcheck disable=SC2086 # one argument per image id (sha256:<hex>, no blanks or glob characters)
  labels=$(docker image inspect --format "{{.Id}}$tab{{index .Config.Labels \"$LABEL\"}}" $ids && echo end) \
    || fail "docker image inspect failed"
  # Exactly the ids of docker image ls, each once, each line "<id><tab><label>": a label with a line break adds
  # lines that could pass for another image's, a changed format would lose every label.
  why=$({ printf '%s\n--\n' "$ids"; printf '%s\n' "$labels"; } | awk '
    part == 0 { if ($0 == "--") part = 1; else want[$0] = 1; next }
    { line[++m] = $0 }
    END {
      if (line[m] == "end") m--
      for (i = 1; i <= m; i++) {
        t = index(line[i], "\t"); id = t ? substr(line[i], 1, t - 1) : ""
        if (!t || !(id in want)) { print "docker image inspect gave a line that is no <id><tab><label>" \
          (last ? " after image " last ": its label may hold a line break" : ""); exit 1 }
        if (id in seen) { print "docker image inspect listed image " id " twice: a label with a line break?"; exit 1 }
        seen[id] = 1; last = id
      }
      for (id in want) if (!(id in seen)) { print "docker image inspect did not list image " id; exit 1 }
    }') || fail "$why"
fi

# Reads the rows of docker image ls; prints one line per reference of a throwaway project ("own <project> <ref>
# <size>") and one per image of an excluded project ("keep <project>").
classify() {
  while read -r id repo tag size; do
    [ -n "$id" ] || continue
    # A label with a tab counts as a foreign one ("?"); an unset label prints empty, or "<no value>".
    label=$(printf '%s\n' "$labels" | awk -F '\t' -v id="$id" '$1 == id { print (NF == 2 ? $2 : "?"); exit }')
    [ "$label" != "<no value>" ] || label=
    named=
    if [ "$repo" = "<none>" ] && [ "$tag" = "<none>" ]; then
      # Untagged: by id, and only when no row of the same id names a repository or a tag.
      printf '%s\n' "$rows" | awk -v id="$id" '$1 == id && ($2 != "<none>" || $3 != "<none>") { f = 1 } END { exit !f }' \
        && continue
      ref=$id named=$label
    elif [ "$tag" = "<none>" ]; then
      continue  # referenced by digest only (repository@sha256:...): never by id
    else
      ref=$repo:$tag
      case "$repo" in
        lfc/* | lfc.invalid/*) named=$tag ;;
        *-toolbox-it) named=${repo%-toolbox-it} ;;
        *-toolbox) named=${repo%-toolbox} ;;
        *-stack-client) named=${repo%-stack-client} ;;
      esac
      # A Compose-built <project>-<service> of another service: the label names the project.
      [ -n "$named" ] || [ -z "$label" ] || case "$repo" in "$label"-*) named=$label ;; esac
    fi
    for p in "$label" "$named"; do
      if [ -n "$p" ] && throwaway "$p" && excluded "$p"; then echo "keep $p"; fi
    done
    { [ -n "$named" ] && throwaway "$named" && ! excluded "$named"; } || continue
    # The label names another project (of the rule or not): left alone.
    if [ -n "$label" ] && [ "$label" != "$named" ]; then continue; fi
    echo "own $named $ref $size"
  done
}
found=$(printf '%s\n' "$rows" | classify)

has_container() { printf '%s\n' "$active" | grep -qxF -- "$1"; }
projects=$(printf '%s\n' "$found" | awk '$1 == "own" { print $2 }' | sort -u)
echo "docker-clean: images of throwaway Compose projects (size as docker image ls prints it)"
for p in $projects; do
  if has_container "$p"; then state="container exists, stays"; else state="no container"; fi
  printf '%s\n' "$found" | awk -v p="$p" -v s="$state" '$1 == "own" && $2 == p {
    ref = $3; if (ref ~ /^sha256:/) ref = substr(ref, 1, 19) " (untagged)"
    printf "  %-20s %-48s %9s  %s\n", p, ref, $4, s }'
done
for p in $(printf '%s\n' "$found" | awk '$1 == "keep" { print $2 }' | sort -u); do
  printf '  %-20s bleibt (exclusion list: the owner'\''s projects from other repositories)\n' "$p"
done
df=$(docker system df --format '{{.Type}}\t{{.Size}}') || fail "docker system df failed"
echo "build cache (every project on this Docker daemon, the owner's stacks and the excluded ones too): $(printf '%s\n' "$df" | awk -F '\t' '$1 == "Build Cache" { print $2 }')"

if [ "${CONFIRM:-}" != 1 ]; then
  echo "docker-clean: nothing removed; CONFIRM=1 removes the images above without a container and the build cache"
  echo "  older than seven days (168 h)"
  exit 0
fi
for p in $projects; do
  has_container "$p" && continue
  # Read again right before removing: a stack may have started since the report.
  now=$(docker ps -a -q --filter "label=$LABEL=$p") || { echo "  $p: docker ps failed, its images stay"; continue; }
  [ -z "$now" ] || { echo "  $p: a container appeared, its images stay"; continue; }
  refs=$(printf '%s\n' "$found" | awk -v p="$p" '$1 == "own" && $2 == p { print $3 }')
  # shellcheck disable=SC2086 # one argument per reference (no blanks or glob characters in an image reference)
  if errors=$(docker image rm $refs 2>&1 >/dev/null); then
    echo "  $p: removed"
  else
    echo "  $p: docker image rm failed for at least one reference; Docker says:"
    printf '%s\n' "$errors" | sed 's/^/    /'
  fi
done
echo "build cache older than seven days (168 h):"
pruned=$(docker builder prune -f --filter until=168h) || { echo "docker-clean: docker builder prune failed" >&2; exit 1; }
printf '%s\n' "$pruned" | sed 's/^/  /'
