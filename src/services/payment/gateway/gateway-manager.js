import { logInfo, logWarn, logError, logDebug } from '../../../utils/logger.js';
import { PAYMENT_GATEWAY } from '../../../constants/payment.constants.js';
import { GatewayFactory } from './gateway.factory.js';
import { healthMonitor } from './health-monitor.js';
import { GatewayError } from './gateway.interface.js';

class GatewayManager {
  constructor() {
    this.primaryGateway = process.env.PRIMARY_GATEWAY?.toLowerCase() || PAYMENT_GATEWAY.MONICREDIT;
    this.fallbackGateway = process.env.FALLBACK_GATEWAY?.toLowerCase() || PAYMENT_GATEWAY.PAYSTACK;
    this.circuitBreakerThreshold = parseInt(process.env.GATEWAY_CIRCUIT_BREAKER_THRESHOLD || '5', 10);
    this.circuitBreakerTimeout = parseInt(process.env.GATEWAY_CIRCUIT_BREAKER_TIMEOUT_MS || '60000', 10);
    this.circuitBreakers = new Map();
    this.initializeCircuitBreakers();
    
    if (!healthMonitor.isRunning) {
      healthMonitor.start();
    }
  }

  initializeCircuitBreakers() {
    const gateways = GatewayFactory.getSupportedGateways();
    
    gateways.forEach(gatewayName => {
      this.circuitBreakers.set(gatewayName, {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null
      });
    });
  }

  getAvailableGateway(preferredGateway = null) {
    if (preferredGateway) {
      const normalized = preferredGateway.toLowerCase();
      if (this.isGatewayAvailable(normalized)) {
        logDebug('[Gateway Manager] Using preferred gateway', { gateway: normalized });
        return GatewayFactory.getGateway(normalized);
      } else {
        logWarn('[Gateway Manager] Preferred gateway unavailable, attempting failover', {
          preferred: normalized,
          reason: this.getUnavailabilityReason(normalized)
        });
      }
    }

    if (this.isGatewayAvailable(this.primaryGateway)) {
      logDebug('[Gateway Manager] Using primary gateway', { gateway: this.primaryGateway });
      return GatewayFactory.getGateway(this.primaryGateway);
    }

    if (this.isGatewayAvailable(this.fallbackGateway)) {
      logWarn('[Gateway Manager] Primary gateway unavailable, using fallback', {
        primary: this.primaryGateway,
        fallback: this.fallbackGateway,
        reason: this.getUnavailabilityReason(this.primaryGateway)
      });
      return GatewayFactory.getGateway(this.fallbackGateway);
    }

    const error = new GatewayError(
      'No payment gateway is currently available. Please try again later.',
      503,
      'NO_GATEWAY_AVAILABLE'
    );
    
    logError('[Gateway Manager] No gateway available', {
      primary: this.primaryGateway,
      fallback: this.fallbackGateway,
      primaryReason: this.getUnavailabilityReason(this.primaryGateway),
      fallbackReason: this.getUnavailabilityReason(this.fallbackGateway)
    });
    
    throw error;
  }

  isGatewayAvailable(gatewayName) {
    const normalized = gatewayName?.toLowerCase();
    
    if (!GatewayFactory.isSupported(normalized)) {
      return false;
    }

    const circuitBreaker = this.circuitBreakers.get(normalized);
    if (!circuitBreaker) {
      return false;
    }

    if (circuitBreaker.state === 'open') {
      const now = Date.now();
      if (circuitBreaker.nextAttemptTime && now >= circuitBreaker.nextAttemptTime) {
        circuitBreaker.state = 'half-open';
        circuitBreaker.nextAttemptTime = null;
        logInfo('[Gateway Manager] Circuit breaker half-open', { gateway: normalized });
      } else {
        return false;
      }
    }

    const health = healthMonitor.getGatewayHealth(normalized);
    if (!health) {
      return true;
    }

    return health.status === 'healthy' || health.status === 'degraded';
  }

  getUnavailabilityReason(gatewayName) {
    const normalized = gatewayName?.toLowerCase();
    const circuitBreaker = this.circuitBreakers.get(normalized);
    const health = healthMonitor.getGatewayHealth(normalized);

    if (!GatewayFactory.isSupported(normalized)) {
      return 'Gateway not supported';
    }

    if (circuitBreaker?.state === 'open') {
      return `Circuit breaker open (${circuitBreaker.failureCount} failures)`;
    }

    if (health?.status === 'unhealthy') {
      return `Gateway unhealthy (${health.consecutiveFailures} consecutive failures)`;
    }

    return 'Unknown reason';
  }

  recordSuccess(gatewayName, responseTime) {
    const normalized = gatewayName?.toLowerCase();
    const circuitBreaker = this.circuitBreakers.get(normalized);
    
    if (circuitBreaker) {
      if (circuitBreaker.state === 'half-open') {
        circuitBreaker.state = 'closed';
        logInfo('[Gateway Manager] Circuit breaker closed after success', { gateway: normalized });
      }
      circuitBreaker.failureCount = 0;
      circuitBreaker.lastFailureTime = null;
      circuitBreaker.nextAttemptTime = null;
    }

    healthMonitor.recordOperation(normalized, true, responseTime);
  }

  recordFailure(gatewayName, error, responseTime) {
    const normalized = gatewayName?.toLowerCase();
    const circuitBreaker = this.circuitBreakers.get(normalized);
    
    if (circuitBreaker) {
      circuitBreaker.failureCount += 1;
      circuitBreaker.lastFailureTime = Date.now();

      if (circuitBreaker.failureCount >= this.circuitBreakerThreshold) {
        if (circuitBreaker.state !== 'open') {
          circuitBreaker.state = 'open';
          circuitBreaker.nextAttemptTime = Date.now() + this.circuitBreakerTimeout;
          
          logWarn('[Gateway Manager] Circuit breaker opened', {
            gateway: normalized,
            failureCount: circuitBreaker.failureCount,
            threshold: this.circuitBreakerThreshold,
            nextAttemptTime: new Date(circuitBreaker.nextAttemptTime).toISOString()
          });
        }
      }
    }

    healthMonitor.recordOperation(normalized, false, responseTime, error);
  }

  getGatewayWithFailover(preferredGateway = null) {
    return this.getAvailableGateway(preferredGateway);
  }

  getPrimaryGateway() {
    return this.primaryGateway;
  }

  getFallbackGateway() {
    return this.fallbackGateway;
  }

  getCircuitBreakerStatus() {
    const status = {};
    this.circuitBreakers.forEach((breaker, gatewayName) => {
      status[gatewayName] = {
        state: breaker.state,
        failureCount: breaker.failureCount,
        lastFailureTime: breaker.lastFailureTime,
        nextAttemptTime: breaker.nextAttemptTime,
        threshold: this.circuitBreakerThreshold,
        timeout: this.circuitBreakerTimeout
      };
    });
    return status;
  }

  resetCircuitBreaker(gatewayName) {
    const normalized = gatewayName?.toLowerCase();
    const circuitBreaker = this.circuitBreakers.get(normalized);
    
    if (circuitBreaker) {
      circuitBreaker.state = 'closed';
      circuitBreaker.failureCount = 0;
      circuitBreaker.lastFailureTime = null;
      circuitBreaker.nextAttemptTime = null;
      
      logInfo('[Gateway Manager] Circuit breaker manually reset', { gateway: normalized });
    }
  }

  getStatistics() {
    const stats = {
      primary: this.primaryGateway,
      fallback: this.fallbackGateway,
      circuitBreakers: this.getCircuitBreakerStatus(),
      health: healthMonitor.getAllGatewayHealth()
    };

    return stats;
  }
}

export const gatewayManager = new GatewayManager();
