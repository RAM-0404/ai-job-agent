import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../db/prisma.js';
import {
  uploadResume,
  getResumes,
  getResumeById,
  getResumeTextById,
  FileTooLargeError,
} from './resume.service.js';
import { UnsupportedFileTypeError } from './resume-parser.service.js';

describe('ResumeService', () => {
  let testProfileId: string;

  const minimalValidPdf = Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n' +
      '4 0 obj << /Length 44 >> stream\n' +
      'BT\n' +
      '/F1 12 Tf\n' +
      '72 712 Td\n' +
      '(Jane Doe - Full Stack Developer) Tj\n' +
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

  before(async () => {
    // Create test user profile
    const profile = await prisma.userProfile.create({
      data: {
        fullName: 'Integration Test User',
        email: `test-${Date.now()}@example.com`,
      },
    });
    testProfileId = profile.id;
  });

  after(async () => {
    // Clean up test profile and associated resumes
    if (testProfileId) {
      await prisma.userProfile.delete({
        where: { id: testProfileId },
      });
    }
  });

  test('rejects files exceeding 10 MB limit', async () => {
    // 10 MB + 1 byte
    const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024);
    await assert.rejects(
      async () => {
        await uploadResume({
          userProfileId: testProfileId,
          originalFileName: 'huge.pdf',
          fileType: 'application/pdf',
          buffer: oversizedBuffer,
        });
      },
      (err: Error) => {
        assert(err instanceof FileTooLargeError);
        assert.match(err.message, /exceeds maximum allowed limit/);
        return true;
      }
    );
  });

  test('rejects unsupported file formats (.zip, .exe)', async () => {
    await assert.rejects(
      async () => {
        await uploadResume({
          userProfileId: testProfileId,
          originalFileName: 'archive.zip',
          fileType: 'application/zip',
          buffer: Buffer.from('PK...fake zip'),
        });
      },
      (err: Error) => {
        assert(err instanceof UnsupportedFileTypeError);
        return true;
      }
    );
  });

  test('uploads first resume with version = 1 and extracts text', async () => {
    const resume = await uploadResume({
      userProfileId: testProfileId,
      originalFileName: 'resume_v1.pdf',
      fileType: 'application/pdf',
      buffer: minimalValidPdf,
    });

    assert.equal(resume.version, 1);
    assert.equal(resume.fileName, 'resume_v1.pdf');
    assert.equal(resume.textExtracted, true);

    const textRecord = await getResumeTextById(resume.id);
    assert.match(textRecord.rawText || '', /Jane Doe - Full Stack Developer/);
  });

  test('increments version to 2 on subsequent upload', async () => {
    const resume = await uploadResume({
      userProfileId: testProfileId,
      originalFileName: 'resume_v2.pdf',
      fileType: 'application/pdf',
      buffer: minimalValidPdf,
    });

    assert.equal(resume.version, 2);
    assert.equal(resume.fileName, 'resume_v2.pdf');

    const history = await getResumes(testProfileId);
    assert.equal(history.resumes.length, 2);
    assert.equal(history.latestResume?.version, 2);
    assert.equal(history.latestResume?.fileName, 'resume_v2.pdf');
  });

  test('retrieves individual resume metadata by id', async () => {
    const history = await getResumes(testProfileId);
    assert.ok(history.latestResume);

    const fetched = await getResumeById(history.latestResume.id);
    assert.equal(fetched.id, history.latestResume.id);
    assert.equal(fetched.fileName, 'resume_v2.pdf');
  });
});
