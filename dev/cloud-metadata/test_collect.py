import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import collect

REVISION = 'a' * 40
PATH = 'cloudinit/sources/DataSourceExample.py'
REFERENCE = {
    'endpoints': [
        {'provider': 'Example', 'host': 'fd20:ce::254',
         'url': 'http://[fd20:ce::254]/', 'documentation': 'https://example.com/docs'},
    ],
}


class ExtractionTests(unittest.TestCase):
    def test_ipv6_and_path_template_preserve_provenance(self):
        rows, manual = collect.extract('URL = "http://[FD00:C1::a9fe:a9fe]/v{version}/"', PATH, REVISION)
        self.assertEqual(rows[0]['host'], 'fd00:c1::a9fe:a9fe')
        self.assertEqual(rows[0]['url_literal'], 'http://[FD00:C1::a9fe:a9fe]/v{version}/')
        self.assertEqual(rows[0]['source'], f'https://github.com/canonical/cloud-init/blob/{REVISION}/{PATH}#L1')
        self.assertEqual(manual, [])

    def test_comments_and_docstrings_do_not_become_candidates(self):
        rows, manual = collect.extract('"""http://169.254.1.1"""\n# http://169.254.2.2\ndef f():\n    """http://169.254.3.3"""\n', PATH, REVISION)
        self.assertEqual((rows, manual), ([], []))

    def test_dynamic_authorities_and_scoped_ipv6_need_review(self):
        source = 'A = f"http://{host}/"\nB = "http://[fe80::a9fe:a9fe%25{iface}]".format(iface="eth0")'
        rows, manual = collect.extract(source, PATH, REVISION)
        self.assertEqual(rows, [])
        self.assertEqual([row['line'] for row in manual], [1, 2])

    def test_hostname_aliases_are_normalized_and_other_urls_are_retained(self):
        rows, manual = collect.extract('A = "http://METADATA.Google.Internal./v1/"\nB = "https://docs.example.com/a"\nC = "http://lxd"', PATH, REVISION)
        self.assertEqual(rows[0]['host'], 'metadata.google.internal')
        self.assertEqual(len(manual), 2)

    def test_concatenated_literals_and_source_are_not_executed(self):
        source = 'raise RuntimeError("must not execute")\nURL = ("http://169.254.169.254/" "metadata/v1/")'
        rows, _ = collect.extract(source, PATH, REVISION)
        self.assertEqual(rows[0]['url_literal'], 'http://169.254.169.254/metadata/v1/')

    def test_invalid_authorities_are_not_candidates(self):
        for value in ('http://', 'ftp://169.254.1.1', 'http://[broken]',
                      'http://user:password@169.254.1.1', 'http://169.254.1.1:bad'):
            with self.subTest(value=value):
                self.assertIsNone(collect.endpoint(value))


class CommittedSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name) / 'source'
        self.repo.mkdir()
        collect.git(self.repo, 'init', '--quiet')
        collect.git(self.repo, 'remote', 'add', 'origin', collect.UPSTREAM)
        self.source = self.repo / PATH
        self.source.parent.mkdir(parents=True)
        self.source.write_text('URLS = ["http://169.254.169.254", "http://169.254.169.254/v1/"]\n')
        collect.git(self.repo, 'add', '.')
        collect.git(self.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture')
        self.revision = collect.git(self.repo, 'rev-parse', 'HEAD').strip()

    def test_grouping_reference_only_and_dirty_worktree_isolation(self):
        self.source.write_text('raise RuntimeError("dirty tree is ignored")')
        report = collect.collect(self.repo, self.revision, REFERENCE)
        self.assertEqual(len(report['candidates']), 1)
        self.assertEqual(len(report['candidates'][0]['observations']), 2)
        self.assertEqual(report['reference_only'], REFERENCE['endpoints'])
        self.assertEqual(len(report['files'][0]['sha256']), 64)
        rendered = collect.markdown(report)
        self.assertIn('No — retain for review', rendered)
        self.assertIn(self.revision, rendered)

    def test_reference_match_is_host_presence(self):
        reference = copy.deepcopy(REFERENCE)
        reference['endpoints'][0].update(host='169.254.169.254', url='http://169.254.169.254/')
        report = collect.collect(self.repo, self.revision, reference)
        self.assertTrue(report['candidates'][0]['in_reference'])
        self.assertEqual(report['reference_only'], [])

    def test_bad_reference_fails(self):
        reference = copy.deepcopy(REFERENCE)
        reference['endpoints'][0]['host'] = '127.0.0.1'
        with self.assertRaisesRegex(ValueError, 'Invalid reference'):
            collect.collect(self.repo, self.revision, reference)

    def test_moving_ref_and_wrong_origin_are_rejected(self):
        with self.assertRaisesRegex(ValueError, '40-character'):
            collect.collect(self.repo, 'main', REFERENCE)
        collect.git(self.repo, 'remote', 'set-url', 'origin', 'https://example.com/other.git')
        with self.assertRaisesRegex(ValueError, 'origin must be'):
            collect.collect(self.repo, self.revision, REFERENCE)

    def test_cli_failure_preserves_previous_output(self):
        output = Path(self.temporary.name) / 'result'
        output.mkdir()
        previous = output / 'snapshot.json'
        previous.write_text('{"previous": true}\n')
        result = subprocess.run(
            ['python3', str(Path(collect.__file__)), '--checkout', str(self.repo),
             '--ref', '0' * 40, '--output', str(output)],
            capture_output=True, text=True, timeout=15,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Collection failed:', result.stderr)
        self.assertEqual(json.loads(previous.read_text()), {'previous': True})
        self.assertFalse((output / 'README.md').exists())

    def test_same_committed_source_is_deterministic(self):
        first = collect.collect(self.repo, self.revision, REFERENCE)
        second = collect.collect(self.repo, self.revision, REFERENCE)
        self.assertEqual(first, second)
        self.assertEqual(collect.markdown(first), collect.markdown(second))


if __name__ == '__main__':
    unittest.main()
