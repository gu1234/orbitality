# CLAUDE.md

## Git workflow
- Before starting any non-trivial feature, run `git fetch origin && git status && git log HEAD..origin/main --oneline`. If main has new commits, pull or rebase first. Check whether the feature already exists upstream before building it.
- When a task is done, commit with a descriptive message and push to main (or merge the worktree branch into main) unless I say otherwise. Confirm the push succeeded with `git log origin/main -1`.

## Verification (web game)
- After any UI, visual or gameplay change, run the test suite and verify in headless Chrome. Take screenshots at desktop, mobile portrait and mobile landscape sizes, with touch emulation for mobile controls.
- Check for overflow and off-screen elements in landscape.
- Write screenshot and verification scripts with the Write tool as files, not heredocs, because the shell guard blocks heredocs.

## Visual design defaults
- Background and decorative elements (asteroid belts, orbits, glows, terminators) should be subtle and low-opacity by default. Gameplay elements must stay the most prominent.
- Aim for realism over stylization. Plumes and smoke should use soft, layered, noisy particles, not circular blobs. Lighting edges and day/night terminators should have soft gradients, not hard edges.

## Tutorial / onboarding rules
- Tutorial step completion must require an explicit player action (for example, a burn performed or a button pressed), never passive state like proximity, which can happen through drift or time warp.
- When I ask to change hint or tooltip text, find every place that text or concept appears (tooltips, readouts, tutorial copy, README) and update all of them.

## Deployment
- Before deploying (Cloudflare Pages / wrangler, GitHub Pages), verify auth works (for example, `wrangler whoami`) before making changes. Never delete tokens or credentials without asking.
- After deploying, confirm the live URL serves the new version (for example, check the version hash in the menu).
