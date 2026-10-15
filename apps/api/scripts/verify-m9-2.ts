import { prisma } from '../src/db/prisma.js';

const API_BASE = 'http://localhost:3000';

async function main() {
  console.log('=== Starting Milestone 9.2 Live End-to-End Workflow Verification ===\n');

  const timestamp = Date.now();

  // 1. Setup Candidate Profile
  console.log('1. Setting up candidate profile...');
  const userProfile = await prisma.userProfile.create({
    data: {
      fullName: `M9.2 Candidate ${timestamp}`,
      email: `m92-candidate-${timestamp}@example.com`,
      currentTitle: 'Lead Distributed Systems Architect',
      yearsOfExperience: 10,
      skills: {
        create: [
          { name: 'TypeScript', category: 'Language' },
          { name: 'Node.js', category: 'Backend' },
          { name: 'PostgreSQL', category: 'Database' },
          { name: 'Distributed Systems', category: 'Architecture' },
        ],
      },
      experiences: {
        create: [
          {
            company: 'Cloud Scale Inc',
            jobTitle: 'Senior Systems Architect',
            startDate: new Date('2019-01-01'),
            isCurrent: true,
            description: 'Designed high-throughput distributed state systems and microservices with Node.js and TypeScript.',
          },
        ],
      },
      jobPreferences: {
        create: {
          preferredRoles: ['Lead Distributed Systems Architect', 'Principal Backend Engineer'],
          preferredLocations: ['Remote'],
          workModes: ['REMOTE'],
          minimumSalary: 140000,
        },
      },
    },
    include: { skills: true, experiences: true },
  });

  const jobSource = await prisma.jobSource.create({
    data: {
      name: `M9.2 Verification Source ${timestamp}`,
      type: 'MANUAL',
    },
  });

  // 2. High Match Job (APPLY / CONSIDER)
  const highMatchJob = await prisma.job.create({
    data: {
      jobSourceId: jobSource.id,
      title: 'Principal Distributed Systems Engineer',
      companyName: 'Orchestration Platforms Inc',
      description: 'Looking for a Principal Engineer with deep expertise in TypeScript, Node.js, PostgreSQL, and distributed state machines to build next-generation agent platforms.',
      workMode: 'REMOTE',
      employmentType: 'FULL_TIME',
      experienceLevel: 'LEAD',
      salaryMin: 150000,
      salaryMax: 200000,
    },
  });

  // 3. Mismatched Job (LOW_PRIORITY / DO_NOT_APPLY)
  const mismatchedJob = await prisma.job.create({
    data: {
      jobSourceId: jobSource.id,
      title: 'Senior Cardiothoracic Surgeon',
      companyName: 'Metropolitan General Hospital',
      description: 'Licensed medical surgeon requiring MD degree, residency in cardiac surgery, active medical license, and 8+ years clinical operating room experience in coronary artery bypass grafting.',
      workMode: 'ONSITE',
      employmentType: 'FULL_TIME',
      experienceLevel: 'SENIOR',
      location: 'New York, NY',
    },
  });

  console.log(`Candidate: ${userProfile.id}`);
  console.log(`High-Match Job: ${highMatchJob.id}`);
  console.log(`Mismatched Job: ${mismatchedJob.id}\n`);

  const createdRunIds: string[] = [];

  // ==========================================
  // Test Case 1: APPLY / CONSIDER Path
  // ==========================================
  console.log('--- Test Case 1: APPLY / CONSIDER Workflow (High Match) ---');
  const createRes1 = await fetch(`${API_BASE}/agent/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userProfileId: userProfile.id,
      jobId: highMatchJob.id,
    }),
  });
  if (!createRes1.ok) throw new Error(`Create run 1 failed: ${await createRes1.text()}`);
  const run1 = await createRes1.json();
  createdRunIds.push(run1.runId);
  console.log(`Created Run 1: ${run1.runId} (${run1.status}/${run1.currentStep})`);

  console.log('Starting Run 1 (invoking M7 matching via LangGraph)...');
  const startRes1 = await fetch(`${API_BASE}/agent/runs/${run1.runId}/start`, { method: 'POST' });
  if (!startRes1.ok) throw new Error(`Start run 1 failed: ${await startRes1.text()}`);
  const startedRun1 = await startRes1.json();
  console.log('Started Run 1 State:', {
    status: startedRun1.status,
    currentStep: startedRun1.currentStep,
    decision: startedRun1.decision,
    matchScore: startedRun1.matchScore,
    matchRecommendation: startedRun1.matchRecommendation,
  });

  if (startedRun1.status !== 'WAITING_FOR_HUMAN' || startedRun1.currentStep !== 'HUMAN_REVIEW') {
    throw new Error(`Expected WAITING_FOR_HUMAN/HUMAN_REVIEW, got ${startedRun1.status}/${startedRun1.currentStep}`);
  }
  if (!startedRun1.matchScore || startedRun1.matchScore < 70) {
    throw new Error(`Expected matchScore >= 70, got ${startedRun1.matchScore}`);
  }
  if (startedRun1.matchRecommendation !== 'APPLY' && startedRun1.matchRecommendation !== 'CONSIDER') {
    throw new Error(`Expected APPLY or CONSIDER, got ${startedRun1.matchRecommendation}`);
  }

  // Check event stream
  const eventsRes1 = await fetch(`${API_BASE}/agent/runs/${run1.runId}/events`);
  const events1 = await eventsRes1.json();
  console.log(`Run 1 recorded ${events1.length} events:`);
  for (const ev of events1) {
    console.log(`  - [${ev.step}:${ev.eventType}] ${ev.message}`);
  }

  const expectedTags1 = [
    'INITIALIZE:CREATED',
    'LOAD_CONTEXT:STARTED',
    'LOAD_CONTEXT:COMPLETED',
    'EVALUATE:EVALUATION_STARTED',
    'EVALUATE:MATCH_STARTED',
    'EVALUATE:MATCH_COMPLETED',
    'EVALUATE:AGENT_CONTINUED',
    'HUMAN_REVIEW:WAITING',
  ];
  const actualTags1 = events1.map((e: any) => `${e.step}:${e.eventType}`);
  for (const tag of expectedTags1) {
    if (!actualTags1.includes(tag)) {
      throw new Error(`Run 1 missing expected event: ${tag}`);
    }
  }

  // Human Approval
  console.log('Approving Run 1 via POST /agent/runs/:id/approve...');
  const approveRes = await fetch(`${API_BASE}/agent/runs/${run1.runId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'Strong match confirmed. Approved.' }),
  });
  if (!approveRes.ok) throw new Error(`Approve run 1 failed: ${await approveRes.text()}`);
  const approvedRun = await approveRes.json();
  console.log('Run 1 after approval:', {
    status: approvedRun.status,
    currentStep: approvedRun.currentStep,
    decision: approvedRun.decision,
    completedAt: approvedRun.completedAt,
  });

  if (approvedRun.status !== 'COMPLETED' || approvedRun.decision !== 'APPROVED') {
    throw new Error(`Expected COMPLETED/APPROVED, got ${approvedRun.status}/${approvedRun.decision}`);
  }

  // ==========================================
  // Test Case 2: DO_NOT_APPLY / LOW_PRIORITY Path
  // ==========================================
  console.log('\n--- Test Case 2: LOW_PRIORITY / DO_NOT_APPLY Workflow (Mismatched Job) ---');
  const createRes2 = await fetch(`${API_BASE}/agent/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userProfileId: userProfile.id,
      jobId: mismatchedJob.id,
    }),
  });
  const run2 = await createRes2.json();
  createdRunIds.push(run2.runId);
  console.log(`Created Run 2: ${run2.runId}`);

  console.log('Starting Run 2 (evaluating mismatch via M7)...');
  const startRes2 = await fetch(`${API_BASE}/agent/runs/${run2.runId}/start`, { method: 'POST' });
  if (!startRes2.ok) throw new Error(`Start run 2 failed: ${await startRes2.text()}`);
  const startedRun2 = await startRes2.json();
  console.log('Started Run 2 State:', {
    status: startedRun2.status,
    currentStep: startedRun2.currentStep,
    decision: startedRun2.decision,
    matchScore: startedRun2.matchScore,
    matchRecommendation: startedRun2.matchRecommendation,
    completedAt: startedRun2.completedAt,
  });

  // Verify normal completion via stop path
  if (startedRun2.status !== 'COMPLETED' || startedRun2.currentStep !== 'COMPLETED') {
    throw new Error(`Expected COMPLETED/COMPLETED on low match stop path, got ${startedRun2.status}/${startedRun2.currentStep}`);
  }
  if (startedRun2.decision !== 'STOP') {
    throw new Error(`Expected decision STOP, got ${startedRun2.decision}`);
  }
  if (startedRun2.matchRecommendation !== 'DO_NOT_APPLY' && startedRun2.matchRecommendation !== 'LOW_PRIORITY') {
    throw new Error(`Expected DO_NOT_APPLY or LOW_PRIORITY, got ${startedRun2.matchRecommendation}`);
  }
  if (!startedRun2.completedAt) {
    throw new Error('Expected completedAt to be set on normal stop completion');
  }

  const eventsRes2 = await fetch(`${API_BASE}/agent/runs/${run2.runId}/events`);
  const events2 = await eventsRes2.json();
  console.log(`Run 2 recorded ${events2.length} events:`);
  for (const ev of events2) {
    console.log(`  - [${ev.step}:${ev.eventType}] ${ev.message}`);
  }

  const expectedTags2 = [
    'INITIALIZE:CREATED',
    'LOAD_CONTEXT:STARTED',
    'LOAD_CONTEXT:COMPLETED',
    'EVALUATE:EVALUATION_STARTED',
    'EVALUATE:MATCH_STARTED',
    'EVALUATE:MATCH_COMPLETED',
    'EVALUATE:AGENT_STOPPED',
    'COMPLETED:COMPLETED',
  ];
  const actualTags2 = events2.map((e: any) => `${e.step}:${e.eventType}`);
  for (const tag of expectedTags2) {
    if (!actualTags2.includes(tag)) {
      throw new Error(`Run 2 missing expected event: ${tag}`);
    }
  }

  // ==========================================
  // Test Case 3: Matching Error / Failure
  // ==========================================
  console.log('\n--- Test Case 3: Error Handling ---');
  // Attempting to approve an already COMPLETED run returns 400
  const invalidApproveRes = await fetch(`${API_BASE}/agent/runs/${run2.runId}/approve`, {
    method: 'POST',
  });
  if (invalidApproveRes.status !== 400) {
    throw new Error(`Expected 400 for approving COMPLETED run, got ${invalidApproveRes.status}`);
  }
  console.log('✓ Verified illegal state transition is strictly blocked (HTTP 400).');

  // ==========================================
  // Test Case 4: Safety & Idempotency Invariants
  // ==========================================
  console.log('\n--- Test Case 4: Safety & Idempotency Invariants ---');
  const freshProfile = await prisma.userProfile.findUnique({
    where: { id: userProfile.id },
    include: { skills: true, experiences: true },
  });
  if (freshProfile?.fullName !== userProfile.fullName || freshProfile?.yearsOfExperience !== 10) {
    throw new Error('Violation: Candidate facts were unexpectedly modified!');
  }
  if (freshProfile.skills.length !== 4) {
    throw new Error('Violation: Candidate skills count changed!');
  }
  console.log('✓ Candidate profile facts and skills remain 100% intact.');

  const applications = await prisma.application.findMany({
    where: { userProfileId: userProfile.id },
  });
  for (const app of applications) {
    if ((app.status as string) === 'SUBMITTED') {
      throw new Error(`Violation: Application ${app.id} was automatically submitted!`);
    }
  }
  console.log('✓ Zero external applications submitted automatically (status !== SUBMITTED).');

  // Verify M7 persistence exists
  const match1 = await prisma.jobMatch.findUnique({
    where: { jobId_userProfileId: { jobId: highMatchJob.id, userProfileId: userProfile.id } },
  });
  const match2 = await prisma.jobMatch.findUnique({
    where: { jobId_userProfileId: { jobId: mismatchedJob.id, userProfileId: userProfile.id } },
  });
  if (!match1 || !match2) {
    throw new Error('Violation: Expected JobMatch records to be persisted by M7 matching service');
  }
  console.log(`✓ M7 JobMatch persistence verified: HighMatch=${match1.overallScore}% (${match1.recommendation}), Mismatch=${match2.overallScore}% (${match2.recommendation})`);

  // ==========================================
  // Test Case 5: Database Cleanup
  // ==========================================
  console.log('\n--- Cleanup ---');
  for (const id of createdRunIds) {
    await prisma.agentRunEvent.deleteMany({ where: { agentRunId: id } });
    await prisma.agentRun.deleteMany({ where: { id } });
  }
  const userApps = await prisma.application.findMany({ where: { userProfileId: userProfile.id } });
  for (const app of userApps) {
    await prisma.applicationAnswer.deleteMany({ where: { applicationId: app.id } });
    await prisma.applicationDocument.deleteMany({ where: { applicationId: app.id } });
    await prisma.application.delete({ where: { id: app.id } });
  }
  await prisma.jobMatch.deleteMany({ where: { userProfileId: userProfile.id } });
  await prisma.job.deleteMany({ where: { id: { in: [highMatchJob.id, mismatchedJob.id] } } });
  await prisma.jobSource.deleteMany({ where: { id: jobSource.id } });
  await prisma.jobPreference.deleteMany({ where: { userProfileId: userProfile.id } });
  await prisma.experience.deleteMany({ where: { userProfileId: userProfile.id } });
  await prisma.skill.deleteMany({ where: { userProfileId: userProfile.id } });
  await prisma.userProfile.deleteMany({ where: { id: userProfile.id } });
  console.log('✓ All temporary test data successfully cleaned from the database.');

  console.log('\n=== MILESTONE 9.2 LIVE VERIFICATION COMPLETED SUCCESSFULLY ===');
}

main()
  .catch((err) => {
    console.error('VERIFICATION FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
