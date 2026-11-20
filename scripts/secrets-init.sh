#!/bin/sh
# `make secrets-init` (the owner's stack, ticket #26): creates each secret named as an argument that is missing in
# LFC_SECRETS_DIR as its own file with a random value (32 bytes from /dev/urandom, hex); never overwrites an existing
# one. Directory 0700, files 0600. Prints names only, never a value. Test stacks use `make ci-secrets` instead.
# Parity: 0600 works on Docker Desktop (macOS), whose file sharing lets the containers read it; on a Linux host redis
# (uid 999) and the services (uid 65532) cannot read a 0600 file of the owner's user (ci-secrets uses 644).
# Usage: LFC_SECRETS_DIR=<dir> sh scripts/secrets-init.sh <name>...
set -eu
dir=${LFC_SECRETS_DIR:?secrets-init: LFC_SECRETS_DIR must name the secrets directory}
case "/$dir/" in */../*) echo "secrets-init: LFC_SECRETS_DIR must not contain '..'" >&2; exit 2 ;; esac

# Never inside the repository: the path resolved through its deepest existing directory (symlinks included).
abs=$dir
case "$abs" in /*) ;; *) abs="$PWD/$abs" ;; esac
probe=${abs%/}
rest=
while [ -n "$probe" ] && [ ! -d "$probe" ]; do
  rest="/${probe##*/}$rest"
  probe=${probe%/*}
done
real="$(cd -- "${probe:-/}" && pwd -P)"
real="${real%/}$rest"
repo=$(git rev-parse --show-toplevel) || { echo "secrets-init: run it inside the repository checkout" >&2; exit 2; }
repo=$(cd -- "$repo" && pwd -P)
case "$real/" in
  "$repo"/*) echo "secrets-init: LFC_SECRETS_DIR is inside the repository ($repo); choose a directory outside it" >&2; exit 2 ;;
esac

umask 077
mkdir -p -- "$dir"
chmod 700 -- "$dir"
status=0
for name in "$@"; do
  case "$name" in
    '' | *[!a-z0-9_]*) echo "secrets-init: '$name' is not a secret name (a-z, 0-9, _)" >&2; exit 2 ;;
  esac
  file="$dir/$name"
  if [ -e "$file" ]; then
    if [ ! -s "$file" ]; then
      echo "secrets-init: $name is empty; remove it, then run make secrets-init again" >&2
      status=1
      continue
    fi
    echo "secrets-init: $name exists, left unchanged"
    [ -n "$(find "$file" -prune -perm 600)" ] \
      || echo "secrets-init: warning: $name is not mode 0600; left as it is" >&2
    continue
  fi
  value=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  case "$value" in *[!0-9a-f]*) value= ;; esac
  if [ "${#value}" -ne 64 ]; then
    echo "secrets-init: no random value for $name (od or /dev/urandom failed); nothing written" >&2
    exit 1
  fi
  # noclobber: a file that appeared in the meantime is never overwritten, the write fails instead.
  (set -C; printf '%s' "$value" > "$file")
  chmod 600 -- "$file"
  echo "secrets-init: $name created"
done
exit "$status"
