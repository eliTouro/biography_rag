// File bytes -> list of {text, page} sections. Supports .txt .md .html .pdf .docx.
import path from 'node:path';
import { htmlToText, stripGutenberg } from './clean.js';

export const SUPPORTED = ['.txt', '.text', '.md', '.markdown', '.html', '.htm', '.xhtml', '.pdf', '.docx'];

export class UnsupportedFileError extends Error {
  constructor(name) { super(`"${name}" isn't a supported file. Use .txt, .md, .html, .pdf or .docx.`); this.status = 415; }
}

export const isSupported = (filename) => SUPPORTED.includes(path.extname(filename || '').toLowerCase());

function decodeText(buf) {
  let s = Buffer.from(buf).toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  // Latin-1 fallback when the bytes weren't valid UTF-8
  if (s.includes('�') && (s.match(/�/g) || []).length > 20) s = Buffer.from(buf).toString('latin1');
  return s;
}

/** @returns {Promise<{kind:string, sections:{text:string, page:number|null}[]}>} */
export async function extractSections(buf, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!isSupported(filename)) throw new UnsupportedFileError(filename);
  if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    return { kind: 'pdf', sections: pages.map((t, i) => ({ text: t, page: i + 1 })) };
  }
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
    return { kind: 'docx', sections: [{ text: value, page: null }] };
  }
  const raw = decodeText(buf);
  if (['.html', '.htm', '.xhtml'].includes(ext)) return { kind: 'html', sections: [{ text: stripGutenberg(htmlToText(raw)), page: null }] };
  return { kind: 'text', sections: [{ text: stripGutenberg(raw), page: null }] };
}
