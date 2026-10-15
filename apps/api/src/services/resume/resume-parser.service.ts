import { extractText } from 'unpdf';
import mammoth from 'mammoth';

export class UnsupportedFileTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileTypeError';
  }
}

export class TextExtractionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'TextExtractionError';
  }
}

export async function extractResumeText(
  buffer: Buffer,
  fileType: string,
  fileName: string
): Promise<string> {
  const extension = fileName.split('.').pop()?.toLowerCase();

  const isPdf =
    fileType === 'application/pdf' ||
    fileType === 'application/x-pdf' ||
    extension === 'pdf';

  const isDocx =
    fileType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileType === 'application/msword' ||
    extension === 'docx';

  if (isPdf) {
    try {
      const { text } = await extractText(new Uint8Array(buffer));
      return text.join('\n').trim();
    } catch (err) {
      throw new TextExtractionError('Failed to extract text from PDF document', err);
    }
  }

  if (isDocx) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return (result.value || '').trim();
    } catch (err) {
      throw new TextExtractionError('Failed to extract text from DOCX document', err);
    }
  }

  throw new UnsupportedFileTypeError(
    `Unsupported file format: ${fileType} (.${extension || 'unknown'}). Only PDF and DOCX files are allowed.`
  );
}
