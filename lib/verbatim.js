const TOKEN_PREFIX = '[[VERBATIM_';

function token(index) {
  return `${TOKEN_PREFIX}${String(index).padStart(4, '0')}]]`;
}

export function protectVerbatimSections(text, tokenOffset = 0) {
  const replacements = [];
  const lines = text.split('\n');
  let section = null;

  const protect = (value) => {
    const marker = token(tokenOffset + replacements.length);
    replacements.push(value);
    return marker;
  };

  const protectUrls = (value) => value.replace(/https?:\/\/[^\s<>"')\]]+/gi, (url) => {
    const trailing = url.match(/[.,;:!?]+$/)?.[0] || '';
    const cleanUrl = trailing ? url.slice(0, -trailing.length) : url;
    return `${protect(cleanUrl)}${trailing}`;
  });

  const protectedLines = lines.map((line) => {
    const trimmed = line.trim();

    if (/^(hooks?|хуки?)\s*:?[\s]*$/i.test(trimmed)) {
      section = 'hooks';
      return line;
    }
    if (/^(voiceover\s+script|voice\s*over|script|скрипт(?:\s+для\s+озвучки)?)\s*:?[\s]*$/i.test(trimmed)) {
      section = 'script';
      return line;
    }
    if (/^(?:\[?visuals?\b|deliverables?|references?|notes?|cta|візуал(?:и)?|результати|референси|примітки)/i.test(trimmed)) {
      section = null;
      return protectUrls(line);
    }

    // PDF page separators are not section boundaries.
    if (/^(?:-{1,2}\s*)?\d+\s+of\s+\d+(?:\s*-{1,2})?$/i.test(trimmed)) return line;
    if (!trimmed || !section) return protectUrls(line);

    if (section === 'hooks') {
      const labelledHook = line.match(/^(\s*(?:hook|хук)\s*\d*\s*[:\-]\s*)(.+)$/i);
      if (labelledHook) return `${labelledHook[1]}${protect(labelledHook[2])}`;
      const bullet = line.match(/^(\s*(?:[-*•]|\d+[.)])\s*)(.+)$/);
      if (bullet) return `${bullet[1]}${protect(bullet[2])}`;
    }

    return protect(line);
  });

  return { text: protectedLines.join('\n'), replacements };
}

export function addIncognitoFlags(text) {
  const warning = '**⚠️ Відкривати тільки в режимі інкогніто:**';
  const lines = text.split('\n');
  const output = [];
  for (const line of lines) {
    const urlIndex = line.search(/https?:\/\//i);
    if (urlIndex !== -1 && output[output.length - 1] !== warning) {
      const prefix = line.slice(0, urlIndex).trimEnd();
      if (prefix) output.push(prefix);
      output.push(warning);
      output.push(line.slice(urlIndex));
      continue;
    }
    output.push(line);
  }
  return output.join('\n');
}

export function restoreVerbatimSections(text, replacements = []) {
  let restored = text;
  replacements.forEach((value, index) => {
    restored = restored.split(token(index)).join(value);
  });
  return restored;
}
