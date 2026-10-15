/**
 * Milestone 10.1 Live Verification Script
 * Validates Playwright Browser Automation Foundation endpoints on running API container
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

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
  console.log('🚀 STARTING MILESTONE 10.1 LIVE VERIFICATION');
  console.log(`Target API: ${BASE_URL}`);
  console.log('============================================================\n');

  // Step 1: Health check verification
  console.log('1. Verifying /health endpoint reporting...');
  const healthRes = await request('/health');
  if (healthRes.status !== 200 || !healthRes.data?.browser?.enabled) {
    throw new Error(`Health check failed: ${JSON.stringify(healthRes.data)}`);
  }
  console.log('   ✅ Health OK:', JSON.stringify(healthRes.data));

  // Step 2: Test fixture page verification
  console.log('\n2. Verifying deterministic local test fixture...');
  const fixtureRes = await fetch(`${BASE_URL}/browser/test-page`);
  const fixtureHtml = await fixtureRes.text();
  if (fixtureRes.status !== 200 || !fixtureHtml.includes('Deterministic Browser Fixture')) {
    throw new Error(`Test fixture page check failed: status ${fixtureRes.status}`);
  }
  console.log('   ✅ Local HTML fixture served correctly (offline deterministic testing available)');

  // Step 3: Create browser session
  console.log('\n3. Creating isolated browser session...');
  const sessionRes = await request('/browser/sessions', { method: 'POST' });
  if (sessionRes.status !== 201 || !sessionRes.data?.sessionId) {
    throw new Error(`Session creation failed: ${JSON.stringify(sessionRes.data)}`);
  }
  const sessionId = sessionRes.data.sessionId;
  console.log(`   ✅ Browser session created: ${sessionId} (Status: ${sessionRes.data.status})`);

  // Step 4: Get session details (should be IDLE)
  console.log('\n4. Checking session details prior to navigation...');
  const getInitialRes = await request(`/browser/sessions/${sessionId}`);
  if (getInitialRes.status !== 200 || getInitialRes.data.status !== 'IDLE') {
    throw new Error(`Initial session check failed: ${JSON.stringify(getInitialRes.data)}`);
  }
  console.log('   ✅ Session verified in IDLE state with no URL loaded');

  // Step 5: Test invalid URL rejection (javascript:, file:)
  console.log('\n5. Testing URL protocol safety safeguards...');
  const jsReject = await request(`/browser/sessions/${sessionId}/navigate`, {
    method: 'POST',
    body: JSON.stringify({ url: 'javascript:alert(1)' }),
  });
  if (jsReject.status !== 400 || !jsReject.data?.message?.includes('javascript:')) {
    throw new Error(`Failed to reject javascript: scheme: ${JSON.stringify(jsReject.data)}`);
  }
  console.log('   ✅ Rejected javascript: scheme with 400 Bad Request');

  const fileReject = await request(`/browser/sessions/${sessionId}/navigate`, {
    method: 'POST',
    body: JSON.stringify({ url: 'file:///etc/passwd' }),
  });
  if (fileReject.status !== 400 || !fileReject.data?.message?.includes('file:')) {
    throw new Error(`Failed to reject file: scheme: ${JSON.stringify(fileReject.data)}`);
  }
  console.log('   ✅ Rejected file: scheme with 400 Bad Request');

  // Step 6: Navigate to safe local fixture page
  console.log('\n6. Navigating to local deterministic test page...');
  const navRes = await request(`/browser/sessions/${sessionId}/navigate`, {
    method: 'POST',
    body: JSON.stringify({ url: `${BASE_URL}/browser/test-page` }),
  });
  if (navRes.status !== 200 || navRes.data?.title !== 'Browser Test Fixture') {
    throw new Error(`Navigation failed: ${JSON.stringify(navRes.data)}`);
  }
  console.log('   ✅ Navigated successfully. Page Title:', navRes.data.title, '| HTTP Status:', navRes.data.status);

  // Step 7: Inspect page structure
  console.log('\n7. Inspecting page structure (forms, inputs, buttons, links)...');
  const inspectRes = await request(`/browser/sessions/${sessionId}/inspect`);
  if (inspectRes.status !== 200 || inspectRes.data.forms !== 1 || inspectRes.data.inputs !== 2) {
    throw new Error(`Inspection failed: ${JSON.stringify(inspectRes.data)}`);
  }
  console.log('   ✅ Inspection diagnostic counts:', JSON.stringify(inspectRes.data));

  // Step 8: Capture screenshot
  console.log('\n8. Capturing page screenshot...');
  const screenshotRes = await request(`/browser/sessions/${sessionId}/screenshot`, {
    method: 'POST',
  });
  if (screenshotRes.status !== 201 || !screenshotRes.data?.screenshotId) {
    throw new Error(`Screenshot capture failed: ${JSON.stringify(screenshotRes.data)}`);
  }
  console.log('   ✅ Screenshot captured successfully:', screenshotRes.data.path);

  // Step 9: Get updated session info
  console.log('\n9. Verifying updated active session info...');
  const updatedRes = await request(`/browser/sessions/${sessionId}`);
  if (updatedRes.status !== 200 || updatedRes.data.status !== 'ACTIVE') {
    throw new Error(`Updated session check failed: ${JSON.stringify(updatedRes.data)}`);
  }
  console.log('   ✅ Session status is ACTIVE, currentUrl:', updatedRes.data.currentUrl);

  // Step 10: Close session
  console.log('\n10. Closing browser session and releasing resources...');
  const closeRes = await request(`/browser/sessions/${sessionId}`, { method: 'DELETE' });
  if (closeRes.status !== 200 || !closeRes.data.success) {
    throw new Error(`Session deletion failed: ${JSON.stringify(closeRes.data)}`);
  }
  console.log('   ✅ Session closed successfully. Resource handles released.');

  // Step 11: Verify 404 on deleted session
  console.log('\n11. Verifying session is no longer accessible...');
  const deletedCheck = await request(`/browser/sessions/${sessionId}`);
  if (deletedCheck.status !== 404) {
    throw new Error(`Deleted session still returned: ${deletedCheck.status}`);
  }
  console.log('   ✅ Confirmed: Session returned 404 Not Found after deletion.');

  console.log('\n============================================================');
  console.log('🎉 ALL LIVE VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  console.log('============================================================\n');
}

runLiveVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
