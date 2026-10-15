import { prisma } from '../src/db/prisma.js';
import { applicationValidationService } from '../src/services/applications/application-validation.service.js';
import { createApplicationValidationNode } from '../src/services/agent/nodes/application-validation.node.js';

const API_BASE = 'http://localhost:3000';

async function main() {
  console.log('=== Starting Milestone 9.3 Live End-to-End Workflow Verification ===\n');

  const timestamp = Date.now();

  // 1. Setup Candidate Profile
  console.log('1. Setting up candidate profile...');
  const userProfile = await prisma.userProfile.create({
    data: {
      fullName: `M9.3 Candidate ${timestamp}`,
      email: `m93-candidate-${timestamp}@example.com`,
      currentTitle: 'Lead Distributed Systems Architect',
      yearsOfExperience: 10,
      professionalSummary: 'Experienced distributed systems architect specializing in Node.js, TypeScript, and stateful agent orchestration.',
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
            description: 'Designed high-throughput distributed state machines and microservices with Node.js and TypeScript.',
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
      name: `M9.3 Verification Source ${timestamp}`,
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
  // CASE 1: APPLY Path (Generation + Validation + Human Review + Approval)
  // ==========================================
  console.log('--- CASE 1: APPLY Path (Generation + Fact Validation + Human Review + Approval) ---');
  const createRes1 = await fetch(`${API_BASE}/agent/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userProfileId: userProfile.id,
      jobId: highMatchJob.id,
    }),
  });
  if (!createRes1.ok) throw new Error(`Create run 1 failed: ${createRes1.statusText}`);
  const { runId: runId1 } = (await createRes1.json()) as any;
  createdRunIds.push(runId1);
  console.log(`Created AgentRun 1: ${runId1}`);

  console.log('Starting AgentRun 1 (executing M7 matching, M8 generation, M8 validation)...');
  const startRes1 = await fetch(`${API_BASE}/agent/runs/${runId1}/start`, {
    method: 'POST',
  });
  if (!startRes1.ok) throw new Error(`Start run 1 failed: ${startRes1.statusText}`);
  const startedRun1 = (await startRes1.json()) as any;

  console.log(`Run 1 Status: ${startedRun1.status}`);
  console.log(`Run 1 Step: ${startedRun1.currentStep}`);
  console.log(`Run 1 Decision: ${startedRun1.decision}`);
  console.log(`Run 1 Match Score: ${startedRun1.matchScore}%`);
  console.log(`Run 1 Match Recommendation: ${startedRun1.matchRecommendation}`);
  console.log(`Run 1 Application ID: ${startedRun1.applicationId}`);

  if (startedRun1.status !== 'WAITING_FOR_HUMAN') {
    throw new Error(`Expected status WAITING_FOR_HUMAN, got ${startedRun1.status}`);
  }
  if (!startedRun1.applicationId) {
    throw new Error('Expected applicationId to be populated on agent run');
  }

  // Verify Application record and generated documents in PostgreSQL
  const appRecord1 = await prisma.application.findUnique({
    where: { id: startedRun1.applicationId },
    include: { documents: true, answers: true },
  });
  if (!appRecord1) throw new Error('Application record not found in PostgreSQL');
  console.log(`Application Status in DB: ${appRecord1.status}`);
  if (appRecord1.status !== 'DRAFT') {
    throw new Error(`Expected Application status DRAFT, got ${appRecord1.status}. Agent must not approve application!`);
  }
  console.log(`Generated Documents Count: ${appRecord1.documents.length}`);
  for (const doc of appRecord1.documents) {
    console.log(`  - [${doc.type}] length=${doc.content.length} chars (source: ${doc.source})`);
  }

  // Verify Event sequence for Case 1
  const eventsRes1 = await fetch(`${API_BASE}/agent/runs/${runId1}/events`);
  const events1 = (await eventsRes1.json()) as any[];
  console.log('Run 1 Event Log:');
  for (const ev of events1) {
    console.log(`  - [${ev.step}:${ev.eventType}] ${ev.message}`);
  }
  const eventTags1 = events1.map((e) => `${e.step}:${e.eventType}`);
  const requiredTags1 = [
    'INITIALIZE:CREATED',
    'LOAD_CONTEXT:STARTED',
    'LOAD_CONTEXT:COMPLETED',
    'EVALUATE:EVALUATION_STARTED',
    'EVALUATE:MATCH_STARTED',
    'EVALUATE:MATCH_COMPLETED',
    'EVALUATE:AGENT_CONTINUED',
    'GENERATE_APPLICATION:APPLICATION_GENERATION:STARTED',
    'GENERATE_APPLICATION:APPLICATION_GENERATION:COMPLETED',
    'VALIDATE_APPLICATION:APPLICATION_VALIDATION:STARTED',
    'HUMAN_REVIEW:WAITING',
  ];
  for (const tag of requiredTags1) {
    if (!eventTags1.includes(tag)) {
      throw new Error(`Missing expected event tag: ${tag}`);
    }
  }

  // Explicit Human Approval
  console.log('Candidate explicitly approves workflow continuation...');
  const approveRes1 = await fetch(`${API_BASE}/agent/runs/${runId1}/approve`, {
    method: 'POST',
  });
  if (!approveRes1.ok) throw new Error(`Approve run 1 failed: ${approveRes1.statusText}`);
  const approvedRun1 = (await approveRes1.json()) as any;

  console.log(`Approved Run 1 Status: ${approvedRun1.status}`);
  console.log(`Approved Run 1 Step: ${approvedRun1.currentStep}`);
  console.log(`Approved Run 1 Decision: ${approvedRun1.decision}`);
  console.log(`Approved Run 1 CompletedAt: ${approvedRun1.completedAt}`);
  if (approvedRun1.status !== 'COMPLETED' || approvedRun1.decision !== 'APPROVED') {
    throw new Error('Approval did not transition run to COMPLETED with decision APPROVED');
  }
  console.log('CASE 1 PASSED!\n');

  // ==========================================
  // CASE 2: DO_NOT_APPLY Path (No Application Generated)
  // ==========================================
  console.log('--- CASE 2: DO_NOT_APPLY Path (Mismatched Job - No Application Generation) ---');
  const initialAppCount = await prisma.application.count({
    where: { jobId: mismatchedJob.id, userProfileId: userProfile.id },
  });

  const createRes2 = await fetch(`${API_BASE}/agent/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userProfileId: userProfile.id,
      jobId: mismatchedJob.id,
    }),
  });
  const { runId: runId2 } = (await createRes2.json()) as any;
  createdRunIds.push(runId2);
  console.log(`Created AgentRun 2: ${runId2}`);

  console.log('Starting AgentRun 2 (should stop after evaluation)...');
  const startRes2 = await fetch(`${API_BASE}/agent/runs/${runId2}/start`, {
    method: 'POST',
  });
  const stoppedRun2 = (await startRes2.json()) as any;

  console.log(`Run 2 Status: ${stoppedRun2.status}`);
  console.log(`Run 2 Step: ${stoppedRun2.currentStep}`);
  console.log(`Run 2 Decision: ${stoppedRun2.decision}`);
  console.log(`Run 2 Match Recommendation: ${stoppedRun2.matchRecommendation}`);
  console.log(`Run 2 Application ID: ${stoppedRun2.applicationId}`);

  if (stoppedRun2.status !== 'COMPLETED' || stoppedRun2.decision !== 'STOP') {
    throw new Error(`Expected COMPLETED/STOP, got ${stoppedRun2.status}/${stoppedRun2.decision}`);
  }

  // Confirm NO application was generated
  const afterAppCount = await prisma.application.count({
    where: { jobId: mismatchedJob.id, userProfileId: userProfile.id },
  });
  if (afterAppCount !== initialAppCount) {
    throw new Error('Application was erroneously created on DO_NOT_APPLY path!');
  }
  console.log('Verified: No Application was created for mismatched job.');
  console.log('CASE 2 PASSED!\n');

  // ==========================================
  // CASE 3: Existing Application Idempotency
  // ==========================================
  console.log('--- CASE 3: Existing Application Idempotency (Reuse Without Duplication) ---');
  const appsBeforeCase3 = await prisma.application.count({
    where: { jobId: highMatchJob.id, userProfileId: userProfile.id },
  });
  console.log(`Existing applications for high-match job before run 3: ${appsBeforeCase3}`);

  const createRes3 = await fetch(`${API_BASE}/agent/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userProfileId: userProfile.id,
      jobId: highMatchJob.id,
    }),
  });
  const { runId: runId3 } = (await createRes3.json()) as any;
  createdRunIds.push(runId3);
  console.log(`Created AgentRun 3: ${runId3}`);

  const startRes3 = await fetch(`${API_BASE}/agent/runs/${runId3}/start`, {
    method: 'POST',
  });
  const run3 = (await startRes3.json()) as any;

  console.log(`Run 3 Application ID: ${run3.applicationId}`);
  if (run3.applicationId !== startedRun1.applicationId) {
    throw new Error('Run 3 did not reuse existing Application ID!');
  }

  const appsAfterCase3 = await prisma.application.count({
    where: { jobId: highMatchJob.id, userProfileId: userProfile.id },
  });
  console.log(`Applications count after run 3: ${appsAfterCase3}`);
  if (appsAfterCase3 !== 1) {
    throw new Error(`Expected exactly 1 application record, found ${appsAfterCase3}`);
  }
  console.log('Verified: Existing application was reused idempotently without duplication.');
  console.log('CASE 3 PASSED!\n');

  // ==========================================
  // CASE 4: User-Edited Content Protection
  // ==========================================
  console.log('--- CASE 4: User-Edited Content Protection ---');
  const userEditedCoverLetter = 'CANDIDATE MANUAL EDITED COVER LETTER: Tailored specifically for the hiring manager.';

  // Manually update cover letter with USER_EDITED source
  await prisma.applicationDocument.update({
    where: {
      applicationId_type: {
        applicationId: startedRun1.applicationId,
        type: 'COVER_LETTER',
      },
    },
    data: {
      content: userEditedCoverLetter,
      source: 'USER_EDITED',
    },
  });
  console.log('Updated cover letter document in DB to source = USER_EDITED.');

  // Run agent again for same candidate & job
  const createRes4 = await fetch(`${API_BASE}/agent/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userProfileId: userProfile.id,
      jobId: highMatchJob.id,
    }),
  });
  const { runId: runId4 } = (await createRes4.json()) as any;
  createdRunIds.push(runId4);
  console.log(`Created AgentRun 4: ${runId4}`);

  await fetch(`${API_BASE}/agent/runs/${runId4}/start`, { method: 'POST' });

  // Verify candidate manual edits remain intact
  const docAfterRun4 = await prisma.applicationDocument.findUnique({
    where: {
      applicationId_type: {
        applicationId: startedRun1.applicationId,
        type: 'COVER_LETTER',
      },
    },
  });
  if (docAfterRun4?.content !== userEditedCoverLetter || docAfterRun4?.source !== 'USER_EDITED') {
    throw new Error('User-edited content was overwritten by agent rerun!');
  }
  console.log('Verified: User-edited content remained completely preserved.');
  console.log('CASE 4 PASSED!\n');

  // ==========================================
  // CASE 5: Validation Failure (Hard Hallucination Check)
  // ==========================================
  console.log('--- CASE 5: Validation Hard Failure Handling ---');
  // Use controlled mock validation node with hard suspicious claims
  const mockFailingValidationNode = createApplicationValidationNode({
    validateApplicationMaterials() {
      return {
        isValid: false,
        warnings: [],
        suspiciousClaims: ['Fabricated claim: 20 years experience at Google when candidate has 10 years.'],
      };
    },
  });

  const failureStateUpdate = await mockFailingValidationNode({
    runId: runId4,
    userProfileId: userProfile.id,
    jobId: highMatchJob.id,
    applicationId: startedRun1.applicationId,
    currentStep: 'GENERATE_APPLICATION',
    status: 'RUNNING',
    decision: 'CONTINUE',
    requiresHumanApproval: false,
    errors: [],
    warnings: [],
    metadata: {},
    context: {},
  } as any);

  console.log(`Failure Node Status: ${failureStateUpdate.status}`);
  console.log(`Failure Node CurrentStep: ${failureStateUpdate.currentStep}`);
  console.log(`Failure Node Decision: ${failureStateUpdate.decision}`);
  console.log(`Failure Node Errors: ${failureStateUpdate.errors?.join('; ')}`);

  if (
    failureStateUpdate.status !== 'FAILED' ||
    failureStateUpdate.decision !== 'STOP' ||
    failureStateUpdate.currentStep !== 'FAILED'
  ) {
    throw new Error('Validation failure did not transition state to FAILED/STOP!');
  }
  console.log('Verified: Validation hard failure halts workflow safely without human review or submission.');
  console.log('CASE 5 PASSED!\n');

  // ==========================================
  // CASE 6: Human Rejection
  // ==========================================
  console.log('--- CASE 6: Human Rejection Handling ---');
  const createRes6 = await fetch(`${API_BASE}/agent/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userProfileId: userProfile.id,
      jobId: highMatchJob.id,
    }),
  });
  const { runId: runId6 } = (await createRes6.json()) as any;
  createdRunIds.push(runId6);

  await fetch(`${API_BASE}/agent/runs/${runId6}/start`, { method: 'POST' });

  // Rejection
  const rejectReason = 'Candidate does not wish to apply to Orchestration Platforms Inc.';
  const rejectRes6 = await fetch(`${API_BASE}/agent/runs/${runId6}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: rejectReason }),
  });
  const rejectedRun6 = (await rejectRes6.json()) as any;

  console.log(`Rejected Run Status: ${rejectedRun6.status}`);
  console.log(`Rejected Run Step: ${rejectedRun6.currentStep}`);
  console.log(`Rejected Run Decision: ${rejectedRun6.decision}`);
  console.log(`Rejected Run ErrorMessage: ${rejectedRun6.errorMessage}`);

  if (rejectedRun6.status !== 'CANCELLED' || rejectedRun6.decision !== 'REJECTED') {
    throw new Error('Rejection did not transition run to CANCELLED with decision REJECTED');
  }
  console.log('Verified: Rejection safely terminates workflow.');
  console.log('CASE 6 PASSED!\n');

  // ==========================================
  // DATABASE CLEANUP & COUNT VERIFICATION
  // ==========================================
  console.log('=== Database Cleanup & Verification ===');
  for (const rId of createdRunIds) {
    await prisma.agentRunEvent.deleteMany({ where: { agentRunId: rId } });
    await prisma.agentRun.deleteMany({ where: { id: rId } });
  }

  // Delete applications
  const userApps = await prisma.application.findMany({ where: { userProfileId: userProfile.id } });
  for (const app of userApps) {
    await prisma.applicationAnswer.deleteMany({ where: { applicationId: app.id } });
    await prisma.applicationDocument.deleteMany({ where: { applicationId: app.id } });
    await prisma.application.delete({ where: { id: app.id } });
  }

  // Delete matches and jobs
  await prisma.jobMatch.deleteMany({ where: { userProfileId: userProfile.id } });
  await prisma.job.deleteMany({ where: { jobSourceId: jobSource.id } });
  await prisma.jobSource.deleteMany({ where: { id: jobSource.id } });

  // Delete candidate profile
  await prisma.jobPreference.deleteMany({ where: { userProfileId: userProfile.id } });
  await prisma.experience.deleteMany({ where: { userProfileId: userProfile.id } });
  await prisma.skill.deleteMany({ where: { userProfileId: userProfile.id } });
  await prisma.userProfile.deleteMany({ where: { id: userProfile.id } });

  console.log('All temporary verification test records successfully deleted.');

  // Confirm counts are zero for our test IDs
  const remainingCandidate = await prisma.userProfile.count({ where: { id: userProfile.id } });
  const remainingJob = await prisma.job.count({ where: { id: highMatchJob.id } });
  const remainingRuns = await prisma.agentRun.count({ where: { id: { in: createdRunIds } } });

  console.log(`Remaining Candidate Profiles: ${remainingCandidate}`);
  console.log(`Remaining Jobs: ${remainingJob}`);
  console.log(`Remaining Agent Runs: ${remainingRuns}`);

  if (remainingCandidate !== 0 || remainingJob !== 0 || remainingRuns !== 0) {
    throw new Error('Database cleanup failed: residual test records remain!');
  }

  console.log('\n=== MILESTONE 9.3 LIVE VERIFICATION COMPLETE & SUCCESSFUL! ===');
}

main().catch((err) => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
