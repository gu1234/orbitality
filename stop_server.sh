#!/bin/sh
# Stop the server that ./start_server.sh started.
cd "$(dirname "$0")" || exit 1
node tools/worktrees-ctl.mjs stop
