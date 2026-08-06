import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const MAX_EXTRACTED_CHARS = 100_000;

export async function extractDocumentText(buffer, fileName = '', mimeType = '') {
  const lowerName = fileName.toLowerCase();
  let text;

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
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
