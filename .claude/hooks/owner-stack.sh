#!/bin/sh
# PreToolUse on Bash: agents never touch the owner's stack. Every docker compose or docker run needs
# a project that starts with lfc- and is not the owner's (ADR 0011, lesson 34 of live-factcheck).
. "$(dirname "$0")/lib.sh"
cmd=$(json '.tool_input.command'); [ -n "$cmd" ] || exit 0

# Read-only docker commands are fine.
if printf '%s' "$cmd" | grep -Eq '(^|[;&|(] *)docker +(compose +)?(config|version|ls|ps|images|inspect|logs|info|stats|top)\b' \
   && ! printf '%s' "$cmd" | grep -Eq 'docker +(compose +)?(up|down|run|exec|start|stop|rm|restart|build|create|kill|pull|push|cp)\b'; then
  exit 0
fi

if printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z-])make +(up|dev|down|toolbox|stop|restart)\b'; then
  deny "owner-stack: make $(printf '%s' "$cmd" | grep -Eo 'make +(up|dev|down|toolbox|stop|restart)' | head -1 | awk '{print $2}') starts or stops the owner's stack. Agents run their own stack as lfc-<issue>-<task> via docker compose -p."
fi

if printf '%s' "$cmd" | grep -Eq '(^|[;&|(] *)(docker +compose|docker-compose|docker +run)\b'; then
  project=$(printf '%s' "$cmd" | grep -Eo '(-p|--project-name)[ =]+[A-Za-z0-9_.-]+|COMPOSE_PROJECT_NAME=[A-Za-z0-9_.-]+|--name[ =]+[A-Za-z0-9_.-]+' | head -1 | sed -E 's/^.*[ =]//')
  case "$project" in
    lfc-*) printf '%s' "$project" | grep -Eq "^($OWNER_PROJECTS)$" && deny "owner-stack: $project is the owner's project." ;;
    "") deny "owner-stack: no project name. Agent stacks and containers run as lfc-<issue>-<task> (docker compose -p lfc-123-t1 ... / docker run --name lfc-123-t1-...)." ;;
    *) deny "owner-stack: project '$project' does not start with lfc-. Agent stacks run as lfc-<issue>-<task>." ;;
  esac
fi
exit 0
