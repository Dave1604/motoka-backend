import { logWarn, logError, logDebug } from './logger.js';

const DEFAULT_MAX_RETRIES = parseInt(process.env.MONICREDIT_MAX_RETRIES || '3', 10);
const DEFAULT_INITIAL_DELAY_MS = parseInt(process.env.MONICREDIT_RETRY_INITIAL_DELAY_MS || '1000', 10);
const DEFAULT_MAX_DELAY_MS = 10000; // 10 seconds max delay
const DEFAULT_BACKOFF_MULTIPLIER = 2;

function shouldRetry(error) {
  if (error.statusCode >= 400 && error.statusCode < 500) {
    return false;
  }
  
  if (error.statusCode >= 500) {
    return true;
  }
  
  if (error.code === 'REQUEST_TIMEOUT' || error.name === 'AbortError') {
    return true;
  }
  
  if (error.code === 'REQUEST_FAILED' || error.message.includes('fetch')) {
    return true;
  }
  
  if (error.code === 'VALIDATION_ERROR' || error.code === 'CONFIG_ERROR') {
    return false;
  }
  
  return true;
}

function calculateDelay(attemptNumber, initialDelay, maxDelay, multiplier) {
  const delay = initialDelay * Math.pow(multiplier, attemptNumber);
  return Math.min(delay, maxDelay);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelay = DEFAULT_INITIAL_DELAY_MS,
    maxDelay = DEFAULT_MAX_DELAY_MS,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    shouldRetry: customShouldRetry = shouldRetry,
    context = 'Operation'
  } = options;

  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      
      if (attempt > 0) {
        logDebug(`${context} succeeded after ${attempt} retry attempts`, {
          attempt,
          maxRetries
        });
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      if (!customShouldRetry(error)) {
        logDebug(`${context} failed with non-retryable error`, {
          error: error.message,
          code: error.code,
          statusCode: error.statusCode
        });
        throw error;
      }
      
      if (attempt >= maxRetries) {
        logError(`${context} failed after ${maxRetries} retry attempts`, {
          error: error.message,
          code: error.code,
          statusCode: error.statusCode,
          attempts: attempt + 1,
          maxRetries
        });
        throw error;
      }
      
      const delay = calculateDelay(attempt, initialDelay, maxDelay, backoffMultiplier);
      
      logWarn(`${context} failed, retrying`, {
        attempt: attempt + 1,
        maxRetries,
        delay_ms: delay,
        error: error.message,
        code: error.code,
        statusCode: error.statusCode
      });
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

export async function retryMonicreditRequest(apiCall, operation) {
  return retryWithBackoff(apiCall, {
    maxRetries: DEFAULT_MAX_RETRIES,
    initialDelay: DEFAULT_INITIAL_DELAY_MS,
    maxDelay: DEFAULT_MAX_DELAY_MS,
    context: `Monicredit ${operation}`
  });
}

export default {
  retryWithBackoff,
  retryMonicreditRequest
};
