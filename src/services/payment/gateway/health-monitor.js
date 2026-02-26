import { logInfo, logWarn, logError, logDebug } from '../../../utils/logger.js';
import { PAYMENT_GATEWAY } from '../../../constants/payment.constants.js';
import { GatewayFactory } from './gateway.factory.js';

class HealthMonitor {
  constructor() {
    this.healthMetrics = new Map();
    this.healthCheckInterval = null;
    this.checkIntervalMs = parseInt(process.env.GATEWAY_HEALTH_CHECK_INTERVAL_MS || '30000', 10);
    this.isRunning = false;
    this.initializeMetrics();
  }

  initializeMetrics() {
    const gateways = GatewayFactory.getSupportedGateways();
    
    gateways.forEach(gatewayName => {
      this.healthMetrics.set(gatewayName, {
        gateway: gatewayName,
        status: 'unknown',
        lastCheck: null,
        lastSuccess: null,
        lastFailure: null,
        responseTime: null,
        averageResponseTime: null,
        successCount: 0,
        failureCount: 0,
        totalChecks: 0,
        successRate: 0,
        errorRate: 0,
        consecutiveFailures: 0,
        uptime: 100,
        errors: []
      });
    });
  }

  start() {
    if (this.isRunning) {
      logWarn('[Health Monitor] Already running');
      return;
    }

    logInfo('[Health Monitor] Starting health checks', {
      intervalMs: this.checkIntervalMs,
      gateways: Array.from(this.healthMetrics.keys())
    });

    this.isRunning = true;
    this.performHealthChecks();
    
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.checkIntervalMs);
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    logInfo('[Health Monitor] Stopping health checks');
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    this.isRunning = false;
  }

  async performHealthChecks() {
    const gateways = GatewayFactory.getSupportedGateways();
    
    const checks = gateways.map(gatewayName => 
      this.checkGatewayHealth(gatewayName).catch(error => {
        logError('[Health Monitor] Health check failed', {
          gateway: gatewayName,
          error: error.message
        });
        return null;
      })
    );

    await Promise.allSettled(checks);
  }

  async checkGatewayHealth(gatewayName) {
    const metrics = this.healthMetrics.get(gatewayName);
    if (!metrics) {
      logWarn('[Health Monitor] Unknown gateway', { gateway: gatewayName });
      return null;
    }

    const startTime = Date.now();
    let success = false;
    let error = null;

    try {
      const GatewayAdapter = GatewayFactory.getGateway(gatewayName);
      success = true;
      
      const responseTime = Date.now() - startTime;
      
      this.updateMetrics(gatewayName, {
        success: true,
        responseTime,
        error: null
      });

      logDebug('[Health Monitor] Health check successful', {
        gateway: gatewayName,
        responseTime
      });

      return {
        gateway: gatewayName,
        healthy: true,
        responseTime
      };
    } catch (err) {
      const responseTime = Date.now() - startTime;
      error = err;
      
      this.updateMetrics(gatewayName, {
        success: false,
        responseTime,
        error: {
          message: err.message,
          code: err.code || 'HEALTH_CHECK_FAILED',
          timestamp: new Date().toISOString()
        }
      });

      logWarn('[Health Monitor] Health check failed', {
        gateway: gatewayName,
        error: err.message,
        responseTime
      });

      return {
        gateway: gatewayName,
        healthy: false,
        responseTime,
        error: err.message
      };
    }
  }

  updateMetrics(gatewayName, result) {
    const metrics = this.healthMetrics.get(gatewayName);
    if (!metrics) return;

    const { success, responseTime, error } = result;

    metrics.lastCheck = new Date().toISOString();
    metrics.totalChecks += 1;
    metrics.responseTime = responseTime;

    if (success) {
      metrics.lastSuccess = new Date().toISOString();
      metrics.successCount += 1;
      metrics.consecutiveFailures = 0;
    } else {
      metrics.lastFailure = new Date().toISOString();
      metrics.failureCount += 1;
      metrics.consecutiveFailures += 1;
      
      if (error) {
        metrics.errors.push(error);
        if (metrics.errors.length > 10) {
          metrics.errors.shift();
        }
      }
    }

    metrics.successRate = metrics.totalChecks > 0 
      ? (metrics.successCount / metrics.totalChecks) * 100 
      : 0;
    metrics.errorRate = metrics.totalChecks > 0 
      ? (metrics.failureCount / metrics.totalChecks) * 100 
      : 0;

    if (metrics.averageResponseTime === null) {
      metrics.averageResponseTime = responseTime;
    } else {
      metrics.averageResponseTime = (metrics.averageResponseTime * 0.7) + (responseTime * 0.3);
    }

    metrics.uptime = metrics.successRate;

    if (metrics.consecutiveFailures >= 5) {
      metrics.status = 'unhealthy';
    } else if (metrics.consecutiveFailures >= 2 || metrics.successRate < 80) {
      metrics.status = 'degraded';
    } else if (metrics.successRate >= 95 && metrics.consecutiveFailures === 0) {
      metrics.status = 'healthy';
    } else {
      metrics.status = 'degraded';
    }

    this.healthMetrics.set(gatewayName, metrics);
  }

  getGatewayHealth(gatewayName) {
    return this.healthMetrics.get(gatewayName) || null;
  }

  getAllGatewayHealth() {
    const result = {};
    this.healthMetrics.forEach((metrics, gatewayName) => {
      result[gatewayName] = { ...metrics };
    });
    return result;
  }

  isHealthy(gatewayName) {
    const metrics = this.healthMetrics.get(gatewayName);
    if (!metrics) return false;
    
    return metrics.status === 'healthy' || metrics.status === 'degraded';
  }

  recordOperation(gatewayName, success, responseTime, error = null) {
    this.updateMetrics(gatewayName, {
      success,
      responseTime,
      error: error ? {
        message: error.message,
        code: error.code || 'OPERATION_FAILED',
        timestamp: new Date().toISOString()
      } : null
    });
  }

  resetMetrics(gatewayName) {
    const metrics = this.healthMetrics.get(gatewayName);
    if (metrics) {
      this.initializeMetrics();
      logInfo('[Health Monitor] Metrics reset', { gateway: gatewayName });
    }
  }
}

export const healthMonitor = new HealthMonitor();

if (process.env.NODE_ENV === 'production') {
  setTimeout(() => {
    healthMonitor.start();
  }, 5000);
}
