import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import publish


class PublicationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.provenance = {'repository': 'owner/caddy-ui', 'run': '123', 'attempt': '2',
                           'runUrl': 'https://github.com/owner/caddy-ui/actions/runs/123/attempts/2',
                           'sourceCommit': 'a' * 40, 'conclusion': 'failure',
                           'artifactId': 456, 'artifactName': 'etoe-diagnostics-123-2',
                           'archiveSha256': 'b' * 64}

    def archive(self, entries, name='artifact.zip'):
        path = self.root / name
        with zipfile.ZipFile(path, 'w') as archive:
            for name, value in entries:
                archive.writestr(name, value)
        return path

    def experiment_entries(self):
        return [('experiment.json', json.dumps({'runId': '123', 'attempt': '2', 'commit': 'a' * 40})),
                ('SUMMARY.md', '# Summary\n\nOriginal observations.\n'),
                ('001-normal/case/evidence.md', '# Evidence\n\nA qualified observation.\n'),
                ('001-normal/case/backend-log.json', '{"message": "unchanged"}\n'),
                ('001-normal/case/final.png', b'PNG fixture')]

    def test_nested_archives_retained_and_expanded_with_original_hashes(self):
        trace = io.BytesIO()
        with zipfile.ZipFile(trace, 'w') as archive:
            archive.writestr('resources/screenshot.png', b'trace screenshot')
        archive = self.archive(self.experiment_entries() + [('001-normal/case/trace.zip', trace.getvalue())])
        destination = self.root / 'prepared'
        publish.prepare(archive, destination, self.provenance)
        artifact = destination / 'artifact'
        self.assertEqual((artifact / '001-normal/case/trace.zip').read_bytes(), trace.getvalue())
        self.assertEqual((artifact / '001-normal/case/trace.zip.contents/resources/screenshot.png').read_bytes(), b'trace screenshot')
        hashes = json.loads((destination / 'files.sha256.json').read_text())
        self.assertEqual(hashes['001-normal/case/trace.zip'], publish.digest(artifact / '001-normal/case/trace.zip'))
        self.assertNotIn('README.md', hashes)
        self.assertIn('Original observations.', (artifact / 'README.md').read_text())
        page = (artifact / '001-normal/case/README.md').read_text()
        self.assertIn('A qualified observation.', page)
        self.assertIn('![Final browser state](final.png)', page)
        self.assertIn('unchanged', page)
        self.assertIn('**failure**', (destination / 'README.md').read_text())

    def test_unsafe_names_and_links_are_rejected(self):
        for i, name in enumerate(('../escape', '/absolute', 'a/../../escape', 'a\\escape',
                                  '.git/config', 'a/.GIT/config', 'C:/file', 'a//file', 'a/./file', 'bad\nname')):
            with self.subTest(name=name), self.assertRaises(ValueError):
                publish.extract_archive(self.archive([(name, 'bad')], f'bad-{i}.zip'), self.root / f'out-{i}')
        entry = zipfile.ZipInfo('link')
        entry.create_system = 3
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(ValueError):
            publish.extract_archive(self.archive([(entry, '/outside')], 'link.zip'), self.root / 'link')
        self.assertFalse((self.root / 'escape').exists())

    def test_duplicate_and_nested_output_collisions_are_rejected(self):
        # A normal file must not be replaced by expanded ZIP contents.
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, 'w') as archive:
            archive.writestr('evidence.json', '{}')
        archive = self.archive([('trace.zip', inner.getvalue()), ('trace.zip.contents/file', 'original')])
        with self.assertRaises(FileExistsError):
            publish.extract_archive(archive, self.root / 'collision')
        with self.assertRaises(FileExistsError):
            publish.extract_archive(self.archive([('a', 'file'), ('a/b', 'collision')], 'overlap.zip'), self.root / 'overlap')

    def test_extraction_budget_includes_nested_data(self):
        archive = self.archive([('data', b'x' * 30)])
        with patch.object(publish, 'MAX_TOTAL', 20), self.assertRaises(ValueError):
            publish.extract_archive(archive, self.root / 'total')
        with patch.object(publish, 'MAX_FILE', 20), self.assertRaises(ValueError):
            publish.extract_archive(archive, self.root / 'file')
        with patch.object(publish, 'MAX_ENTRIES', 0), self.assertRaises(ValueError):
            publish.extract_archive(archive, self.root / 'entries')
        with self.assertRaises(ValueError):
            publish.extract_archive(archive, self.root / 'depth', depth=4)

    def test_evidence_at_extraction_limit_has_separate_room_for_readable_pages(self):
        archive = self.archive(self.experiment_entries())
        with zipfile.ZipFile(archive) as bundle:
            evidence_size = sum(entry.file_size for entry in bundle.infolist())
        destination = self.root / 'prepared'
        # Reproduce the failed run: extraction fits, but any added page exceeds
        # the old shared ceiling. No large allocation is needed to test it.
        with patch.object(publish, 'MAX_TOTAL', evidence_size):
            publish.prepare(archive, destination, self.provenance)
        self.assertGreater(sum(path.stat().st_size for path in destination.rglob('*') if path.is_file()), evidence_size)
        self.assertEqual((destination / 'artifact/001-normal/case/backend-log.json').read_text(), '{"message": "unchanged"}\n')
        with patch.object(publish, 'MAX_RENDERED', 1), self.assertRaisesRegex(ValueError, 'Generated pages exceed'):
            publish.prepare(archive, self.root / 'too-many-pages', self.provenance)

    def test_generated_readmes_are_bounded_without_truncating_original_reports(self):
        original = '# Report\n\n' + ('Important observation.\n' * 10000)
        entries = [(name, original if name.endswith('evidence.md') else value)
                   for name, value in self.experiment_entries()]
        destination = self.root / 'prepared'
        publish.prepare(self.archive(entries), destination, self.provenance)
        case = destination / 'artifact/001-normal/case'
        self.assertEqual((case / 'evidence.md').read_text(), original)
        self.assertLess((case / 'README.md').stat().st_size, publish.MAX_PAGE)
        self.assertIn('inline excerpt truncated', (case / 'README.md').read_text())
        oversized = self.root / 'oversized'
        oversized.mkdir()
        (oversized / 'file.json').write_text('a' * 1000)
        with patch.object(publish, 'MAX_PAGE', 400):
            publish.browse(oversized)
        self.assertLess((oversized / 'README.md').stat().st_size, 400)
        self.assertIn('too much content', (oversized / 'README.md').read_text())
        self.assertEqual((oversized / 'file.json').read_text(), 'a' * 1000)

    def test_identity_mismatch_stops_publication(self):
        archive = self.archive(self.experiment_entries())
        for key in ('run', 'attempt', 'sourceCommit'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                publish.prepare(archive, self.root / key, {**self.provenance, key: '999'})

    def test_only_completed_same_repository_manual_diagnostic_runs_are_accepted(self):
        run = {'id': 123, 'run_attempt': 2, 'head_repository': {'full_name': 'owner/caddy-ui'},
               'head_branch': publish.SOURCE_BRANCH, 'event': 'workflow_dispatch',
               'path': '.github/workflows/test.yml', 'status': 'completed'}
        publish.verify_run(run, 'owner/caddy-ui', '123', '2')
        for key, value in [('id', 124), ('run_attempt', 1), ('head_repository', {'full_name': 'other/caddy-ui'}),
                           ('head_branch', 'main'), ('event', 'pull_request'), ('path', 'other.yml'), ('status', 'in_progress')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                publish.verify_run({**run, key: value}, 'owner/caddy-ui', '123', '2')
        for value in ('', '0', '-1', '1/../2', '1; echo bad', '123\n'):
            with self.assertRaises(ValueError):
                publish.numeric(value)

    def test_original_readme_and_hostile_log_remain_data(self):
        destination = self.root / 'pages'
        destination.mkdir()
        (destination / 'a b').mkdir()
        (destination / 'log.json').write_text('```\n</details><script>bad</script>')
        (destination / 'a b/README.md').write_text('original')
        publish.browse(destination)
        page = (destination / 'README.md').read_text()
        self.assertIn('(a%20b/)', page)
        self.assertIn('    </details><script>bad</script>', page)
        self.assertEqual((destination / 'a b/README.md').read_text(), 'original')

    def test_append_idempotence_and_refusal_to_replace_evidence(self):
        prepared = self.root / 'prepared'
        publish.prepare(self.archive(self.experiment_entries()), prepared, self.provenance)
        results = self.root / 'results'
        results.mkdir()
        relative, changed = publish.install(prepared, results, self.provenance)
        self.assertTrue(changed)
        first = {p.relative_to(results): p.read_bytes() for p in results.rglob('*') if p.is_file()}
        self.assertFalse(publish.install(prepared, results, self.provenance)[1])
        self.assertEqual(first, {p.relative_to(results): p.read_bytes() for p in results.rglob('*') if p.is_file()})
        (prepared / 'provenance.json').write_text('{}')
        with self.assertRaises(ValueError):
            publish.install(prepared, results, self.provenance)
        self.assertEqual((results / relative / 'provenance.json').read_bytes(), first[relative / 'provenance.json'])

    def test_real_git_round_trip_creates_isolated_results_branch_and_appends(self):
        """Exercise actual CLI, gh artifact download contract, Git push and rerun."""
        bare = self.root / 'remote.git'
        subprocess.run(['git', 'init', '--bare', str(bare)], check=True, capture_output=True)
        archive = self.archive(self.experiment_entries())
        run = {'id': 123, 'run_attempt': 2, 'head_repository': {'full_name': 'owner/caddy-ui'},
               'head_branch': publish.SOURCE_BRANCH, 'event': 'workflow_dispatch',
               'path': '.github/workflows/test.yml', 'status': 'completed', 'head_sha': 'a' * 40, 'conclusion': 'failure'}
        artifact = {'id': 456, 'name': 'etoe-diagnostics-123-2', 'expired': False,
                    'size_in_bytes': archive.stat().st_size, 'digest': f'sha256:{publish.digest(archive)}'}
        binary = self.root / 'bin'
        binary.mkdir()
        fake = binary / 'gh'
        fake.write_text('#!/usr/bin/env python3\nimport json, sys\nfrom pathlib import Path\n'
                        f'run = {run!r}\nartifact = {artifact!r}\n'
                        'endpoint = sys.argv[-1]\n'
                        'if endpoint.endswith("/attempts/2"): print(json.dumps(run))\n'
                        'elif "/artifacts?" in endpoint: print(json.dumps([{ "artifacts": [artifact] }]))\n'
                        f'elif endpoint.endswith("/zip"): sys.stdout.buffer.write(Path({str(archive)!r}).read_bytes())\n'
                        'else: sys.exit("Unexpected gh invocation")\n')
        fake.chmod(0o755)
        environment = {**os.environ, 'GITHUB_REPOSITORY': 'owner/caddy-ui',
                       'PATH': f'{binary}:{os.environ["PATH"]}', 'GITHUB_STEP_SUMMARY': str(self.root / 'summary.md'),
                       'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': f'url.{bare}.insteadOf',
                       'GIT_CONFIG_VALUE_0': 'https://github.com/owner/caddy-ui.git'}
        cli = ['python3', str(Path(publish.__file__)), '--run', '123', '--attempt', '2']
        first = subprocess.run(cli, env=environment, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        second = subprocess.run(cli, env=environment, capture_output=True, text=True)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(first.stdout, second.stdout)
        refs = publish.command('git', '--git-dir', str(bare), 'for-each-ref', '--format=%(refname)')
        self.assertEqual(refs, f'refs/heads/{publish.RESULTS_BRANCH}')
        self.assertEqual(publish.command('git', '--git-dir', str(bare), 'rev-list', '--count', publish.RESULTS_BRANCH), '1')
        self.assertIn('/runs/123/attempt-2', (self.root / 'summary.md').read_text())
        # Corrupt download metadata must fail before a Git branch is changed.
        fake.write_text(fake.read_text().replace(artifact['digest'], 'sha256:' + '0' * 64))
        corrupt = subprocess.run(cli, env=environment, capture_output=True, text=True)
        self.assertNotEqual(corrupt.returncode, 0)
        self.assertIn('does not match GitHub artifact digest', corrupt.stderr)
        self.assertEqual(publish.command('git', '--git-dir', str(bare), 'rev-list', '--count', publish.RESULTS_BRANCH), '1')
        # Another attempt gets its own folder and preserves the first publication.
        next_provenance = {**self.provenance, 'attempt': '3'}
        prepared = self.root / 'prepared'
        prepared.mkdir()
        (prepared / 'provenance.json').write_text(json.dumps(next_provenance))
        with patch.dict(os.environ, environment):
            checkout = self.root / 'checkout'
            git = publish.open_results('owner/caddy-ui', checkout)
            publish.install(prepared, checkout, next_provenance)
            publish.command(*git, 'add', '--all')
            publish.command(*git, 'commit', '-m', 'second publication')
            publish.command(*git, 'push', 'origin', f'HEAD:refs/heads/{publish.RESULTS_BRANCH}')
        self.assertTrue((checkout / 'runs/123/attempt-2/artifact/experiment.json').is_file())
        self.assertTrue((checkout / 'runs/123/attempt-3/provenance.json').is_file())
        self.assertIn('attempt-3/', (checkout / 'README.md').read_text())

    def test_existing_source_branch_is_never_adopted_as_results(self):
        directory = self.root / 'results'
        def git(*args, **kwargs):
            if args[0] == 'git' and 'reset' in args:
                (directory / 'application.js').write_text('original application')
            return ''
        with patch.object(publish, 'command', side_effect=git), \
                patch.object(publish.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')), \
                self.assertRaisesRegex(ValueError, 'not a diagnostic publication branch'):
            publish.open_results('owner/caddy-ui', directory)
        self.assertEqual((directory / 'application.js').read_text(), 'original application')


if __name__ == '__main__':
    unittest.main()
