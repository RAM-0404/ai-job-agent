import { prisma } from '../db/prisma.js';

async function clean() {
  console.log('Cleaning database tables...');
  await prisma.jobMatch.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.discoveryRun.deleteMany({});
  await prisma.jobSource.deleteMany({});
  await prisma.skill.deleteMany({});
  await prisma.experience.deleteMany({});
  await prisma.education.deleteMany({});
  await prisma.jobPreference.deleteMany({});
  await prisma.resume.deleteMany({});
  await prisma.userProfile.deleteMany({});

  const counts = {
    user_profiles: await prisma.userProfile.count(),
    resumes: await prisma.resume.count(),
    skills: await prisma.skill.count(),
    experiences: await prisma.experience.count(),
    educations: await prisma.education.count(),
    job_preferences: await prisma.jobPreference.count(),
    jobs: await prisma.job.count(),
    job_sources: await prisma.jobSource.count(),
    discovery_runs: await prisma.discoveryRun.count(),
    job_matches: await prisma.jobMatch.count(),
  };

  console.log('FINAL_DATABASE_COUNTS:', JSON.stringify(counts, null, 2));
  await prisma.$disconnect();
}

clean().catch((e) => {
  console.error('Failed to clean database:', e);
  process.exit(1);
});
