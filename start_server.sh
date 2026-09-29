#!/bin/sh
# Start Orbitality in the background and open it in the browser.
# The page lists every worktree (main included); click Play to run that copy of the game.
# Stop it with ./stop_server.sh. Set PORT to use a port other than 8070.
cd "$(dirname "$0")" || exit 1
node tools/worktrees-ctl.mjs start || exit 1
command -v open >/dev/null && open "http://localhost:${PORT:-8070}"
