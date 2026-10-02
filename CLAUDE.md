# CLAUDE.md

## Git workflow
- Before starting any non-trivial feature, run `git fetch origin && git status && git log HEAD..origin/main --oneline`. If main has new commits, pull or rebase first. Check whether the feature already exists upstream before building it.
- When a task is done, commit with a descriptive message and push to main (or merge the worktree branch into main) unless I say otherwise. Confirm the push succeeded with `git log origin/main -1`.
