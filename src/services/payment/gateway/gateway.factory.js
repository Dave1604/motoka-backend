import { PAYMENT_GATEWAY } from '../../../constants/payment.constants.js';
import { MonicreditAdapter } from '../monicredit/index.js';
import { PaystackAdapter } from '../paystack/paystack.adapter.js';
import { GatewayError } from './gateway.interface.js';

/**
 * Gateway Factory
 * 
 * Creates and returns the appropriate gateway adapter based on the gateway name.
 * This factory pattern allows for easy gateway switching and configuration.
 * 
 * Enhanced with failover support via GatewayManager.
 */
export class GatewayFactory {
  /**
   * Get gateway adapter by name
   * 
   * @param {string} gatewayName - Gateway name ('paystack' or 'monicredit')
   * @returns {Object} Gateway adapter instance
   * @throws {GatewayError} If gateway is not supported
   */
  static getGateway(gatewayName) {
    const normalizedName = gatewayName?.toLowerCase();
    
    switch (normalizedName) {
      case PAYMENT_GATEWAY.PAYSTACK.toLowerCase():
        return PaystackAdapter;
        
      case PAYMENT_GATEWAY.MONICREDIT.toLowerCase():
        return MonicreditAdapter;
        
      default:
        throw new GatewayError(
          `Unsupported payment gateway: ${gatewayName}`,
          400,
          'UNSUPPORTED_GATEWAY'
        );
    }
  }

  /**
   * Get default gateway adapter
   * 
   * @returns {Object} Default gateway adapter instance
   * Defaults to Monicredit to match frontend default
   * Uses gateway manager for failover support
   */
  static async getDefaultGateway() {
    try {
      // Lazy import to avoid circular dependency
      const { gatewayManager } = await import('./gateway-manager.js');
      // Try to get available gateway with failover
      return gatewayManager.getAvailableGateway(PAYMENT_GATEWAY.MONICREDIT);
    } catch (error) {
      // Fallback to direct gateway if manager fails
      return this.getGateway(PAYMENT_GATEWAY.MONICREDIT);
    }
  }

  /**
   * Get gateway adapter with failover support
   * 
   * @param {string} preferredGateway - Preferred gateway name (optional)
   * @returns {Object} Gateway adapter instance
   * @throws {GatewayError} If no gateway is available
   */
  static async getGatewayWithFailover(preferredGateway = null) {
    // Lazy import to avoid circular dependency
    const { gatewayManager } = await import('./gateway-manager.js');
    return gatewayManager.getAvailableGateway(preferredGateway);
  }

  /**
   * Check if gateway is supported
   * 
   * @param {string} gatewayName - Gateway name
   * @returns {boolean} Whether gateway is supported
   */
  static isSupported(gatewayName) {
    try {
      this.getGateway(gatewayName);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get list of supported gateways
   * 
   * @returns {string[]} List of supported gateway names
   */
  static getSupportedGateways() {
    return [
      PAYMENT_GATEWAY.PAYSTACK,
      PAYMENT_GATEWAY.MONICREDIT
    ];
  }
}
