"""Exercise policy boundaries and real commit-range behavior in isolated Git repos."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scripts import check_git_policy as policy

SCRIPT = Path(policy.__file__).resolve()


class PolicyRules(unittest.TestCase):
    def test_valid_names_and_headers(self):
        for branch in ['main', 'develop', 'feature/login', 'bugfix/login-error', 'hotfix/auth', 'release/0.1.0']:
            with self.subTest(branch=branch):
                policy.validate_branch(branch)
        for subject in ['feat: 로그인 추가', 'fix(access): handle expiry', 'ci: check Git policy', 'refactor(api)!: change contract']:
            with self.subTest(subject=subject):
                policy.validate_subject(subject)

    def test_invalid_names_and_headers(self):
        for branch in ['feature-login', 'feature/Login', 'feature/a b', 'feature/../main', 'ci/new-work', 'feature/a/b']:
            with self.subTest(branch=branch), self.assertRaises(policy.PolicyError):
                policy.validate_branch(branch)
        for subject in ['update code', 'fix bug', 'feat:', 'feat: ', 'feat: trailing ', ' feat: leading', 'unknown: task', 'docs: ' + 'x' * 70]:
            with self.subTest(subject=subject), self.assertRaises(policy.PolicyError):
                policy.validate_subject(subject)

    def test_pr_boundaries(self):
        for head, base in [('feature/login', 'develop'), ('bugfix/login', 'develop'), ('hotfix/auth', 'main'), ('hotfix/auth', 'develop'), ('develop', 'main'), ('main', 'develop'), ('release/0.1.0', 'main')]:
            policy.validate_route(head, base)
        for head, base in [('feature/login', 'main'), ('bugfix/login', 'main'), ('main', 'main'), ('feature/login', 'feature/other'), ('develop', 'develop')]:
            with self.subTest(head=head, base=base), self.assertRaises(policy.PolicyError):
                policy.validate_route(head, base)

    def test_reject_option_like_or_empty_revision(self):
        for sha in ['--all', '', '0' * 40, 'HEAD', 'x' * 40]:
            with self.subTest(sha=sha), self.assertRaises(policy.PolicyError):
                policy.commit_sha(sha)


class GitIntegration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='yeonieum-git-policy-')
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.run_git('init', '-q', '-b', 'develop')
        self.run_git('config', 'user.name', 'Policy Test')
        self.run_git('config', 'user.email', 'policy@example.invalid')
        self.empty_hooks = self.repo/'empty-hooks'
        self.empty_hooks.mkdir()
        self.base = self.commit('Initial commit')
        self.run_git('update-ref', 'refs/remotes/origin/develop', self.base)
        self.run_git('switch', '-q', '-c', 'feature/login')
        self.head = self.commit('feat: add login')

    def run_git(self, *args):
        result = subprocess.run(['git', '-C', str(self.repo), *args], capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def commit(self, subject):
        self.run_git('-c', 'commit.gpgsign=false', '-c', f'core.hooksPath={self.empty_hooks}', 'commit', '--allow-empty', '-q', '-m', subject)
        return self.run_git('rev-parse', 'HEAD')

    def ci(self, event_name, payload, ref='refs/heads/feature/login'):
        event_path = self.repo/'event.json'
        event_path.write_text(json.dumps(payload), encoding='utf-8')
        env = dict(os.environ, GITHUB_EVENT_NAME=event_name, GITHUB_EVENT_PATH=str(event_path), GITHUB_REF=ref, PYTHONUTF8='1')
        return subprocess.run([sys.executable, str(SCRIPT), 'ci'], cwd=self.repo, env=env, capture_output=True, text=True, encoding='utf-8')

    def pr(self, title='feat: add login', base='develop'):
        return {'pull_request': {'title': title, 'head': {'ref': 'feature/login', 'sha': self.head, 'repo': {'id': 1}}, 'base': {'ref': base, 'sha': self.base, 'repo': {'id': 1}}}}

    def test_new_branch_does_not_revalidate_legacy_initial_commit(self):
        result = self.ci('push', {'before': '0' * 40, 'after': self.head})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('checked 1', result.stdout)

    def test_invalid_new_commit_fails_ci(self):
        bad = self.commit('update code')
        result = self.ci('push', {'before': self.head, 'after': bad})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('update code', result.stderr)

    def test_pr_requires_correct_base_and_title(self):
        self.assertEqual(self.ci('pull_request', self.pr()).returncode, 0)
        self.assertNotEqual(self.ci('pull_request', self.pr(base='main')).returncode, 0)
        self.assertNotEqual(self.ci('pull_request', self.pr(title='update')).returncode, 0)

    def test_fork_cannot_impersonate_protected_integration_branch(self):
        for head, base in [('develop', 'main'), ('main', 'develop')]:
            payload = self.pr(base=base)
            payload['pull_request']['head']['ref'] = head
            self.assertEqual(self.ci('pull_request', payload).returncode, 0)
            payload['pull_request']['head']['repo']['id'] = 2
            result = self.ci('pull_request', payload)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('must belong to this repository', result.stderr)

    def test_fork_feature_can_open_normal_pr(self):
        payload = self.pr()
        payload['pull_request']['head']['repo']['id'] = 2
        self.assertEqual(self.ci('pull_request', payload).returncode, 0)

    def test_manual_dispatch_on_feature(self):
        self.assertEqual(self.ci('workflow_dispatch', {}).returncode, 0)

    def test_missing_revision_fails_instead_of_skipping(self):
        result = self.ci('push', {'before': 'a' * 40, 'after': self.head})
        self.assertNotEqual(result.returncode, 0)

    def test_commit_message_hook_entry(self):
        message = self.repo/'message.txt'
        for text, expected in [('docs: update guide\n', 0), ('update\n', 1)]:
            message.write_text(text, encoding='utf-8')
            result = subprocess.run([sys.executable, str(SCRIPT), 'commit-msg', str(message)], cwd=self.repo, capture_output=True)
            self.assertEqual(result.returncode, expected)


if __name__ == '__main__':
    unittest.main()
