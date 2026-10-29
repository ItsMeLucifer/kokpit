"""Tests of the repo standard: python3 skills/setup/scripts/test_standard.py (standard library only, no network)."""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
STANDARD = [sys.executable, '-I', str(HERE / 'standard.py')]
FILL = {
    'en': {
        'file': '.claude/org-rules/10-project.md',
        'pairs': [('1. {{RULE}}', '1. A rule.'), ('{{ENVIRONMENT}}', 'Python 3.12 (.python-version).'),
                  ('{{VERIFICATION}}', 'pytest'), ('{{INDEX}}', '')],
        'protected': '{{PROTECTED}}',
        'items': 'data art_work/\nmanual docs/story.md\npaid mcp__Expensive',
        'manual': 'docs/story.md',
        'entry': [('{{MAP}}', ''), ('{{DESCRIPTION}}', 'A test.')],
    },
    'pl': {
        'file': '.claude/org-rules/10-projekt.md',
        'pairs': [('1. {{ZASADA}}', '1. Zasada.'), ('{{SRODOWISKO}}', 'Python 3.12.'),
                  ('{{WERYFIKACJA}}', 'pytest'), ('{{SPIS}}', '')],
        'protected': '{{NIETYKALNE}}',
        'items': 'dane art_work/\nreczne docs/story.md\nplatne mcp__Expensive',
        'manual': 'docs/story.md',
        'entry': [('{{MAPA}}', ''), ('{{OPIS}}', 'Test.')],
    },
}


def run(*cmd, cwd=None, env=None, stdin=None):
    return subprocess.run(list(cmd), cwd=cwd, env=env, input=stdin, capture_output=True, text=True)


class Standard(unittest.TestCase):
    def setUp(self):
        self.dirs = []
        self.new_repo()

    def new_repo(self):
        """A fresh git repo and settings home (subtests call it once per language)."""
        tmp = tempfile.TemporaryDirectory()
        self.dirs.append(tmp)
        self.repo = Path(tmp.name) / 'repo'
        self.repo.mkdir()
        run('git', 'init', '-q', cwd=self.repo)
        (self.repo / 'src').mkdir()
        (self.repo / 'src' / 'a.py').write_text('x = 1\n')
        self.env = dict(os.environ, ORG_RULES_SETTINGS=str(Path(tmp.name) / 'home' / 'settings.json'),
                        CLAUDE_CONFIG_DIR=str(Path(tmp.name) / 'home'))

    def tearDown(self):
        for tmp in self.dirs:
            for d, _, _ in os.walk(tmp.name):
                os.chmod(d, 0o755)
            for f in Path(tmp.name).rglob('*'):
                if f.is_file() and not f.is_symlink():
                    f.chmod(0o644)
            tmp.cleanup()

    def state(self):
        return json.loads(run(*STANDARD, 'state', str(self.repo), '--json').stdout)

    def init(self, lang='en'):
        r = run(*STANDARD, 'init', str(self.repo), '--project', 'Probe', '--owner', 'Someone', '--github', 'someone', '--lang', lang)
        self.assertEqual(r.returncode, 0, r.stdout)

    def fill(self, lang='en'):
        f = FILL[lang]
        p = self.repo / f['file']
        t = p.read_text()
        for a, b in f['pairs']:
            t = t.replace(a, b)
        p.write_text(t.replace(f['protected'], f['items']))
        c = self.repo / '.claude/CLAUDE.md'
        t = c.read_text()
        for a, b in f['entry']:
            t = t.replace(a, b)
        c.write_text(t)
        (self.repo / 'docs/story.md').write_text('x\n')

    def check(self, *args, stdin=None):
        return run(sys.executable, '-I', 'tools/docs/check_docs.py', *args, cwd=self.repo, env=self.env, stdin=stdin)

    def unlock_files(self):
        for p in [self.repo / '.claude/org-rules', *(self.repo / '.claude/org-rules').iterdir()]:
            p.chmod(0o755 if p.is_dir() else 0o644)

    def test_a_skeleton_interview_c(self):
        for lang in ('en', 'pl'):
            with self.subTest(lang=lang):
                self.new_repo()
                self.assertEqual(self.state()['state'], 'A')
                self.init(lang)
                s = self.state()
                self.assertEqual((s['state'], s['language']), ('A', lang))  # template not filled in
                self.assertIn('unfilled template', self.check().stdout)
                self.fill(lang)
                self.check('--write-manifest')
                r = self.check()
                self.assertEqual(r.returncode, 0, r.stdout)
                self.assertNotIn('no verification commands', r.stdout)
                self.assertEqual(self.state()['state'], 'C')
                self.assertTrue((self.repo / 'AGENTS.md').is_symlink())

    def test_lock_and_project_rules(self):
        for lang in ('en', 'pl'):
            with self.subTest(lang=lang):
                self.new_repo()
                self.init(lang)
                self.fill(lang)
                self.check('--write-manifest')
                r = run('sh', 'tools/docs/lock_org_rules.sh', cwd=self.repo, env=self.env)
                self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
                rules = json.loads(Path(self.env['ORG_RULES_SETTINGS']).read_text())['permissions']
                root = str(self.repo.resolve())
                self.assertIn(f'Edit(/{root}/art_work/**)', rules['deny'])
                self.assertIn(f'Edit(/{root}/docs/story.md)', rules['deny'])
                self.assertIn('mcp__Expensive', rules['ask'])
                self.assertIn('Bash(git push *)', rules['ask'])
                self.assertFalse((self.repo / '.claude/org-rules/README.md').stat().st_mode & 0o222)
                status = run('sh', 'tools/docs/lock_org_rules.sh', '--status', cwd=self.repo, env=self.env)
                self.assertEqual(status.returncode, 0, status.stdout)
                self.assertIn('LOCKED', status.stdout)
                # --unlock refuses without a terminal
                self.assertEqual(run('sh', 'tools/docs/lock_org_rules.sh', '--unlock', cwd=self.repo, env=self.env, stdin='').returncode, 3)
                # a changed protected list: the old rule goes, the new one comes
                self.unlock_files()
                p = self.repo / FILL[lang]['file']
                p.write_text(p.read_text().replace('mcp__Expensive', 'mcp__Other'))
                self.check('--write-manifest')
                run('sh', 'tools/docs/lock_org_rules.sh', cwd=self.repo, env=self.env)
                ask = json.loads(Path(self.env['ORG_RULES_SETTINGS']).read_text())['permissions']['ask']
                self.assertNotIn('mcp__Expensive', ask)
                self.assertIn('mcp__Other', ask)

    def test_hook_rules_hints(self):
        self.init()
        self.fill()
        (self.repo / '.claude/rules').mkdir()
        (self.repo / '.claude/rules/code.md').write_text('---\npaths:\n  - "src/**/*.py"\n  - "lib/*.py"\n---\n# Code\n')
        self.check('--write-manifest')
        out = self.check().stdout
        self.assertIn('glob `lib/*.py`', out)
        self.assertIn('directory hint out of date: src/CLAUDE.md', out)
        self.check('--hints')
        self.assertIn('.claude/rules/code.md', (self.repo / 'src/CLAUDE.md').read_text())
        self.assertTrue((self.repo / 'src/AGENTS.md').is_symlink())
        event = lambda rel: json.dumps({'tool_input': {'file_path': str(self.repo / rel)}})
        self.assertEqual(self.check('--hook', stdin=event('src/a.py')).returncode, 0)  # outside .claude/ and docs/
        r = self.check('--hook', stdin=event('docs/README.md'))
        self.assertEqual(r.returncode, 2)
        self.assertIn('lib/*.py', r.stderr)

    def test_missing_verification_is_reported(self):
        self.init()
        self.fill()
        p = self.repo / '.claude/org-rules/10-project.md'
        p.write_text(p.read_text().replace('```bash\npytest\n```', '```bash\n# nothing yet\n```'))
        self.check('--write-manifest')
        self.assertIn('no verification commands', self.check().stdout)

    def test_b_rename_and_core(self):
        (self.repo / '.claude').mkdir()
        (self.repo / '.claude/CLAUDE.MD').write_text('# Old\nRules.\n')
        (self.repo / 'tools/docs').mkdir(parents=True)
        (self.repo / 'tools/docs/check_docs.py').write_text('print("old")\n')
        run('git', 'add', '-A', cwd=self.repo)
        self.assertEqual(self.state()['state'], 'B')
        r = run(*STANDARD, 'init', str(self.repo), '--project', 'P', '--owner', 'K', '--github', 'k')
        self.assertEqual(r.returncode, 2)  # rename first
        run(*STANDARD, 'rename-entry', str(self.repo))
        self.assertTrue((self.repo / '.claude/CLAUDE.md').exists())
        self.assertNotIn('CLAUDE.MD', os.listdir(self.repo / '.claude'))
        self.assertEqual(run(*STANDARD, 'core', str(self.repo)).returncode, 1)
        run(*STANDARD, 'core', str(self.repo), '--write')
        old = list((self.repo / 'docs/archive').rglob('check_docs.py'))
        self.assertEqual(len(old), 1)
        self.assertIn('old', old[0].read_text())
        self.assertIn('core:', (self.repo / 'tools/docs/check_docs.py').read_text())

    def test_polish_repo_stays_polish(self):
        org = self.repo / '.claude/org-rules'
        org.mkdir(parents=True)
        (org / '00-rdzen-wiedza.md').write_text('---\nstatus: org-rules\nwersja: 1\nrdzen: 0.9.0\n---\n')
        s = self.state()
        self.assertEqual(s['language'], 'pl')
        self.assertIn('.claude/org-rules/10-projekt.md', s['missing'])
        self.assertIn('docs/decyzje.md', s['missing'])

    def test_core_templates_have_no_placeholders(self):
        standard = HERE.parent / 'standard'
        for base in (standard / 'core', standard / 'en' / 'core', standard / 'pl' / 'core'):
            for p in base.rglob('*'):
                if p.is_file():
                    self.assertIsNone(re.search(r'\{\{[A-Z_]+\}\}', p.read_text()), p)


if __name__ == '__main__':
    unittest.main()
