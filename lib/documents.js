const MAX_EXTRACTED_CHARS = 100_000;

export async function extractDocumentText(buffer, fileName = '', mimeType = '') {
  const lowerName = fileName.toLowerCase();
  let text;

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    // Load document parsers only when they are actually needed. Besides making
    // normal Telegram updates cheaper, this keeps optional PDF runtime code out
    // of the webhook's cold-start path on Vercel.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || lowerName.endsWith('.docx')
  ) {
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (
    mimeType.startsWith('text/')
    || ['.txt', '.md', '.csv'].some((extension) => lowerName.endsWith(extension))
  ) {
    text = buffer.toString('utf8');
  } else {
    throw new Error('UNSUPPORTED_DOCUMENT');
  }

  const normalized = (text || '').trim();
  if (!normalized) throw new Error('EMPTY_DOCUMENT');
  return normalized.slice(0, MAX_EXTRACTED_CHARS);
}
