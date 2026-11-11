---
name: yeonieum-git-workflow
description: Apply Yeonieum's main/develop work-branch, Conventional Commit, PR, CI and release-boundary policy when developing, committing, pushing or reviewing this repository.
---

# Yeonieum Git Workflow

Read [the project policy](../../../docs/GIT_WORKFLOW.md) before Git mutations. The repository-specific policy takes precedence over generic examples.

- Integration is develop. Start feature/bugfix work from fresh origin/develop, hotfix from origin/main. Use slash-prefixed lowercase branch names. Keep main/develop changes behind PRs.
- Commit and PR titles use the documented types and a 72-character subject limit. Git-generated merge commits are handled separately by the checker.
- Run `python -m pre_commit run --all-files --show-diff-on-failure` and `python -m unittest discover -s tests/unit -p 'test_*.py' -v` for Git policy changes. App tests remain with their apps.
- Use the PR template. Feature/bugfix target develop; develop/release/hotfix can target main. Hotfix changes also return to develop.
- Verify repository-checks and git-policy on the exact pushed head. Server rules protect main/develop; local commit-msg hooks are additional help.
- Main merges are reserved to the designated maintainer through PRs. The current solo-review policy is documented; do not bypass CI or claim human review happened when it did not.
- The old ci/repository-quality branch is bootstrap history. It is not the normal base for new feature work.
- Publishing a work branch is not permission to merge main or deploy. Actual staging/production deployment is deferred until AWS/app/environment approval and recovery exist.
