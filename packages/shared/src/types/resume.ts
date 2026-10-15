export interface ResumeResponse {
  id: string;
  fileName: string;
  version: number;
  fileType: string;
  fileSize: number;
  textExtracted: boolean;
  createdAt: string;
}

export interface ResumeListResponse {
  resumes: ResumeResponse[];
  latestResume: ResumeResponse | null;
}

export interface ResumeTextResponse {
  id: string;
  fileName: string;
  version: number;
  rawText: string | null;
}
