import { logInfo, logWarn, logDebug } from '../../utils/logger.js';

class PaymentMetricsService {
  constructor() {
    this.metrics = {
      transactions: {
        total: 0,
        successful: 0,
        failed: 0,
        pending: 0,
        abandoned: 0
      },
      
      amounts: {
        total: 0,
        successful: 0,
        failed: 0,
        min: null,
        max: null,
        average: 0
      },
      
      processingTimes: {
        initialization: [],
        verification: [],
        webhook: []
      },
      
      gateways: {
        paystack: {
          total: 0,
          successful: 0,
          failed: 0
        },
        monipay: {
          total: 0,
          successful: 0,
          failed: 0
        },
        monicredit: {
          total: 0,
          successful: 0,
          failed: 0
        }
      },
      
      webhooks: {
        received: 0,
        processed: 0,
        failed: 0,
        signatureVerified: 0,
        signatureFailed: 0,
        duplicate: 0
      },
      
      amountValidation: {
        total: 0,
        mismatches: 0,
        rejected: 0
      },
      
      errors: {
        timeout: 0,
        network: 0,
        api: 0,
        validation: 0,
        other: 0
      },
      
      retries: {
        total: 0,
        successful: 0,
        failed: 0
      },
      
      firstTransaction: null,
      lastTransaction: null
    };
  }

  trackInitialization({ gateway, amount, processingTime }) {
    this.metrics.transactions.total++;
    this.metrics.transactions.pending++;
    
    if (gateway) {
      this.metrics.gateways[gateway] = this.metrics.gateways[gateway] || {
        total: 0,
        successful: 0,
        failed: 0
      };
      this.metrics.gateways[gateway].total++;
    }
    
    if (processingTime !== undefined) {
      this.metrics.processingTimes.initialization.push(processingTime);
      if (this.metrics.processingTimes.initialization.length > 1000) {
        this.metrics.processingTimes.initialization.shift();
      }
    }
    
    this._updateTimestamps();
  }

  trackSuccess({ gateway, amount, processingTime }) {
    this.metrics.transactions.successful++;
    this.metrics.transactions.pending = Math.max(0, this.metrics.transactions.pending - 1);
    
    if (gateway) {
      this.metrics.gateways[gateway].successful++;
    }
    
    if (amount !== undefined) {
      this.metrics.amounts.successful += amount;
      this.metrics.amounts.total += amount;
      
      if (this.metrics.amounts.min === null || amount < this.metrics.amounts.min) {
        this.metrics.amounts.min = amount;
      }
      if (this.metrics.amounts.max === null || amount > this.metrics.amounts.max) {
        this.metrics.amounts.max = amount;
      }
      
      this._updateAverageAmount();
    }
    
    if (processingTime !== undefined) {
      this.metrics.processingTimes.verification.push(processingTime);
      if (this.metrics.processingTimes.verification.length > 1000) {
        this.metrics.processingTimes.verification.shift();
      }
    }
  }

  /**
   * Track failed payment
   * @param {Object} data - Failure data
   * @param {string} data.gateway - Payment gateway
   * @param {number} data.amount - Amount in kobo
   * @param {string} data.errorType - Error type (timeout, network, api, validation, other)
   */
  trackFailure({ gateway, amount, errorType = 'other' }) {
    this.metrics.transactions.failed++;
    this.metrics.transactions.pending = Math.max(0, this.metrics.transactions.pending - 1);
    
    if (gateway) {
      this.metrics.gateways[gateway] = this.metrics.gateways[gateway] || {
        total: 0,
        successful: 0,
        failed: 0
      };
      this.metrics.gateways[gateway].failed++;
    }
    
    if (amount !== undefined) {
      this.metrics.amounts.failed += amount;
    }
    
    if (errorType && this.metrics.errors[errorType] !== undefined) {
      this.metrics.errors[errorType]++;
    }
  }

  trackWebhook({ signatureVerified, isDuplicate, processingTime }) {
    this.metrics.webhooks.received++;
    
    if (isDuplicate) {
      this.metrics.webhooks.duplicate++;
      return;
    }
    
    if (signatureVerified) {
      this.metrics.webhooks.signatureVerified++;
    } else {
      this.metrics.webhooks.signatureFailed++;
    }
    
    if (processingTime !== undefined) {
      this.metrics.processingTimes.webhook.push(processingTime);
      if (this.metrics.processingTimes.webhook.length > 1000) {
        this.metrics.processingTimes.webhook.shift();
      }
    }
  }

  trackWebhookSuccess() {
    this.metrics.webhooks.processed++;
  }

  trackWebhookFailure() {
    this.metrics.webhooks.failed++;
  }

  trackAmountValidation({ mismatch, rejected }) {
    this.metrics.amountValidation.total++;
    
    if (mismatch) {
      this.metrics.amountValidation.mismatches++;
    }
    
    if (rejected) {
      this.metrics.amountValidation.rejected++;
    }
  }

  trackRetry({ successful }) {
    this.metrics.retries.total++;
    
    if (successful) {
      this.metrics.retries.successful++;
    } else {
      this.metrics.retries.failed++;
    }
  }

  trackAbandoned() {
    this.metrics.transactions.abandoned++;
    this.metrics.transactions.pending = Math.max(0, this.metrics.transactions.pending - 1);
  }

  getAverageProcessingTime(type) {
    const times = this.metrics.processingTimes[type] || [];
    if (times.length === 0) return 0;
    
    const sum = times.reduce((acc, time) => acc + time, 0);
    return Math.round(sum / times.length);
  }

  getSuccessRate() {
    const total = this.metrics.transactions.successful + this.metrics.transactions.failed;
    if (total === 0) return 0;
    
    return Math.round((this.metrics.transactions.successful / total) * 100);
  }

  getGatewaySuccessRate(gateway) {
    const gatewayMetrics = this.metrics.gateways[gateway];
    if (!gatewayMetrics) return 0;
    
    const total = gatewayMetrics.successful + gatewayMetrics.failed;
    if (total === 0) return 0;
    
    return Math.round((gatewayMetrics.successful / total) * 100);
  }

  getWebhookSuccessRate() {
    const total = this.metrics.webhooks.processed + this.metrics.webhooks.failed;
    if (total === 0) return 0;
    
    return Math.round((this.metrics.webhooks.processed / total) * 100);
  }

  _updateAverageAmount() {
    const totalTransactions = this.metrics.transactions.successful;
    if (totalTransactions === 0) {
      this.metrics.amounts.average = 0;
      return;
    }
    
    this.metrics.amounts.average = Math.round(this.metrics.amounts.successful / totalTransactions);
  }

  _updateTimestamps() {
    const now = new Date().toISOString();
    
    if (!this.metrics.firstTransaction) {
      this.metrics.firstTransaction = now;
    }
    
    this.metrics.lastTransaction = now;
  }

  getSnapshot() {
    return {
      ...this.metrics,
      calculated: {
        successRate: this.getSuccessRate(),
        paystackSuccessRate: this.getGatewaySuccessRate('paystack'),
        monipaySuccessRate: this.getGatewaySuccessRate('monipay'),
        monicreditSuccessRate: this.getGatewaySuccessRate('monicredit'),
        webhookSuccessRate: this.getWebhookSuccessRate(),
        averageInitializationTime: this.getAverageProcessingTime('initialization'),
        averageVerificationTime: this.getAverageProcessingTime('verification'),
        averageWebhookTime: this.getAverageProcessingTime('webhook')
      }
    };
  }

  reset() {
    this.metrics = new PaymentMetricsService().metrics;
  }
}

export const paymentMetrics = new PaymentMetricsService();

export default paymentMetrics;
