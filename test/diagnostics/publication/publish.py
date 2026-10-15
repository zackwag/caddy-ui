"""Publish existing evidence only; never import or execute artifact contents."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tempfile
from urllib.parse import quote
import zipfile


RESULTS_BRANCH = 'dev/etoe-diagnostic-results'
SOURCE_BRANCH = 'dev/etoe-diagnostics'
MAX_FILE = 90 * 1024 * 1024  # Below GitHub's 100 MiB Git blob limit.
MAX_TOTAL = 1024 * 1024 * 1024
MAX_ENTRIES = 20000


def command(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def numeric(value):
    if not re.fullmatch(r'[1-9][0-9]{0,19}', value):
        raise ValueError('Run and attempt must be positive decimal IDs')
    return value


def verify_run(run, repository, run_id, attempt):
    if (str(run['id']) != run_id or str(run['run_attempt']) != attempt
            or run['head_repository']['full_name'] != repository
            or run['head_branch'] != SOURCE_BRANCH
            or run['event'] != 'workflow_dispatch'
            or run['path'] != '.github/workflows/test.yml'
            or run['status'] != 'completed'):
        raise ValueError('Select a completed Test diagnostic run from this repository/branch')


def extract_archive(archive, destination, budget=None, depth=0):
    """Keep ZIPs and expand them alongside; reject traversal, links and bombs."""
    if budget is None:
        budget = {'bytes': 0, 'entries': 0}
    if depth > 3:
        raise ValueError('Nested archive depth exceeds 3')
    destination.mkdir(parents=True, exist_ok=False)
    nested = []
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            path = PurePosixPath(entry.filename)
            mode = entry.external_attr >> 16
            if (not entry.filename or path.is_absolute() or '\\' in entry.filename
                    or any(part in ('', '.', '..') or part.casefold() == '.git'
                           or ':' in part or any(ord(c) < 32 for c in part)
                           for part in entry.filename.rstrip('/').split('/'))
                    or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise ValueError(f'Unsafe ZIP entry: {entry.filename!r}')
            budget['entries'] += 1
            budget['bytes'] += entry.file_size
            if (budget['entries'] > MAX_ENTRIES or budget['bytes'] > MAX_TOTAL
                    or entry.file_size > MAX_FILE):
                raise ValueError('Publication size limit exceeded; retain the Actions artifact and use smaller experiments')
            target = destination.joinpath(*path.parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            # Exclusive creation prevents duplicate entries / file-directory collisions.
            with bundle.open(entry) as source, target.open('xb') as output:
                remaining = entry.file_size
                while chunk := source.read(min(1024 * 1024, remaining + 1)):
                    remaining -= len(chunk)
                    if remaining < 0:
                        raise ValueError('ZIP entry exceeds its declared size')
                    output.write(chunk)
                if remaining:
                    raise ValueError('Incomplete ZIP entry')
            if target.suffix.lower() == '.zip':
                nested.append(target)
    for archive in nested:
        extract_archive(archive, archive.with_name(archive.name + '.contents'), budget, depth + 1)


def markdown_text(value):
    return str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('|', '&#124;').replace('\n', ' ')


def browse(directory):
    """GitHub-rendered directory pages, bounded previews and inline screenshots."""
    for child in sorted(directory.iterdir()):
        if child.is_dir():
            browse(child)
    if (directory / 'README.md').exists():
        return  # Preserve any original README bytes.
    lines = [f'# {markdown_text(directory.name)}', '']
    for name in ('SUMMARY.md', 'evidence.md'):
        if (directory / name).is_file():
            lines.extend([(directory / name).read_text(), ''])
    if (directory / 'EVIDENCE.md').is_file():
        lines.extend(['[Scenario evidence index](EVIDENCE.md)', ''])
    lines.extend(['## Files', ''])
    for child in sorted(directory.iterdir()):
        label = child.name + ('/' if child.is_dir() else '')
        lines.append(f'- [{markdown_text(label)}]({quote(child.name, safe="")}{"/" if child.is_dir() else ""})')
    if (directory / 'final.png').is_file():
        lines.extend(['', '## Final screenshot', '', '![Final browser state](final.png)'])
    for child in sorted(directory.iterdir()):
        if child.is_file() and child.suffix in ('.json', '.ndjson', '.log'):
            with child.open('r', errors='replace') as source:
                excerpt = source.read(12000)
            # Indented code inside details avoids closing-fence / raw HTML injection.
            code = '\n'.join('    ' + line for line in excerpt.splitlines())
            lines.extend(['', f'<details><summary>{markdown_text(child.name)} — preview (up to 12,000 characters)</summary>',
                          '', code, '', '</details>', ''])
    (directory / 'README.md').write_text('\n'.join(lines) + '\n')


def prepare(archive, destination, provenance):
    """Build a new immutable run folder; originals are hashed before adding pages."""
    destination.mkdir(parents=True, exist_ok=False)
    artifact = destination / 'artifact'
    extract_archive(archive, artifact)
    experiment = json.loads((artifact / 'experiment.json').read_text())
    if (str(experiment['runId']) != provenance['run']
            or str(experiment['attempt']) != provenance['attempt']
            or experiment['commit'] != provenance['sourceCommit']):
        raise ValueError('Artifact experiment identity does not match the selected source run')
    files = {str(path.relative_to(artifact)): digest(path)
             for path in sorted(artifact.rglob('*')) if path.is_file()}
    (destination / 'files.sha256.json').write_text(json.dumps(files, indent=2) + '\n')
    (destination / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    browse(artifact)
    (destination / 'README.md').write_text(
        f'# E2E diagnostics — run {provenance["run"]}, attempt {provenance["attempt"]}\n\n'
        f'[Read the report and browse evidence](artifact/) · [Source workflow run]({provenance["runUrl"]})\n\n'
        f'Source commit: `{provenance["sourceCommit"]}`. Collection conclusion: **{provenance["conclusion"]}**.\n\n'
        'Publication does not rerun tests or alter their outcomes. A successful collection may contain failed trials; '
        'check the report. Partial evidence remains marked by its original collection metadata.\n\n'
        'ZIPs are retained and expanded into adjacent `*.zip.contents/` folders. '
        'Directory pages render summaries, screenshots and bounded log previews on GitHub. '
        'Original files remain available, including trace ZIPs for Playwright. '
        'These are GitHub pages for reading evidence, not an interactive trace viewer.\n\n'
        '[Provenance](provenance.json) · [SHA-256 file manifest](files.sha256.json)\n')
    sizes = [path.stat().st_size for path in destination.rglob('*') if path.is_file()]
    if max(sizes) > MAX_FILE or sum(sizes) > MAX_TOTAL:
        raise ValueError('Rendered publication exceeds size limits; use smaller experiments')


def open_results(repository, directory, branch=RESULTS_BRANCH):
    directory.mkdir()
    command('git', 'init', '--initial-branch', branch, str(directory))
    git = ('git', '-C', str(directory))
    command(*git, 'config', 'user.name', 'github-actions[bot]')
    command(*git, 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
    command(*git, 'config', 'credential.helper', '!gh auth git-credential')
    command(*git, 'remote', 'add', 'origin', f'https://github.com/{repository}.git')
    probe = subprocess.run([*git, 'ls-remote', '--exit-code', '--heads', 'origin', f'refs/heads/{branch}'],
                           capture_output=True, text=True, check=False)
    if probe.returncode == 0:
        command(*git, 'fetch', '--depth=1', 'origin', f'refs/heads/{branch}')
        command(*git, 'reset', '--hard', 'FETCH_HEAD')
        # Never adopt an arbitrary source-code branch as a results branch.
        marker = directory / '.diagnostic-results'
        if marker.is_symlink() or not marker.is_file() or marker.read_text() != '1\n':
            raise ValueError('Existing results branch is not a diagnostic publication branch')
        if any(path.is_symlink() for path in directory.rglob('*') if '.git' not in path.parts):
            raise ValueError('Results branch contains a symlink')
    elif probe.returncode != 2:
        raise RuntimeError(f'Cannot inspect results branch: {probe.stderr}')
    return git


def install(prepared, results, provenance):
    relative = Path('runs') / provenance['run'] / f'attempt-{provenance["attempt"]}'
    target = results / relative
    if target.exists():
        if (target / 'provenance.json').read_bytes() != (prepared / 'provenance.json').read_bytes():
            raise ValueError('Refusing to overwrite an already published run with different evidence')
        return relative, False
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(prepared, target)
    (results / '.diagnostic-results').write_text('1\n')
    entries = sorted((results / 'runs').glob('*/attempt-*/provenance.json'),
                     key=lambda p: (int(p.parent.parent.name), int(p.parent.name.removeprefix('attempt-'))), reverse=True)
    lines = ['# E2E diagnostic results', '',
             'Published evidence from manually selected diagnostic runs. No tests execute on this branch.', '',
             '| Run | Attempt | Collection | Source commit |', '|---|---|---|---|']
    for entry in entries:
        meta = json.loads(entry.read_text())
        link = entry.parent.relative_to(results).as_posix()
        lines.append(f'| [{meta["run"]}]({link}/) | {meta["attempt"]} | {markdown_text(meta["conclusion"])} | `{meta["sourceCommit"]}` |')
    (results / 'README.md').write_text('\n'.join(lines) + '\n')
    return relative, True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', required=True, type=numeric)
    parser.add_argument('--attempt', default='1', type=numeric)
    args = parser.parse_args()
    repository = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid repository')
    endpoint = f'repos/{repository}/actions/runs/{args.run}'
    run = json.loads(command('gh', 'api', f'{endpoint}/attempts/{args.attempt}'))
    verify_run(run, repository, args.run, args.attempt)
    pages = json.loads(command('gh', 'api', '--paginate', '--slurp', f'{endpoint}/artifacts?per_page=100'))
    name = f'etoe-diagnostics-{args.run}-{args.attempt}'
    artifacts = [a for page in pages for a in page['artifacts'] if a['name'] == name and not a['expired']]
    if len(artifacts) != 1:
        raise ValueError('Expected exactly one unexpired diagnostic artifact for this attempt')
    artifact = artifacts[0]
    if artifact['size_in_bytes'] > MAX_TOTAL:
        raise ValueError('Artifact exceeds the publication download limit')
    with tempfile.TemporaryDirectory(prefix='etoe-publish-') as temporary:
        work = Path(temporary)
        archive = work / 'artifact.zip'
        with archive.open('wb') as output:
            subprocess.run(['gh', 'api', f'repos/{repository}/actions/artifacts/{artifact["id"]}/zip'],
                           stdout=output, check=True)
        archive_hash = digest(archive)
        if artifact.get('digest') and artifact['digest'] != f'sha256:{archive_hash}':
            raise ValueError('Downloaded archive does not match GitHub artifact digest')
        provenance = {'repository': repository, 'run': args.run, 'attempt': args.attempt,
                      'runUrl': f'https://github.com/{repository}/actions/runs/{args.run}/attempts/{args.attempt}',
                      'sourceCommit': run['head_sha'], 'conclusion': run['conclusion'],
                      'artifactId': artifact['id'], 'artifactName': name, 'archiveSha256': archive_hash}
        prepared = work / 'prepared'
        prepare(archive, prepared, provenance)
        results = work / 'results'
        git = open_results(repository, results)
        relative, changed = install(prepared, results, provenance)
        if changed:
            command(*git, 'add', '--all')
            command(*git, 'commit', '-m', f'docs: publish E2E evidence for {args.run} attempt {args.attempt}')
            # Ordinary fast-forward push only. A concurrent outside update fails safely.
            command(*git, 'push', 'origin', f'HEAD:refs/heads/{RESULTS_BRANCH}')
        commit = command(*git, 'rev-parse', 'HEAD')
        url = f'https://github.com/{repository}/tree/{commit}/{relative.as_posix()}'
        print(url)
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
                summary.write(f'## Published diagnostic evidence\n\n[Read run {args.run}, attempt {args.attempt}]({url})\n')


if __name__ == '__main__':
    main()
