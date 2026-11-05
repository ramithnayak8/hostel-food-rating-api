#!/usr/bin/env bash
# Open a URL in the default browser. Source this file, then call: open_url http://localhost:8000
# Works in Git Bash / MSYS on Windows, WSL, macOS and Linux desktops. Does nothing (just prints the
# URL) when NO_BROWSER=1, in CI, or when no browser launcher is available.

open_url() {
  local url="$1"
  if [[ "${NO_BROWSER:-0}" == "1" || -n "${CI:-}" ]]; then
    echo "Open $url in your browser."
    return 0
  fi
  echo "Opening $url ..."
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      # //c stops Git Bash rewriting /c as a path; the empty "" is start's window title.
      cmd.exe //c start "" "$url" >/dev/null 2>&1 && return 0 ;;
    Darwin)
      open "$url" >/dev/null 2>&1 && return 0 ;;
    *)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        cmd.exe /c start "" "$url" >/dev/null 2>&1 && return 0
      fi
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 && return 0
      fi ;;
  esac
  echo "Could not open a browser automatically; open $url yourself."
}
