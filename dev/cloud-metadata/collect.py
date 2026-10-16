"""Inspect pinned cloud-init source; never execute it or contact metadata services."""
import argparse
import ast
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit

UPSTREAM = 'https://github.com/canonical/cloud-init.git'
VERSION = 1


def git(repo, *args):
    return subprocess.run(
        ['git', '-C', str(repo), *args], check=True, capture_output=True,
        text=True, timeout=60,
    ).stdout


def endpoint(value):
    """Return a static authority, allowing templates only after the authority."""
    if not value.startswith(('http://', 'https://')):
        return None
    authority = value.split('://', 1)[1].split('/', 1)[0]
    if not authority or any(char in authority for char in '{}%'):
        return None
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        if not host or parsed.username is not None or parsed.password is not None:
            return None
        parsed.port  # Validate malformed port literals too.
        try:
            return str(ipaddress.ip_address(host))
        except ValueError:
            return host.lower().rstrip('.')
    except ValueError:
        return None


def extract(source, path, revision):
    tree = ast.parse(source, filename=path)
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    observations = []
    unresolved = []
    for node in ast.walk(tree):
        # F-strings have literal fragments, which are not complete URLs.
        if isinstance(node, ast.JoinedStr):
            expression = ast.get_source_segment(source, node) or ''
            if re.match(r"[fF][\"']{1,3}https?://", expression):
                unresolved.append({'path': path, 'line': node.lineno, 'expression': expression})
            continue
        if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
            continue
        parent = parents.get(node)
        if isinstance(parent, (ast.Expr, ast.JoinedStr)):
            continue  # Docstring or f-string fragment.
        value = node.value
        if not value.startswith(('http://', 'https://')):
            continue
        host = endpoint(value)
        if host is None:
            unresolved.append({'path': path, 'line': node.lineno, 'expression': value})
            continue
        # Keep IP literals and metadata hostnames. Other URLs are reported for
        # manual review rather than silently treated as metadata destinations.
        try:
            ipaddress.ip_address(host)
            candidate = True
        except ValueError:
            candidate = 'metadata' in host.lower()
        if not candidate:
            unresolved.append({'path': path, 'line': node.lineno, 'expression': value})
            continue
        observations.append({
            'host': host, 'url_literal': value, 'path': path, 'line': node.lineno,
            'source': f'https://github.com/canonical/cloud-init/blob/{revision}/{path}#L{node.lineno}',
        })
    return observations, unresolved


def collect(repo, revision, reference):
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('--ref must be a full lowercase 40-character commit SHA')
    origin = git(repo, 'remote', 'get-url', 'origin').strip().removesuffix('.git').rstrip('/')
    if origin not in ('https://github.com/canonical/cloud-init', 'git@github.com:canonical/cloud-init'):
        raise ValueError('Checkout origin must be canonical/cloud-init on GitHub')
    if git(repo, 'rev-parse', f'{revision}^{{commit}}').strip() != revision:
        raise ValueError('Requested revision is not a commit')
    paths = sorted(path for path in git(repo, 'ls-tree', '-r', '--name-only', revision, 'cloudinit/sources').splitlines() if path.endswith('.py'))
    if not paths:
        raise ValueError('No cloud-init datasource Python files found')
    grouped = {}
    manual = []
    files = []
    for path in paths:
        source = git(repo, 'show', f'{revision}:{path}')
        files.append({'path': path, 'sha256': hashlib.sha256(source.encode()).hexdigest()})
        observations, unresolved = extract(source, path, revision)
        manual.extend(unresolved)
        for observation in observations:
            host = observation.pop('host')
            grouped.setdefault(host, []).append(observation)
    if not grouped:
        raise ValueError('No candidates found; inspect upstream layout before replacing reports')
    entries = reference['endpoints']
    for entry in entries:
        if endpoint(entry['url']) != entry['host']:
            raise ValueError(f"Invalid reference URL/host: {entry['url']}")
        if not entry['documentation'].startswith('https://'):
            raise ValueError('Reference documentation must use HTTPS')
    known = {entry['host'] for entry in entries}
    return {
        'schema_version': VERSION,
        'upstream': UPSTREAM,
        'revision': revision,
        'comparison': 'Exact normalized host presence, not provider coverage or runtime policy',
        'reference': reference,
        'files': files,
        'candidates': [
            {'host': host, 'in_reference': host in known,
             'observations': sorted(grouped[host], key=lambda row: (row['path'], row['line']))}
            for host in sorted(grouped)
        ],
        'reference_only': [entry for entry in entries if entry['host'] not in grouped],
        'manual_review': sorted(manual, key=lambda row: (row['path'], row['line'])),
    }


def markdown(report):
    revision = report['revision']
    lines = [
        '# Cloud metadata endpoint comparison', '',
        'This is development reference data, not a webhook denylist. No metadata endpoint was contacted.', '',
        f"Source: [Canonical cloud-init `{revision[:12]}`](https://github.com/canonical/cloud-init/tree/{revision}).",
        f"Scanned {len(report['files'])} datasource Python files; found {len(report['candidates'])} unique candidate hosts.", '',
        '## Provider-documented reference', '',
        '| Provider | Host | Literal found in source | Documentation |',
        '| --- | --- | --- | --- |',
    ]
    hosts = {row['host'] for row in report['candidates']}
    for entry in report['reference']['endpoints']:
        present = 'Yes' if entry['host'] in hosts else '**No — retain for review**'
        lines.append(f"| {entry['provider']} | `{entry['host']}` | {present} | [Provider documentation]({entry['documentation']}) |")
    lines.extend(['', 'A shared host match does not establish provider-specific coverage. Missing literals do not invalidate provider documentation.', '',
                  '## Source candidates', '', '| Host | In reference | Source observations |', '| --- | --- | --- |'])
    for candidate in report['candidates']:
        sources = '<br>'.join(f"[{row['path'].removeprefix('cloudinit/sources/')}:{row['line']}]({row['source']})" for row in candidate['observations'])
        lines.append(f"| `{candidate['host']}` | {'Yes' if candidate['in_reference'] else 'No — verify with provider'} | {sources} |")
    lines.extend(['', '## Manual review', '',
                  'Dynamic authorities, scoped IPv6 and other hostname URLs are listed below. Some are documentation or local transport URLs, not metadata endpoints.', '',
                  '| Source | Expression |', '| --- | --- |'])
    for row in report['manual_review']:
        link = f"https://github.com/canonical/cloud-init/blob/{revision}/{row['path']}#L{row['line']}"
        expression = row['expression'].replace('|', '&#124;').replace('`', '&#96;').replace('\n', ' ')
        if len(expression) > 200:
            expression = expression[:197] + '...'
        lines.append(f"| [{row['path'].removeprefix('cloudinit/sources/')}:{row['line']}]({link}) | `{expression}` |")
    lines.extend(['', '## Interpretation', '',
                  '- Verify new candidates against current provider documentation before proposing a runtime policy change.',
                  '- This extraction is incomplete by design: aliases, calculated addresses and endpoints absent from cloud-init need separate research.',
                  '- Comments and docstrings are excluded; source string literals can still be false positives.',
                  '- IPv6 private ranges cannot all be blocked if LAN webhook destinations are intended to work. Review specific known metadata hosts alongside existing address-class checks.',
                  '- Hostname matching alone cannot prevent rebinding or redirects. Delivery still needs address validation and connection pinning.',
                  '', 'See [tool instructions](../README.md) and [machine-readable snapshot](snapshot.json) for exact URL literals, reference details and per-file hashes.', ''])
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref', required=True, help='Full Canonical cloud-init commit SHA')
    parser.add_argument('--checkout', type=Path, help='Existing Canonical git checkout; reads committed blobs, not worktree files')
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / 'results')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.ref):
        parser.error('--ref must be a full lowercase 40-character commit SHA')
    reference = json.loads((Path(__file__).parent / 'reference.json').read_text())
    try:
        if args.checkout:
            report = collect(args.checkout, args.ref, reference)
        else:
            with tempfile.TemporaryDirectory(prefix='cloud-metadata-') as directory:
                git(directory, 'init', '--quiet')
                git(directory, 'remote', 'add', 'origin', UPSTREAM)
                git(directory, 'fetch', '--quiet', '--depth=1', 'origin', args.ref)
                report = collect(directory, args.ref, reference)
        rendered = markdown(report)
        encoded = json.dumps(report, indent=2, ensure_ascii=True) + '\n'
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / 'snapshot.json').write_text(encoded)
        (args.output / 'README.md').write_text(rendered)
    except subprocess.CalledProcessError as error:
        parser.exit(1, f'Collection failed: {error}\n{error.stderr.strip()}\n')
    except (ValueError, OSError, SyntaxError, subprocess.SubprocessError) as error:
        parser.exit(1, f'Collection failed: {error}\n')
    print(f"Wrote {len(report['candidates'])} candidate hosts to {args.output}")


if __name__ == '__main__':
    main()
