# Utilities

## Changes

### Error Sanitizer (`errorSanitizer.js`)
- Removes sensitive data from error messages in production
- Strips stack traces, file paths, API keys, and credentials
- Provides user-friendly error messages

### Retry Utility (`retry.js`)
- Exponential backoff retry mechanism
- Configurable retry attempts and delays
- Smart retry logic (retries 5xx errors, skips 4xx errors)
- Specialized `retryMonicreditRequest` for Monicredit API calls
