import { PAYMENT_GATEWAY } from '../../../constants/payment.constants.js';
import { GatewayFactory } from './gateway.factory.js';
import { healthMonitor } from './health-monitor.js';

const GATEWAY_ENV_KEYS = {
  [PAYMENT_GATEWAY.PAYSTACK]: ['PAYSTACK_SECRET_KEY', 'PAYSTACK_PUBLIC_KEY'],
  [PAYMENT_GATEWAY.MONIPAY]: ['MONIPAY_SECRET_KEY']
};

class GatewayManager {
  constructor() {
    this.primaryGateway = process.env.PRIMARY_GATEWAY?.toLowerCase() || PAYMENT_GATEWAY.MONIPAY;
    this.fallbackGateway = process.env.FALLBACK_GATEWAY?.toLowerCase() || PAYMENT_GATEWAY.PAYSTACK;
  }

  isGatewayAvailable(gatewayName) {
    const normalized = gatewayName?.toLowerCase();

    if (!GatewayFactory.isSupported(normalized)) {
      return false;
    }

    const requiredKeys = GATEWAY_ENV_KEYS[normalized];
    if (!requiredKeys) {
      return true;
    }

    return requiredKeys.every(key => !!process.env[key]);
  }

  getUnavailabilityReason(gatewayName) {
    const normalized = gatewayName?.toLowerCase();

    if (!GatewayFactory.isSupported(normalized)) {
      return 'Gateway not supported';
    }

    const missingKeys = (GATEWAY_ENV_KEYS[normalized] || []).filter(key => !process.env[key]);
    if (missingKeys.length > 0) {
      return `Missing configuration: ${missingKeys.join(', ')}`;
    }

    return 'Unknown reason';
  }

  getPrimaryGateway() {
    return this.primaryGateway;
  }

  getFallbackGateway() {
    return this.fallbackGateway;
  }

  getCircuitBreakerStatus() {
    return {};
  }

  getStatistics() {
    return {
      primary: this.primaryGateway,
      fallback: this.fallbackGateway,
      circuitBreakers: this.getCircuitBreakerStatus(),
      health: healthMonitor.getAllGatewayHealth()
    };
  }
}

export const gatewayManager = new GatewayManager();
