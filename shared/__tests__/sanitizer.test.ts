// The sanitizer is the one boundary every piece of corpus HTML crosses before
// {@html} / set:html — LSJ entries, footnotes, endnotes, figures. These pin the
// contract other code relies on (what survives, what never does) and the
// bypasses found on 2026-09-07.
import { describe, expect, it } from 'vitest';
import { renderLsjEntry, sanitizeHtml } from '../lib/html';

describe('sanitizeHtml allowlist', () => {
  it.each([
    'a', 'b', 'br', 'div', 'em', 'i', 'li', 'ol', 'p', 'span', 'strong', 'sub', 'sup', 'ul',
    // No svg/figure here: those are Aristotle's diagram tags (SVG_TAGS in its
    // own html.ts). This reader has no figures, and the allowlist is smaller
    // for it. The security contract below is what ports.
  ])('keeps <%s>', (tag) => {
    const out = sanitizeHtml(`<${tag}>x</${tag}>`);
    expect(out).toContain(`<${tag}>`);
    if (tag !== 'br') expect(out).toContain(`</${tag}>`);
  });

  it.each([
    'script', 'style', 'iframe', 'object', 'embed', 'img', 'base', 'meta', 'link', 'form',
    'input', 'button', 'foreignObject', 'use', 'image', 'animate', 'set', 'textarea', 'title',
    'body', 'html', 'math', 'video', 'audio', 'source', 'template', 'noscript',
  ])('drops <%s> and every attribute on it', (tag) => {
    const out = sanitizeHtml(`<${tag} src="x" onload="alert(1)">x</${tag}>`);
    expect(out.toLowerCase()).not.toContain(`<${tag.toLowerCase()}`);
    expect(out).not.toContain('onload');
    expect(out).not.toContain('src=');
  });

  it('drops event handlers, srcdoc, and style on everything but small-caps spans', () => {
    expect(sanitizeHtml('<a onclick="x" oNmouseover=y ONLOAD=z href="/ok">z</a>'))
      .toBe('<a href="/ok">z</a>');
    expect(sanitizeHtml('<span style="background:url(x)">x</span>')).toBe('<span>x</span>');
    expect(sanitizeHtml('<div style="font-variant: small-caps">x</div>')).toBe('<div>x</div>');
    expect(sanitizeHtml('<span style="font-variant: small-caps">x</span>'))
      .toBe('<span style="font-variant: small-caps">x</span>');
    expect(sanitizeHtml('<div srcdoc="<script>x</script>" data-x="1" id="a">x</div>'))
      .toBe('<div>x</div>');
  });

  it('removes script/style blocks with their content, in any case and spacing', () => {
    expect(sanitizeHtml('<div><script>alert(1)</script></div>')).toBe('<div></div>');
    expect(sanitizeHtml('<SCRIPT type="x">alert(1)</Script >')).toBe('');
    expect(sanitizeHtml('<style>.x{}</style>a')).toBe('a');
    // A block whose end tag never comes: the tag goes, the text is only text.
    expect(sanitizeHtml('<div><script>alert(1)</div>')).toBe('<div>alert(1)</div>');
    // A stray end tag in prose is dropped, not left to close anything.
    expect(sanitizeHtml('a </script> b')).toBe('a  b');
    // A comment cannot be used to assemble a tag name.
    expect(sanitizeHtml('<scr<!-- -->ipt>alert(1)</script>')).toBe('');
  });

  it('keeps only the attributes the readers use, validated', () => {
    expect(sanitizeHtml('<div class="lsj-sense" data-level="2" data-depth="1">x</div>'))
      .toBe('<div class="lsj-sense" data-level="2">x</div>');
    expect(sanitizeHtml('<div data-level="123">x</div>')).toBe('<div>x</div>');
    expect(sanitizeHtml('<span class="a\'b">x</span>')).toBe('<span>x</span>');
    expect(sanitizeHtml('<span href="/x">x</span>')).toBe('<span>x</span>');
    expect(sanitizeHtml('<span title="t" aria-label="l">x</span>'))
      .toBe('<span title="t" aria-label="l">x</span>');
    // SVG presentation attributes: geometry and keywords, never a URL.
    // <path> is Aristotle-only; the attribute contract that matters here is
    // that an unknown attribute is dropped and a known one survives.
    expect(sanitizeHtml('<a href="/x" title="t" onclick="alert(1)">y</a>'))
      .toBe('<a href="/x" title="t">y</a>');
    expect(sanitizeHtml('<div viewBox="0 0 1 1">x</div>')).toBe('<div>x</div>');
  });
});

describe('sanitizeHtml hrefs', () => {
  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '  data:text/html,x',
    'vbscript:msgbox(1)',
    // Entity-spelled: the browser decodes it, so the check has to as well.
    '&#106;avascript:alert(1)',
    '&#x6A;avascript:alert(1)',
    'jav&#x09;ascript:alert(1)',
    'java&#10;script:alert(1)',
  ])('drops href=%j', (href) => {
    expect(sanitizeHtml(`<a href="${href}">x</a>`)).toBe('<a>x</a>');
    expect(sanitizeHtml(`<a href='${href}'>x</a>`)).toBe('<a>x</a>');
  });

  it.each([
    '/Rep/book/1?loc=327a:1',
    'https://example.org/x',
    '//example.org/x',
    '#lsj-sense-a',
    'mailto:a@b.c',
  ])('keeps href=%j', (href) => {
    expect(sanitizeHtml(`<a href="${href}">x</a>`)).toBe(`<a href="${href}">x</a>`);
  });

  it('does not escape entities twice on the way through', () => {
    // title="Smith &amp; Jones" used to reach the browser as "&amp;amp;" and
    // show the entity itself; an href with a query string likewise.
    expect(sanitizeHtml('<a href="/EN?a=1&amp;b=2" title="Smith &amp; Jones">x</a>'))
      .toBe('<a href="/EN?a=1&amp;b=2" title="Smith &amp; Jones">x</a>');
    expect(sanitizeHtml('<span title="&quot;q&quot; &lt;3">x</span>'))
      .toBe('<span title="&quot;q&quot; &lt;3">x</span>');
    // A decoded value is escaped again, so it cannot break out of the quotes.
    expect(sanitizeHtml('<span title="&quot; onclick=&quot;alert(1)">x</span>'))
      .toBe('<span title="&quot; onclick=&quot;alert(1)">x</span>');
    // An entity this does not decode stays literal — and is still re-escaped.
    expect(sanitizeHtml('<a href="java&Tab;script:x">x</a>'))
      .toBe('<a href="java&amp;Tab;script:x">x</a>');
  });
});

describe('sanitizeHtml on malformed markup', () => {
  it('escapes an unterminated tag rather than passing it through', () => {
    // The tag pass cannot match a tag with no ">", and the raw text used to
    // fall through verbatim. renderLsjEntry appends "</div>" to the sanitized
    // string, so `<a href=x onclick=alert(1)` + `</div>` closed itself into
    // <a href="x" onclick="alert(1)</div">: a live handler through the
    // sanitizer. set:html on the site splices the output into page markup the
    // same way.
    expect(sanitizeHtml('<a href="x" onclick=alert(1)')).toBe('&lt;a href="x" onclick=alert(1)');
    expect(sanitizeHtml('text <b onclick=alert(1)')).toBe('text &lt;b onclick=alert(1)');
    const rendered = renderLsjEntry('<b class="lsj-head">x</b><a href="x" onclick=alert(1)');
    expect(rendered).not.toMatch(/<a[^>]*onclick/);
    expect(rendered).toContain('&lt;a href="x" onclick=alert(1)</div>');
  });

  it('reads "<" the way the browser does: a tag only when a letter follows at once', () => {
    // "< b and c >" is prose; it used to become a <b> element that ate the
    // words between the brackets.
    expect(sanitizeHtml('a < b and c > d')).toBe('a &lt; b and c > d');
    expect(sanitizeHtml('1 <2 and 3> 4')).toBe('1 &lt;2 and 3> 4');
    expect(sanitizeHtml('< a href="/x">y</a>')).toBe('&lt; a href="/x">y</a>');
  });

  it('never leaves a bogus-comment opener that would hide what follows', () => {
    // "<?" and "<!" open a bogus comment in the browser that swallows
    // everything to the next ">", the sanitizer's own tags included.
    expect(sanitizeHtml('<?php <b>bold</b>')).toBe('&lt;?php <b>bold</b>');
    expect(sanitizeHtml('<!-<b>-hidden-->visible')).toBe('&lt;!-<b>-hidden-->visible');
    expect(sanitizeHtml('<![CDATA[<b>x</b>]]>')).toBe('&lt;![CDATA[<b>x</b>]]>');
  });

  it('cannot be desynchronized by a ">" inside an attribute value', () => {
    const out = sanitizeHtml('<a title="x>y" href="javascript:alert(1)">z</a>');
    // The tag ends at the first ">", so the rest is prose — never an href.
    expect(out).not.toMatch(/<a[^>]*href/);
    expect(out.startsWith('<a title="">')).toBe(true);
    // Whatever is left is text: no "<" survives unescaped outside a tag.
    expect(out.replace(/<\/?[a-z][^>]*>/g, '')).not.toContain('<');
  });

  it('serialises only tags it built: no "<" survives in text', () => {
    const nasty = [
      '<a href="x"<b onclick=x>y', '<b/onclick=alert(1)>x', '<a href="x"',
      '<svg><foreignObject><body onload=alert(1)>', '<<b>>', '<', 'x<', '<1', '</>',
      '</ b>', '<a <b> c>', '&lt;script&gt;',
    ];
    for (const html of nasty) {
      const out = sanitizeHtml(html);
      const text = out.replace(/<\/?[a-z][\w:-]*(?: [^>]*)?>/g, '');
      expect(text, html).not.toContain('<');
      expect(out, html).not.toMatch(/\son[a-z]+\s*=/i);
    }
  });

  it('does not balance tags, and the fragment parser contains that', () => {
    // Unclosed and stray closers pass through as they are. On the popup path
    // ({@html}) the fragment parser auto-closes at the end of the container
    // and ignores an end tag with no open element, so neither can escape the
    // mount. Pinned so a future balancing pass is a deliberate change.
    expect(sanitizeHtml('<div class="lsj-sense" data-level="1">open'))
      .toBe('<div class="lsj-sense" data-level="1">open');
    expect(sanitizeHtml('</div></div>stray')).toBe('</div></div>stray');
    const host = document.createElement('div');
    host.innerHTML = sanitizeHtml('</div><b>x') + '<i>after</i>';
    // The unclosed <b> takes what follows INSIDE the mount; nothing is lost
    // and nothing leaves the host.
    expect(host.querySelector('b i')!.textContent).toBe('after');
    expect(host.textContent).toBe('xafter');
    expect(host.parentElement).toBeNull();
  });
});

// A C1 control (0x80-0x9F) inside a scheme. The narrower control class this
// sanitizer used to carry stopped at DEL, so "java\u0085script:" reached the
// href unchanged where the origin refuses it. Not a confirmed execution bypass
// - no browser resolves that as a scheme - but the check should say what it
// means, and the three copies of this file should agree.
describe('safeHref control characters', () => {
  it('strips C1 controls before matching the scheme', () => {
    expect(sanitizeHtml('<a href="java\u0085script:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="java\u009Fscript:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  it('still strips C0 controls and whitespace, as before', () => {
    expect(sanitizeHtml('<a href="java\tscript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="  javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  it('leaves an ordinary href alone', () => {
    expect(sanitizeHtml('<a href="/Rep/book/1">x</a>')).toBe('<a href="/Rep/book/1">x</a>');
  });
});
