// Minimal HTML sanitizer to prevent XSS in rendered AI content
// Uses a conservative whitelist approach; disallows script/event handlers/styles

export function sanitizeHtml(input) {
  try {
    if (!input || typeof input !== 'string') return '';

    const allowedTags = new Set(['strong', 'em', 'code', 'a', 'br', 'ul', 'ol', 'li', 'p', 'span']);

    const allowedAttrs = {
      a: new Set(['href', 'target', 'rel'])
    };

    const isSafeUrl = href => {
      try {
        const url = new URL(href, window.location.origin);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    };

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${input}</div>`, 'text/html');
    const root = doc.body.firstChild;

    const sanitizeNode = node => {
      // Text node
      if (node.nodeType === Node.TEXT_NODE) {
        return doc.createTextNode(node.nodeValue || '');
      }

      // Element node
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();

        // If tag not allowed, unwrap children (keep text content)
        if (!allowedTags.has(tag)) {
          const frag = doc.createDocumentFragment();
          node.childNodes.forEach(child => {
            const sanitized = sanitizeNode(child);
            if (sanitized) frag.appendChild(sanitized);
          });
          return frag;
        }

        const el = doc.createElement(tag);

        // Copy only allowed attributes
        const attrAllow = allowedAttrs[tag];
        if (attrAllow) {
          for (const attr of Array.from(node.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value || '';
            if (!attrAllow.has(name)) continue;

            if (tag === 'a' && name === 'href') {
              if (!isSafeUrl(value)) continue; // drop unsafe links
              el.setAttribute('href', value);
              el.setAttribute('target', '_blank');
              el.setAttribute('rel', 'noopener noreferrer nofollow');
              continue;
            }

            // For allowed non-href attributes
            el.setAttribute(name, value);
          }
        }

        // Recursively sanitize children
        node.childNodes.forEach(child => {
          const sanitized = sanitizeNode(child);
          if (sanitized) el.appendChild(sanitized);
        });

        return el;
      }

      // For other node types (comments, etc.), drop
      return null;
    };

    const outputContainer = doc.createElement('div');
    root.childNodes.forEach(child => {
      const sanitized = sanitizeNode(child);
      if (sanitized) outputContainer.appendChild(sanitized);
    });

    return outputContainer.innerHTML;
  } catch {
    // On failure, fail closed with empty string
    return '';
  }
}
