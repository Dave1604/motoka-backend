#!/usr/bin/env node

/**
 * Email Service Test Script
 * 
 * Tests Resend email sending configuration
 * 
 * Usage:
 *   node scripts/testEmail.js <recipient-email>
 * 
 * Example:
 *   node scripts/testEmail.js test@example.com
 * 
 * Make sure these environment variables are set:
 *   - RESEND_API_KEY
 *   - EMAIL_FROM (optional, defaults to onboarding@resend.dev)
 */

import dotenv from 'dotenv';
import { sendPasswordResetOTP, send2FACode, sendEmail } from '../src/services/email/email.service.js';

// Load environment variables
dotenv.config();

const testEmail = process.argv[2];

if (!testEmail) {
  console.error('❌ Error: No email address provided');
  console.log('\nUsage: node scripts/testEmail.js <recipient-email>');
  console.log('Example: node scripts/testEmail.js test@example.com\n');
  process.exit(1);
}

if (!process.env.RESEND_API_KEY) {
  console.error('❌ Error: RESEND_API_KEY not set in environment variables');
  console.log('\nPlease set RESEND_API_KEY in your .env file or environment\n');
  process.exit(1);
}

console.log('🧪 Testing Resend Email Service\n');
console.log(`📧 Recipient: ${testEmail}`);
console.log(`📤 From: ${process.env.EMAIL_FROM || 'Motoka <onboarding@resend.dev>'}\n`);

async function runTests() {
  let passedTests = 0;
  let failedTests = 0;

  // Test 1: Simple email
  console.log('1️⃣  Testing simple email send...');
  try {
    await sendEmail({
      to: testEmail,
      subject: 'Test Email from Motoka Backend',
      html: '<h1>Test Email</h1><p>If you received this, Resend is working correctly!</p>',
      text: 'Test Email\n\nIf you received this, Resend is working correctly!'
    });
    console.log('   ✅ Simple email sent successfully\n');
    passedTests++;
  } catch (error) {
    console.error('   ❌ Simple email failed:', error.message, '\n');
    failedTests++;
  }

  // Wait 2 seconds between emails to avoid rate limits
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 2: Password reset OTP email
  console.log('2️⃣  Testing password reset OTP email...');
  try {
    const testOTP = '123456';
    await sendPasswordResetOTP({
      to: testEmail,
      otp: testOTP
    });
    console.log('   ✅ Password reset email sent successfully\n');
    passedTests++;
  } catch (error) {
    console.error('   ❌ Password reset email failed:', error.message, '\n');
    failedTests++;
  }

  // Wait 2 seconds
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 3: 2FA code email
  console.log('3️⃣  Testing 2FA code email...');
  try {
    const test2FA = '789012';
    await send2FACode({
      to: testEmail,
      code: test2FA
    });
    console.log('   ✅ 2FA code email sent successfully\n');
    passedTests++;
  } catch (error) {
    console.error('   ❌ 2FA code email failed:', error.message, '\n');
    failedTests++;
  }

  // Summary
  console.log('═══════════════════════════════════════');
  console.log('📊 Test Results:');
  console.log(`   ✅ Passed: ${passedTests}/3`);
  console.log(`   ❌ Failed: ${failedTests}/3`);
  console.log('═══════════════════════════════════════\n');

  if (failedTests === 0) {
    console.log('🎉 All tests passed! Your email service is ready.\n');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Check the errors above.\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});
