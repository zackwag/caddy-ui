import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { absoluteLinks, parseBlocks, renderPage } from './dockerhub-docs.mjs';

const start = '<!-- dockerhub:both:start -->';
const end = '<!-- dockerhub:both:end -->';
const wrap = content => `${start}\n${content}\n${end}`;

function selected(content) {
    return parseBlocks(wrap(content)).backend[0];
}

test('inline comment delimiters remain code, including on unselected lines', () => {
    const content = 'Use `<!--` to open a comment and `-->` to close it.';
    assert.equal(selected(content), content);
    assert.equal(parseBlocks(`Outside: \`<!--\`\n\n${wrap('inside')}`).backend[0], 'inside');
});

test('routing markers inside multiline inline code remain literal', () => {
    const content = `\`example\n${end}\n${start}\nexample\``;
    assert.equal(selected(content), content);
});

test('inline code closes only on the same backtick-run length', () => {
    const content = `\`\`example \`\n${end}\nexample\`\``;
    assert.equal(selected(content), content);
});

test('unmatched or escaped backticks do not hide real markers', () => {
    assert.equal(parseBlocks(`Unmatched: \`\n${wrap('inside')}`).backend[0], 'inside');
    assert.equal(parseBlocks(`Escaped: \\` + '`' + `\n${wrap('inside')}`).backend[0], 'inside');
});

test('inline spans end at paragraph boundaries when no closing run exists', () => {
    assert.equal(parseBlocks(`Unmatched: \`\n\n${wrap('inside')}\n\nLater: \`text\``).backend[0], 'inside');
});

test('surrounding blank lines are removed without removing code indentation', () => {
    assert.equal(selected('\n    code\n        nested\n\n'), '    code\n        nested');
    assert.equal(selected('\tcode\n'), '\tcode');
});

for (const tag of ['pre', 'code', 'script', 'style', 'textarea']) {
    test(`markers in HTML ${tag} regions remain literal`, () => {
        const content = `<${tag} class="example">\n${end}\n${start}\n</${tag}>`;
        assert.equal(selected(content), content);
    });
}

test('HTML code tags are case-insensitive and can close on the same line', () => {
    const content = '<PRE>literal text</PRE> ordinary';
    assert.equal(selected(content), content);
});

test('an unclosed HTML code region blocks generation', () => {
    assert.throws(() => parseBlocks(wrap('<pre>example')), /Unclosed HTML pre code region/);
});

for (const fence of ['```', '~~~', '````']) {
    test(`${fence} fenced marker examples remain literal`, () => {
        const content = `${fence}\n${end}\n${fence}`;
        assert.equal(selected(content), content);
    });
}

test('ordinary HTML comment examples remain literal', () => {
    const content = `<!-- Example:\n${start}\n-->\ntext`;
    assert.equal(selected(content), content);
});

for (const [name, content, diagnostic] of [
    ['unclosed block', `${start}\ntext`, /Unclosed both routing block/],
    ['nested block', `${start}\ntext\n${start}\n${end}`, /Cannot open both/],
    ['overlapping block', `${start}\ntext\n<!-- dockerhub:frontend:start -->\n${end}`, /Cannot open frontend/],
    ['wrong end', `${start}\ntext\n<!-- dockerhub:frontend:end -->`, /End marker is frontend/],
    ['stray end', end, /Unexpected both end marker/],
    ['destination typo', `${wrap('text')}\n<!-- dockerhub:backed:start -->`, /malformed Docker Hub marker/],
    ['namespace typo', `${wrap('text')}\n<!-- dockerhbu:both:start -->`, /malformed Docker Hub marker/],
    ['empty block', wrap(' \n\t'), /Routing block is empty/],
]) {
    test(`${name} is still rejected`, () => {
        assert.throws(() => parseBlocks(content), diagnostic);
    });
}

test('anchor conversion skips inline, fenced, HTML code and comment examples', () => {
    const content = [
        '[outside](#outside)',
        '`[inline](#inline)`',
        '`multiline',
        '[span](#span)',
        'span` [after](#after)',
        '```',
        '[fenced](#fenced)',
        '```',
        '<pre>',
        '[html](#html)',
        '</pre>',
        '<!--',
        '[comment](#comment)',
        '-->',
        '    [indented](#indented)',
    ].join('\n');
    const expected = content
        .replace('](#outside)', '](https://github.com/zackwag/caddy-ui#outside)')
        .replace('](#after)', '](https://github.com/zackwag/caddy-ui#after)');
    assert.equal(absoluteLinks(content), expected);
});

test('escaped backticks do not suppress normal link conversion', () => {
    assert.equal(
        absoluteLinks('\\` [normal](#normal)'),
        '\\` [normal](https://github.com/zackwag/caddy-ui#normal)',
    );
});

for (const comment of [
    '<!-- [literal](#literal) -->',
    '<!-- [literal](#literal) --!>',
    '<!-->',
    '<!--->',
]) {
    test(`HTML comment ending is handled by the parser: ${comment}`, () => {
        const content = `${comment} [outside](#outside)`;
        assert.equal(selected(content), content);
        assert.equal(absoluteLinks(content), `${comment} [outside](https://github.com/zackwag/caddy-ui#outside)`);
    });
}

for (const name of ['pre-widget', 'code-example', 'script-widget', 'style-note', 'textarea-helper']) {
    test(`${name} is not mistaken for a code element`, () => {
        const content = `<${name}>[outside](#outside)</${name}>`;
        assert.equal(selected(content), content);
        assert.equal(absoluteLinks(content), `<${name}>[outside](https://github.com/zackwag/caddy-ui#outside)</${name}>`);
    });
}

for (const content of [
    '<div title="<pre>">[outside](#outside)</div>',
    "<div title='<script>'>[outside](#outside)</div>",
    '<div title="[attribute](#attribute) > <code>">[outside](#outside)</div>',
    '<pre title="></pre> [attribute](#attribute)">[literal](#literal)</pre> [outside](#outside)',
    "<code title='></code> [attribute](#attribute)'>[literal](#literal)</code> [outside](#outside)",
    `<div title="multiline\n${end}\n<pre> [attribute](#attribute)">[outside](#outside)</div>`,
    `<pre title="multiline\n${end}\n></pre>">[literal](#literal)</pre> [outside](#outside)`,
]) {
    test(`quoted HTML attributes preserve their exact source: ${content}`, () => {
        assert.equal(selected(content), content);
        assert.equal(absoluteLinks(content), content.replace('](#outside)', '](https://github.com/zackwag/caddy-ui#outside)'));
    });
}

for (const tag of ['pre', 'code', 'script', 'style', 'textarea']) {
    test(`${tag} end tags with ignored attributes close the protected region`, () => {
        const content = `<${tag}>[literal](#literal)</${tag} ignored="value"> [outside](#outside)`;
        assert.equal(selected(content), content);
        assert.equal(absoluteLinks(content), content.replace('](#outside)', '](https://github.com/zackwag/caddy-ui#outside)'));
    });
}

for (const tag of ['pre', 'code']) {
    test(`nested ${tag} elements do not end protection at the inner closing tag`, () => {
        const content = `<${tag}><${tag}>inner</${tag}>\n${end}\n[literal](#literal)</${tag}> [outside](#outside)`;
        assert.equal(selected(content), content);
        assert.equal(absoluteLinks(content), content.replace('](#outside)', '](https://github.com/zackwag/caddy-ui#outside)'));
    });
}

test('script text is parsed in its HTML raw-text context', () => {
    const content = `<script>const example = '<pre><!--';\n${end}\n[literal](#literal)</script> [outside](#outside)`;
    assert.equal(selected(content), content);
    assert.equal(absoluteLinks(content), content.replace('](#outside)', '](https://github.com/zackwag/caddy-ui#outside)'));
});

test('comments inside pre elements hide closing-tag and routing examples', () => {
    const content = `<pre><!-- </pre>\n${end}\n--!> [literal](#literal)</pre> [outside](#outside)`;
    assert.equal(selected(content), content);
    assert.equal(absoluteLinks(content), content.replace('](#outside)', '](https://github.com/zackwag/caddy-ui#outside)'));
});

test('unterminated HTML comments still block generation', () => {
    assert.throws(() => parseBlocks(`${start}\n<!-- unfinished`), /Unclosed HTML comment/);
    assert.throws(() => parseBlocks(wrap('<PRE>literal <!-- text</PRE> ordinary')), /Unclosed HTML pre code region/);
});

test('HTML offsets preserve CRLF, Unicode and trailing whitespace during link conversion', () => {
    const content = '<pre title="ä😀 >">\r\n[literal](#literal)\r\n</pre>  [outside](#outside)  \r\n';
    assert.equal(absoluteLinks(content), content.replace('](#outside)', '](https://github.com/zackwag/caddy-ui#outside)'));
});

test('whole-page size validation counts UTF-8 bytes', () => {
    const empty = renderPage('backend', [''], '1.0.0').bytes;
    assert.equal(renderPage('backend', ['x'.repeat(25000 - empty)], '1.0.0').bytes, 25000);
    assert.throws(() => renderPage('backend', ['x'.repeat(25001 - empty)], '1.0.0'), /maximum is 25000/);
    assert.throws(() => renderPage('backend', ['ä'.repeat(13000)], '1.0.0'), /maximum is 25000/);
});

test('the canonical README retains image routing and section order', async () => {
    const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
    const blocks = parseBlocks(readme);
    for (const image of ['backend', 'frontend']) {
        const { page } = renderPage(image, blocks[image], '2.19.0');
        assert.equal((page.match(new RegExp(`> This is the \\*\\*${image}\\*\\* image\\.`, 'g')) || []).length, 1);
        assert.ok(page.indexOf('## Features') < page.indexOf('## Quick Start'));
        assert.ok(page.indexOf('## Quick Start') < page.indexOf('## Architecture'));
        assert.ok(page.includes(image === 'backend' ? '## Environment Variables' : '## Custom Nginx Config'));
    }
});
