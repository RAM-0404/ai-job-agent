export interface AISkill {
  name: string;
  category: string | null;
  proficiency: string | null;
}

export interface AIExperience {
  company: string;
  jobTitle: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
}

export interface AIEducation {
  institution: string;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface AIProject {
  name: string;
  description: string | null;
  technologies: string[];
}

export interface AICertification {
  name: string;
  issuer: string | null;
  year: number | null;
}

export interface ResumeAIProfile {
  professionalSummary: string | null;
  currentTitle: string | null;
  yearsOfExperience: number | null;
  skills: AISkill[];
  experience: AIExperience[];
  education: AIEducation[];
  projects: AIProject[];
  certifications: AICertification[];
}

export interface ResumeAnalysisCounts {
  skills: number;
  experience: number;
  education: number;
  projects: number;
  certifications: number;
}

export interface ResumeAnalysisProfileSummary {
  professionalSummary: string | null;
  currentTitle: string | null;
  yearsOfExperience: number | null;
}

export interface ResumeAnalysisResponse {
  resumeId: string;
  status: 'analyzed';
  profile: ResumeAnalysisProfileSummary;
  counts: ResumeAnalysisCounts;
}
