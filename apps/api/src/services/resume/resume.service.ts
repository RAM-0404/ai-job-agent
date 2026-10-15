import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import {
  extractResumeText,
  UnsupportedFileTypeError,
} from './resume-parser.service.js';
import type {
  ResumeResponse,
  ResumeListResponse,
  ResumeTextResponse,
} from '@ai-job-agent/shared';

export class FileTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileTooLargeError';
  }
}

export class ResumeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeNotFoundError';
  }
}

export interface UploadResumeInput {
  userProfileId: string;
  originalFileName: string;
  fileType: string;
  buffer: Buffer;
}

export async function uploadResume(
  input: UploadResumeInput
): Promise<ResumeResponse> {
  const { userProfileId, originalFileName, fileType, buffer } = input;
  const fileSize = buffer.length;

  // 1. Validate file size
  if (fileSize > config.maxResumeSizeBytes) {
    throw new FileTooLargeError(
      `File size (${(fileSize / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of ${config.maxResumeSizeMb} MB`
    );
  }

  // 2. Validate file type and extension
  const extension = (originalFileName.split('.').pop() || '').toLowerCase();
  const allowedExtensions = ['pdf', 'docx'];
  const allowedMimeTypes = [
    'application/pdf',
    'application/x-pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/octet-stream', // Often sent by clients for docx/pdf
  ];

  if (
    !allowedExtensions.includes(extension) ||
    (!allowedMimeTypes.includes(fileType) && fileType !== '')
  ) {
    throw new UnsupportedFileTypeError(
      `File format "${fileType || extension}" is not supported. Only PDF and DOCX files are allowed.`
    );
  }

  // 3. Extract plain text from file
  let rawText: string | null = null;
  try {
    rawText = await extractResumeText(buffer, fileType, originalFileName);
  } catch (extractErr) {
    // If text extraction fails, we still allow saving with empty/null text or rethrow
    if (extractErr instanceof UnsupportedFileTypeError) {
      throw extractErr;
    }
    rawText = null;
  }

  // 4. Determine sequential version
  const latestResume = await prisma.resume.findFirst({
    where: { userProfileId },
    orderBy: { version: 'desc' },
  });
  const version = latestResume ? latestResume.version + 1 : 1;

  // 5. Secure file storage (prevent directory traversal)
  const resolvedUploadDir = path.resolve(config.uploadDir);
  await fs.mkdir(resolvedUploadDir, { recursive: true });

  const sanitizedBasename = path
    .basename(originalFileName)
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedFileName = `${crypto.randomUUID()}-${sanitizedBasename}`;
  const storedFilePath = path.join(resolvedUploadDir, storedFileName);

  // Security check: ensure path stays strictly inside upload directory
  if (!storedFilePath.startsWith(resolvedUploadDir)) {
    throw new Error('Invalid file path resolution detected.');
  }

  await fs.writeFile(storedFilePath, buffer);

  // 6. Save resume record to PostgreSQL via Prisma
  const record = await prisma.resume.create({
    data: {
      userProfileId,
      fileName: originalFileName,
      filePath: storedFilePath,
      fileType: extension === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize,
      rawText,
      version,
    },
  });

  return {
    id: record.id,
    fileName: record.fileName,
    version: record.version,
    fileType: record.fileType,
    fileSize: record.fileSize,
    textExtracted: Boolean(record.rawText && record.rawText.length > 0),
    createdAt: record.createdAt.toISOString(),
  };
}

export async function getResumes(
  userProfileId: string
): Promise<ResumeListResponse> {
  const records = await prisma.resume.findMany({
    where: { userProfileId },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      fileName: true,
      version: true,
      fileType: true,
      fileSize: true,
      rawText: true,
      createdAt: true,
    },
  });

  const resumes: ResumeResponse[] = records.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    version: r.version,
    fileType: r.fileType,
    fileSize: r.fileSize,
    textExtracted: Boolean(r.rawText && r.rawText.length > 0),
    createdAt: r.createdAt.toISOString(),
  }));

  const latestResume = resumes.length > 0 ? resumes[0] : null;

  return {
    resumes,
    latestResume,
  };
}

export async function getResumeById(id: string): Promise<ResumeResponse> {
  const record = await prisma.resume.findUnique({
    where: { id },
  });

  if (!record) {
    throw new ResumeNotFoundError(`Resume with ID ${id} not found`);
  }

  return {
    id: record.id,
    fileName: record.fileName,
    version: record.version,
    fileType: record.fileType,
    fileSize: record.fileSize,
    textExtracted: Boolean(record.rawText && record.rawText.length > 0),
    createdAt: record.createdAt.toISOString(),
  };
}

export async function getResumeTextById(id: string): Promise<ResumeTextResponse> {
  const record = await prisma.resume.findUnique({
    where: { id },
    select: {
      id: true,
      fileName: true,
      version: true,
      rawText: true,
    },
  });

  if (!record) {
    throw new ResumeNotFoundError(`Resume with ID ${id} not found`);
  }

  return {
    id: record.id,
    fileName: record.fileName,
    version: record.version,
    rawText: record.rawText,
  };
}
