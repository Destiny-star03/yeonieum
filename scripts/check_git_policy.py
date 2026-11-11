"""Validate commit headers, branch names and GitHub PR routing without writes."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

TYPES = 'feat|fix|docs|style|refactor|test|chore|ci|revert'
HEADER = re.compile(rf'^(?:{TYPES})(?:\([a-z0-9][a-z0-9._/-]*\))?!?: \S(?:.*\S)?$')
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')
VERSION = re.compile(r'v?\d+\.\d+\.\d+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?')
SHA = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})')


class PolicyError(ValueError):
    """An input violates the documented Git workflow."""


def validate_subject(subject):
    if len(subject) > 72 or not HEADER.fullmatch(subject):
        raise PolicyError(f'Use type(scope): description, at most 72 characters: {subject!r}')


def validate_branch(branch):
    if branch in {'main', 'develop'}:
        return
    category, separator, slug = branch.partition('/')
    if not separator or category not in {'feature', 'bugfix', 'hotfix', 'release'}:
        raise PolicyError(f'Unsupported branch: {branch!r}')
    if not SLUG.fullmatch(slug) and not (category == 'release' and VERSION.fullmatch(slug)):
        raise PolicyError(f'Use a lowercase kebab-case branch suffix: {branch!r}')


def validate_route(head, base):
    validate_branch(head)
    allowed = (
        base == 'develop' and (head == 'main' or head.startswith(('feature/', 'bugfix/', 'hotfix/', 'release/')))
        or base == 'main' and (head == 'develop' or head.startswith(('hotfix/', 'release/')))
    )
    if not allowed:
        raise PolicyError(f'Unsupported PR route: {head!r} -> {base!r}')


def git(*args):
    result = subprocess.run(['git', *args], text=True, encoding='utf-8', capture_output=True)
    if result.returncode:
        raise PolicyError(f'git {args[0]} failed: {result.stderr.strip()}')
    return result.stdout.strip()


def commit_sha(value):
    if not isinstance(value, str) or not SHA.fullmatch(value) or set(value) == {'0'}:
        raise PolicyError('Expected a nonzero full commit SHA')
    return value


def validate_commits(base, head):
    head = commit_sha(head)
    revision = f'{commit_sha(base)}..{head}' if base else head
    if base:
        git('cat-file', '-e', f'{base}^{{commit}}')
        commits = git('rev-list', '--reverse', '--no-merges', revision).splitlines()
    else:
        # No usable base: check this commit, not an imported repository's entire history.
        parents = git('show', '-s', '--format=%P', head).split()
        commits = [] if len(parents) > 1 else [head]
    for sha in commits:
        validate_subject(git('show', '-s', '--format=%s', commit_sha(sha)))
    return len(commits)


def new_branch_base(branch, head):
    preferred = ['origin/main', 'origin/develop'] if branch.startswith('hotfix/') else ['origin/develop', 'origin/main']
    for ref in preferred:
        found = subprocess.run(['git', 'rev-parse', '--verify', ref], capture_output=True, text=True)
        if found.returncode == 0:
            return git('merge-base', commit_sha(found.stdout.strip()), head)
    return None


def check_ci(event_name, event, ref):
    if event_name == 'pull_request':
        pr = event['pull_request']
        head_branch, base_branch = pr['head']['ref'], pr['base']['ref']
        validate_route(head_branch, base_branch)
        if head_branch in {'main', 'develop'}:
            head_repo = pr['head']['repo']['id']
            base_repo = pr['base']['repo']['id']
            if not head_repo or head_repo != base_repo:
                raise PolicyError('Protected integration branches must belong to this repository')
        validate_subject(pr['title'])
        return validate_commits(commit_sha(pr['base']['sha']), commit_sha(pr['head']['sha']))
    if event_name not in {'push', 'workflow_dispatch'}:
        raise PolicyError(f'Unsupported CI event: {event_name!r}')
    if event.get('deleted'):
        return 0
    if not ref.startswith('refs/heads/'):
        raise PolicyError('Select a branch ref for this workflow')
    branch = ref.removeprefix('refs/heads/')
    validate_branch(branch)
    head = commit_sha(event['after']) if event_name == 'push' else commit_sha(git('rev-parse', 'HEAD'))
    before = event.get('before', '')
    base = commit_sha(before) if before and set(before) != {'0'} else new_branch_base(branch, head)
    return validate_commits(base, head)


def check_message_file(path):
    # Git-created merge messages are not ordinary feature commit headers.
    merge_head = Path(git('rev-parse', '--git-path', 'MERGE_HEAD'))
    if merge_head.exists():
        return
    lines = [line for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip() and not line.startswith('#')]
    validate_subject(lines[0] if lines else '')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    message = commands.add_parser('commit-msg')
    message.add_argument('path', type=Path)
    branch = commands.add_parser('branch')
    branch.add_argument('name')
    commands.add_parser('ci')
    args = parser.parse_args()
    try:
        if args.command == 'commit-msg':
            check_message_file(args.path)
        elif args.command == 'branch':
            validate_branch(args.name)
        else:
            event_path = Path(os.environ['GITHUB_EVENT_PATH'])
            event = json.loads(event_path.read_text(encoding='utf-8'))
            count = check_ci(os.environ['GITHUB_EVENT_NAME'], event, os.environ.get('GITHUB_REF', ''))
            print(f'Git policy passed; checked {count} non-merge commit(s).')
    except (PolicyError, KeyError, OSError, json.JSONDecodeError) as exc:
        print(f'Git policy failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
