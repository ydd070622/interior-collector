// Self-contained: Chrome serializes this function into each accessible frame.
export function scanPage() {
  const results = new Map();
  const reject = /(?:^|[\/_.-])(favicon|logo|avatar|sprite|icon|emoji|badge)(?:[\/_.-]|$)/i;
  function add(raw, el, width = 0, height = 0) {
    if (!raw) return;
    let url;
    try { url = new URL(raw, document.baseURI).href; } catch { return; }
    if (!/^(https?:|data:image\/(?!svg)|blob:)/i.test(url) || /\.svg(?:[?#]|$)|image\/svg/i.test(url) || reject.test(url)) return;
    if (width && height && (Math.min(width, height) < 180 || Math.max(width, height) / Math.min(width, height) > 4)) return;
    const label = `${el.getAttribute('alt') || ''} ${el.getAttribute('title') || ''}`.trim().slice(0, 200);
    if (/^(logo|icon|avatar|图标|头像|标志)$/i.test(label)) return;
    if (!results.has(url)) results.set(url, {url, label, width, height, page: location.href});
  }
  function visit(root) {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'IMG') {
        const lazy = el.getAttribute('data-original') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src');
        const srcset = el.getAttribute('data-srcset') || el.getAttribute('srcset');
        const largest = srcset?.split(',').map(s => s.trim().split(/\s+/)).sort((a,b) => parseFloat(b[1] || '0') - parseFloat(a[1] || '0'))[0]?.[0];
        const url = lazy || largest || el.currentSrc || el.src;
        add(url, el, lazy || largest ? 0 : el.naturalWidth, lazy || largest ? 0 : el.naturalHeight);
      }
      const bg = getComputedStyle(el).backgroundImage;
      for (const match of bg.matchAll(/url\(["']?(.*?)["']?\)/g)) add(match[1], el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  }
  visit(document);
  return {title: document.title, page: location.href, images: [...results.values()]};
}
