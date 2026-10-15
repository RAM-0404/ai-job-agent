import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../db/prisma.js';
import {
  getCurrentProfile,
  updateOrCreateProfile,
} from './profile.service.js';

describe('ProfileService', () => {
  before(async () => {
    // Clean up test profile before testing
    await prisma.userProfile.deleteMany({
      where: {
        email: {
          contains: 'profile-test-',
        },
      },
    });
  });

  after(async () => {
    // Clean up test profile created during testing
    await prisma.userProfile.deleteMany({
      where: {
        email: {
          contains: 'profile-test-',
        },
      },
    });
  });

  test('creates a new profile if none exists', async () => {
    const testEmail = `profile-test-${Date.now()}@example.com`;
    const created = await updateOrCreateProfile({
      fullName: 'Alice Test',
      email: testEmail,
      currentTitle: 'Lead Architect',
      yearsOfExperience: 8,
      professionalSummary: 'Experienced software engineer.',
    });

    assert.equal(created.fullName, 'Alice Test');
    assert.equal(created.email, testEmail);
    assert.equal(created.currentTitle, 'Lead Architect');
    assert.equal(created.yearsOfExperience, 8);

    const retrieved = await getCurrentProfile();
    assert.ok(retrieved);
    assert.equal(retrieved.fullName, 'Alice Test');
  });

  test('updates an existing profile', async () => {
    const updated = await updateOrCreateProfile({
      fullName: 'Alice Updated',
      email: 'profile-test-updated@example.com',
      currentTitle: 'Principal Architect',
      yearsOfExperience: 10,
    });

    assert.equal(updated.fullName, 'Alice Updated');
    assert.equal(updated.currentTitle, 'Principal Architect');
    assert.equal(updated.yearsOfExperience, 10);
  });
});
