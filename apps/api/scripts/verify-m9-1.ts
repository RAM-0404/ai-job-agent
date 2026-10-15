import { prisma } from '../src/db/prisma.js';

const API_BASE = 'http://localhost:3000';

async function main() {
  console.log('--- Starting Milestone 9.1 Live End-to-End Workflow Verification ---');

  // 1. Prepare valid candidate profile and job in DB for live API testing
  const timestamp = Date.now();
  console.log('1. Setting up temporary test candidate and job...');
  const userProfile = await prisma.userProfile.create({
    data: {
      fullName: `M9.1 Live Tester ${timestamp}`,
      email: `m91-live-${timestamp}@example.com`,
      currentTitle: 'Lead Distributed Systems Architect',
      yearsOfExperience: 10,
      skills: {
        create: [
          { name: 'TypeScript', category: 'Language' },
          { name: 'Node.js', category: 'Backend' },
          { name: 'PostgreSQL', category: 'Database' },
        ],
      },
      experiences: {
        create: [
          {
            company: 'Cloud Corp',
            jobTitle: 'Senior Infrastructure Engineer',
            startDate: new Date('2020-01-01'),
            isCurrent: true,
            description: 'Designed orchestration systems.',
          },
        ],
      },
    },
    include: { skills: true, experiences: true },
  });

  const jobSource = await prisma.jobSource.create({
    data: {
      name: `M9.1 Test Source ${timestamp}`,
      type: 'MANUAL',
    },
  });

  const job = await prisma.job.create({
    data: {
      jobSourceId: jobSource.id,
      title: 'Principal Systems Architect',
      companyName: 'Orchestration Labs',
      description: 'Lead engineering for LangGraph and distributed state systems.',
      workMode: 'REMOTE',
      employmentType: 'FULL_TIME',
      experienceLevel: 'LEAD',
    },
  });

  // Also create a JobMatch record to verify the evaluate node reads it
  const match = await prisma.jobMatch.create({
    data: {
      jobId: job.id,
      userProfileId: userProfile.id,
      overallScore: 92,
      skillScore: 95,
      experienceScore: 90,
      roleScore: 92,
      preferenceScore: 90,
      locationScore: 93,
      recommendation: 'APPLY',
      strengths: ['Strong TypeScript and distributed systems expertise'],
      gaps: [],
    },
  });

  console.log(`Created Profile: ${userProfile.id}, Job: ${job.id}, Match: ${match.id}`);

  // Test Run 1: Create -> Start -> WAITING_FOR_HUMAN -> Approve -> COMPLETED
  console.log('\n--- Workflow 1: Creation -> Execution -> Human Approval -> Completion ---');
  
  // Step 1: POST /agent/runs
  console.log('Creating AgentRun via POST /agent/runs...');
  const createRes1 = await fetch(`${API_BASE}/agent/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userProfileId: userProfile.id,
      jobId: job.id,
    }),
  });
  if (!createRes1.ok) throw new Error(`Create run failed: ${await createRes1.text()}`);
  const createdRun1 = await createRes1.json();
  console.log('Run created:', createdRun1);
  if (createdRun1.status !== 'IDLE' || createdRun1.currentStep !== 'INITIALIZE') {
    throw new Error(`Expected IDLE/INITIALIZE, got ${createdRun1.status}/${createdRun1.currentStep}`);
  }

  // Step 2: POST /agent/runs/:id/start
  console.log('Starting AgentRun via POST /agent/runs/:id/start...');
  const startRes1 = await fetch(`${API_BASE}/agent/runs/${createdRun1.runId}/start`, {
    method: 'POST',
  });
  if (!startRes1.ok) throw new Error(`Start run failed: ${await startRes1.text()}`);
  const startedRun1 = await startRes1.json();
  console.log('Run after start:', {
    status: startedRun1.status,
    currentStep: startedRun1.currentStep,
    decision: startedRun1.decision,
    matchScore: startedRun1.matchScore,
  });

  // Step 3: Confirm it reaches HUMAN_REVIEW / WAITING_FOR_HUMAN
  if (startedRun1.status !== 'WAITING_FOR_HUMAN' || startedRun1.currentStep !== 'HUMAN_REVIEW') {
    throw new Error(`Expected WAITING_FOR_HUMAN/HUMAN_REVIEW, got ${startedRun1.status}/${startedRun1.currentStep}`);
  }
  if (!startedRun1.matchScore || startedRun1.matchScore < 70) {
    throw new Error(`Expected evaluate node to yield matchScore >= 70, got ${startedRun1.matchScore}`);
  }

  // Step 4: Confirm events were recorded
  console.log('Checking event history via GET /agent/runs/:id/events...');
  const eventsRes1 = await fetch(`${API_BASE}/agent/runs/${createdRun1.runId}/events`);
  if (!eventsRes1.ok) throw new Error(`Get events failed: ${await eventsRes1.text()}`);
  const events1 = await eventsRes1.json();
  console.log(`Found ${events1.length} events:`);
  for (const ev of events1) {
    console.log(`  - [${ev.step}:${ev.eventType}] ${ev.message}`);
  }
  if (events1.length < 4) {
    throw new Error(`Expected at least 4 events (INITIALIZE, LOAD_CONTEXT, EVALUATE, HUMAN_REVIEW), got ${events1.length}`);
  }

  // Step 5: Approve the run
  console.log('Approving Run via POST /agent/runs/:id/approve...');
  const approveRes = await fetch(`${API_BASE}/agent/runs/${createdRun1.runId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'Verified candidate meets all requirements. Approved.' }),
  });
  if (!approveRes.ok) throw new Error(`Approve run failed: ${await approveRes.text()}`);
  const approvedRun = await approveRes.json();
  console.log('Run after approval:', {
    status: approvedRun.status,
    currentStep: approvedRun.currentStep,
    decision: approvedRun.decision,
    completedAt: approvedRun.completedAt,
  });

  // Step 6: Confirm completion
  if (approvedRun.status !== 'COMPLETED' || approvedRun.currentStep !== 'COMPLETED' || approvedRun.decision !== 'APPROVED') {
    throw new Error(`Expected COMPLETED/COMPLETED/APPROVED, got ${approvedRun.status}/${approvedRun.currentStep}/${approvedRun.decision}`);
  }
  if (!approvedRun.completedAt) {
    throw new Error('Expected completedAt to be set on run completion');
  }

  // Check final events after approval
  const finalEventsRes1 = await fetch(`${API_BASE}/agent/runs/${createdRun1.runId}/events`);
  const finalEvents1 = await finalEventsRes1.json();
  console.log(`Final event count for Run 1: ${finalEvents1.length}`);

  // Test Run 2: Creation -> Start -> WAITING_FOR_HUMAN -> Rejection -> CANCELLED
  console.log('\n--- Workflow 2: Creation -> Execution -> Human Rejection -> Cancellation ---');
  const createRes2 = await fetch(`${API_BASE}/agent/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userProfileId: userProfile.id,
      jobId: job.id,
    }),
  });
  const createdRun2 = await createRes2.json();
  
  await fetch(`${API_BASE}/agent/runs/${createdRun2.runId}/start`, { method: 'POST' });
  
  console.log('Rejecting Run 2 via POST /agent/runs/:id/reject...');
  const rejectRes = await fetch(`${API_BASE}/agent/runs/${createdRun2.runId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Position compensation below candidate target.' }),
  });
  if (!rejectRes.ok) throw new Error(`Reject run failed: ${await rejectRes.text()}`);
  const rejectedRun = await rejectRes.json();
  console.log('Run after rejection:', {
    status: rejectedRun.status,
    currentStep: rejectedRun.currentStep,
    decision: rejectedRun.decision,
    errorMessage: rejectedRun.errorMessage,
  });

  if (rejectedRun.status !== 'CANCELLED' || rejectedRun.decision !== 'REJECTED') {
    throw new Error(`Expected CANCELLED/REJECTED, got ${rejectedRun.status}/${rejectedRun.decision}`);
  }

  // 8. Verify safety invariants:
  // - No external applications were submitted
  // - Original resume / user profile facts are unmodified
  console.log('\n--- Safety Invariants Verification ---');
  const freshProfile = await prisma.userProfile.findUnique({
    where: { id: userProfile.id },
    include: { skills: true, experiences: true },
  });
  if (freshProfile?.fullName !== userProfile.fullName || freshProfile?.yearsOfExperience !== 10) {
    throw new Error('Violation: UserProfile facts were unexpectedly modified!');
  }
  if (freshProfile.skills.length !== 3) {
    throw new Error('Violation: Candidate skills were modified!');
  }
  console.log('✓ Candidate profile facts and skills are completely intact and unmodified.');

  const applications = await prisma.application.findMany({
    where: { userProfileId: userProfile.id },
  });
  for (const app of applications) {
    if ((app as any).status === 'SUBMITTED') {
      throw new Error('Violation: Unexpected application was automatically submitted!');
    }
  }
  console.log('✓ No external submissions occurred; application workspace remained under human review.');

  // 9. Clean all temporary test data
  console.log('\n--- Cleanup ---');
  for (const a of applications) {
    await prisma.applicationAnswer.deleteMany({ where: { applicationId: a.id } });
    await prisma.applicationDocument.deleteMany({ where: { applicationId: a.id } });
    await prisma.application.delete({ where: { id: a.id } });
  }
  await prisma.agentRunEvent.deleteMany({ where: { agentRunId: { in: [createdRun1.runId, createdRun2.runId] } } });
  await prisma.agentRun.deleteMany({ where: { id: { in: [createdRun1.runId, createdRun2.runId] } } });
  await prisma.jobMatch.deleteMany({ where: { id: match.id } });
  await prisma.job.deleteMany({ where: { id: job.id } });
  await prisma.jobSource.deleteMany({ where: { id: jobSource.id } });
  await prisma.experience.deleteMany({ where: { userProfileId: userProfile.id } });
  await prisma.skill.deleteMany({ where: { userProfileId: userProfile.id } });
  await prisma.userProfile.deleteMany({ where: { id: userProfile.id } });
  console.log('✓ All temporary test data successfully cleaned from the database.');

  console.log('\n=== MILESTONE 9.1 LIVE VERIFICATION COMPLETED SUCCESSFULLY ===');
}

main()
  .catch((err) => {
    console.error('VERIFICATION FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
