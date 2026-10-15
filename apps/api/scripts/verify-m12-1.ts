/**
 * Milestone 12.1 Live Verification Script
 * Validates Safe Multi-Step Application Navigation Foundation:
 * - Step/page detection & identity
 * - Navigation-control detection (Next, Continue, Back, Review)
 * - Navigation state tracking across steps
 * - Preservation of history & state across steps
 * - Strict rejection of terminal controls (Submit / Apply)
 * - Absolute confirmation that applicationSubmitted = false & submissionCount = 0
 */

import { buildServer } from '../src/server.js';

let BASE_URL = process.env.API_BASE_URL || '';
let embeddedServer: any = null;

async function request(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {};
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runLiveVerification() {
  console.log('============================================================');
  console.log('🚀 STARTING MILESTONE 12.1 LIVE VERIFICATION');
  console.log('Safe Multi-Step Application Navigation Foundation');
  console.log('============================================================\n');

  // Check if target server is reachable and running M12.1 fixture, or launch embedded server
  if (!BASE_URL) {
    try {
      const probe = await fetch('http://localhost:3000/browser/test-page/multi-step').catch(() => null);
      if (probe && probe.ok) {
        BASE_URL = 'http://localhost:3000';
      }
    } catch {
      // not running or old build
    }
  }

  if (!BASE_URL) {
    embeddedServer = await buildServer();
    const address = await embeddedServer.listen({ port: 0, host: '127.0.0.1' });
    const match = address.match(/:(\d+)$/);
    const port = match ? Number(match[1]) : 3000;
    BASE_URL = `http://127.0.0.1:${port}`;
    console.log(`Launched in-process verification server at ${BASE_URL}`);
  } else {
    console.log(`Target API: ${BASE_URL}`);
  }

  let sessionId: string | null = null;

  try {
    // Step 1: Health check verification
    console.log('\n1. Verifying /health endpoint reporting...');
    const healthRes = await request('/health');
    if (!healthRes.data?.browser?.enabled) {
      throw new Error(`Health check failed or browser disabled: ${JSON.stringify(healthRes.data)}`);
    }
    console.log('   ✅ Browser Automation Health OK:', JSON.stringify(healthRes.data.browser));

    // Step 2: Multi-step test fixture verification
    console.log('\n2. Verifying deterministic local multi-step fixture...');
    const fixtureRes = await fetch(`${BASE_URL}/browser/test-page/multi-step`);
    const fixtureHtml = await fixtureRes.text();
    if (fixtureRes.status !== 200 || !fixtureHtml.includes('multi-step-form')) {
      throw new Error(`Multi-step fixture page failed: status ${fixtureRes.status}`);
    }
    console.log('   ✅ Deterministic M12.1 multi-step fixture online.');

    // Step 3: Create isolated browser session
    console.log('\n3. Creating isolated browser session...');
    const sessionRes = await request('/browser/sessions', { method: 'POST' });
    if (sessionRes.status !== 201 || !sessionRes.data?.sessionId) {
      throw new Error(`Session creation failed: ${JSON.stringify(sessionRes.data)}`);
    }
    sessionId = sessionRes.data.sessionId;
    console.log(`   ✅ Browser session created: ${sessionId}`);

    // Step 4: Discover Step 1
    console.log('\n4. Discovering Step 1 on multi-step fixture...');
    const step1Res = await request(`/browser/sessions/${sessionId}/navigation/discover`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: `${BASE_URL}/browser/test-page/multi-step` }),
    });
    if (step1Res.status !== 200) {
      throw new Error(`Step 1 discovery failed: ${JSON.stringify(step1Res.data)}`);
    }
    const stateStep1 = step1Res.data;
    console.log(`   ✅ Step 1 detected: "${stateStep1.currentStep.heading}" (index: ${stateStep1.currentStep.stepIndex})`);
    console.log(`   ✅ Discovered fields: ${stateStep1.currentStep.discoveredFieldCount}, Required: ${stateStep1.currentStep.requiredFieldCount}`);

    // Step 5: Verify Next is detected on Step 1
    console.log('\n5. Verifying Next navigation control detection on Step 1...');
    const nextCtrl = stateStep1.currentStep.controls.find((c: any) => c.type === 'NEXT');
    if (!nextCtrl) {
      throw new Error('Next navigation control was not detected on Step 1!');
    }
    if (!nextCtrl.isExecutable || nextCtrl.isTerminal) {
      throw new Error(`Next control has invalid execution flags: executable=${nextCtrl.isExecutable}, terminal=${nextCtrl.isTerminal}`);
    }
    console.log(`   ✅ Next control detected: "${nextCtrl.label}" (id: ${nextCtrl.id}, executable: ${nextCtrl.isExecutable})`);

    // Step 6: Explicitly approve Next navigation to advance to Step 2
    console.log('\n6. Human Approval: Explicitly approving Next navigation control...');
    const navToStep2Res = await request(`/browser/sessions/${sessionId}/navigation/approve`, {
      method: 'POST',
      body: JSON.stringify({ controlId: nextCtrl.id }),
    });
    if (navToStep2Res.status !== 200) {
      throw new Error(`Navigation to Step 2 failed: ${JSON.stringify(navToStep2Res.data)}`);
    }
    const step2Result = navToStep2Res.data;
    console.log(`   ✅ Navigated successfully. New step: "${step2Result.currentStep.heading}" (index: ${step2Result.currentStep.stepIndex})`);

    // Step 7: Verify state history contains Step 1 and Step 2
    console.log('\n7. Verifying state & history tracking across steps...');
    if (step2Result.previousStep.stepIndex !== 1 || !step2Result.previousStep.completed) {
      throw new Error('Previous step state was not marked as completed!');
    }
    if (step2Result.navigationState.visitedSteps.length !== 1) {
      throw new Error(`Expected 1 visited step in history, got ${step2Result.navigationState.visitedSteps.length}`);
    }
    if (step2Result.navigationState.stepHistory.length !== 1) {
      throw new Error(`Expected 1 transition in history, got ${step2Result.navigationState.stepHistory.length}`);
    }
    console.log(`   ✅ Step 1 preserved in visitedSteps (completed: ${step2Result.previousStep.completed})`);
    console.log(`   ✅ Transition recorded: ${step2Result.navigationState.stepHistory[0].fromStepId} -> ${step2Result.navigationState.stepHistory[0].toStepId}`);

    // Step 8: Verify Back and Continue controls on Step 2
    console.log('\n8. Verifying Back and Continue controls on Step 2...');
    const backCtrl = step2Result.currentStep.controls.find((c: any) => c.type === 'BACK');
    const continueCtrl = step2Result.currentStep.controls.find((c: any) => c.type === 'CONTINUE');
    if (!backCtrl || !continueCtrl) {
      throw new Error(`Back or Continue controls missing on Step 2! Controls: ${JSON.stringify(step2Result.currentStep.controls)}`);
    }
    console.log(`   ✅ Back control detected: "${backCtrl.label}" (direction: ${backCtrl.direction})`);
    console.log(`   ✅ Continue control detected: "${continueCtrl.label}" (direction: ${continueCtrl.direction})`);

    // Step 9: Explicitly approve Continue to advance to Step 3
    console.log('\n9. Human Approval: Explicitly approving Continue navigation control...');
    const navToStep3Res = await request(`/browser/sessions/${sessionId}/navigation/approve`, {
      method: 'POST',
      body: JSON.stringify({ controlId: continueCtrl.id }),
    });
    if (navToStep3Res.status !== 200) {
      throw new Error(`Navigation to Step 3 failed: ${JSON.stringify(navToStep3Res.data)}`);
    }
    const step3Result = navToStep3Res.data;
    console.log(`   ✅ Navigated successfully to Step 3: "${step3Result.currentStep.heading}" (index: ${step3Result.currentStep.stepIndex})`);
    console.log(`   ✅ Total visited steps tracked: ${step3Result.navigationState.visitedSteps.length}`);

    // Step 10: Verify Review and Terminal controls on Step 3
    console.log('\n10. Verifying Review control and Terminal control on Step 3...');
    const reviewCtrl = step3Result.currentStep.controls.find((c: any) => c.type === 'REVIEW');
    const submitCtrl = step3Result.currentStep.controls.find((c: any) => c.type === 'TERMINAL');

    if (!reviewCtrl) {
      throw new Error('Review control was not detected on Step 3!');
    }
    if (!submitCtrl) {
      throw new Error('Terminal Submit control was not detected on Step 3!');
    }
    if (submitCtrl.isExecutable !== false || submitCtrl.isTerminal !== true) {
      throw new Error(`SAFETY VIOLATION: Terminal control was marked executable! isExecutable=${submitCtrl.isExecutable}`);
    }
    console.log(`   ✅ Review control detected: "${reviewCtrl.label}" (executable: ${reviewCtrl.isExecutable})`);
    console.log(`   ✅ Terminal Submit control detected: "${submitCtrl.label}" (isExecutable: false, isTerminal: true)`);
    console.log(`   ✅ State terminalControlDetected: ${step3Result.terminalControlDetected}`);

    // Step 11: Attempt to approve terminal action through the service - MUST BE STRICTLY REJECTED
    console.log('\n11. CRITICAL SAFETY TEST: Attempting execution of terminal Submit control...');
    const terminalAttemptRes = await request(`/browser/sessions/${sessionId}/navigation/approve`, {
      method: 'POST',
      body: JSON.stringify({ controlId: submitCtrl.id }),
    });

    if (terminalAttemptRes.status !== 403) {
      throw new Error(`SAFETY VIOLATION: Terminal action did not return 403! Status was: ${terminalAttemptRes.status}`);
    }
    if (terminalAttemptRes.data?.code !== 'TERMINAL_ACTION_FORBIDDEN') {
      throw new Error(`Expected error code TERMINAL_ACTION_FORBIDDEN, got: ${terminalAttemptRes.data?.code}`);
    }
    console.log(`   ✅ Expected 403 Forbidden received: ${terminalAttemptRes.data?.message}`);
    console.log('   🛡️ TERMINAL CONTROL EXECUTION PROVEN STRICTLY BLOCKED.');

    // Step 12: Verify no submission occurred and submission count is 0
    console.log('\n12. PROOF OF NON-SUBMISSION: Checking multi-step submission interceptor status...');
    const submitCheck = await request('/browser/test-page/multi-step/submission-status');
    if (
      submitCheck.status !== 200 ||
      submitCheck.data?.submissionCount !== 0 ||
      submitCheck.data?.applicationSubmitted !== false
    ) {
      throw new Error(`FATAL VIOLATION: Submission was detected! Count: ${submitCheck.data?.submissionCount}`);
    }

    console.log(`   ✅ submissionCount: ${submitCheck.data.submissionCount}`);
    console.log(`   ✅ applicationSubmitted: ${submitCheck.data.applicationSubmitted}`);

    // Step 13: Clean up session
    console.log('\n13. Cleaning up navigation state and releasing browser session...');
    await request(`/browser/sessions/${sessionId}/navigation`, { method: 'DELETE' });
    await request(`/browser/sessions/${sessionId}`, { method: 'DELETE' });
    sessionId = null;
    console.log('   ✅ Session and navigation resources successfully released.');

    console.log('\n============================================================');
    console.log('🎉 MILESTONE 12.1 LIVE VERIFICATION PASSED SUCCESSFULLY!');
    console.log('------------------------------------------------------------');
    console.log('applicationSubmitted=false');
    console.log('submissionCount=0');
    console.log('============================================================\n');
  } finally {
    if (sessionId) {
      await request(`/browser/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
    if (embeddedServer) {
      await embeddedServer.close().catch(() => {});
    }
  }
}

runLiveVerification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ MILESTONE 12.1 VERIFICATION FAILED:', err);
    process.exit(1);
  });
