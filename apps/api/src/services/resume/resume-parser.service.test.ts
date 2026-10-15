import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractResumeText,
  UnsupportedFileTypeError,
  TextExtractionError,
} from './resume-parser.service.js';

describe('ResumeParserService', () => {
  const minimalValidPdf = Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n' +
      '4 0 obj << /Length 44 >> stream\n' +
      'BT\n' +
      '/F1 12 Tf\n' +
      '72 712 Td\n' +
      '(John Doe - Software Engineer) Tj\n' +
      'ET\n' +
      'endstream endobj\n' +
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n' +
      'xref\n' +
      '0 6\n' +
      '0000000009 00000 n \n' +
      '0000000058 00000 n \n' +
      '0000000115 00000 n \n' +
      '0000000266 00000 n \n' +
      '0000000359 00000 n \n' +
      'trailer << /Size 6 /Root 1 0 R >>\n' +
      'startxref\n' +
      '434\n' +
      '%%EOF'
  );

  test('extracts text from valid PDF buffer', async () => {
    const text = await extractResumeText(minimalValidPdf, 'application/pdf', 'sample.pdf');
    assert.match(text, /John Doe - Software Engineer/);
  });

  test('rejects unsupported file extensions (e.g. .exe, .zip)', async () => {
    const fakeExe = Buffer.from('MZ binary executable fake header');
    await assert.rejects(
      async () => {
        await extractResumeText(fakeExe, 'application/x-msdownload', 'malware.exe');
      },
      (err: Error) => {
        assert(err instanceof UnsupportedFileTypeError);
        assert.match(err.message, /Unsupported file format/);
        return true;
      }
    );
  });

  test('rejects image files (.png, .jpg)', async () => {
    const fakeImage = Buffer.from('fake image content');
    await assert.rejects(
      async () => {
        await extractResumeText(fakeImage, 'image/png', 'photo.png');
      },
      (err: Error) => {
        assert(err instanceof UnsupportedFileTypeError);
        return true;
      }
    );
  });

  test('throws TextExtractionError on corrupted document buffer', async () => {
    const corruptedDocx = Buffer.from('not a zip or docx content');
    await assert.rejects(
      async () => {
        await extractResumeText(
          corruptedDocx,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'resume.docx'
        );
      },
      (err: Error) => {
        assert(err instanceof TextExtractionError);
        return true;
      }
    );
  });
});
