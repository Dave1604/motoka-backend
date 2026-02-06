/**
 * STRUCTURED LOGGING
 * 
 * Provides consistent logging with execution context.
 * All logs are output as JSON for easy parsing and monitoring.
 */

import { CONFIG } from './config.ts';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  executionId: string;
  message: string;
  [key: string]: any;
}

class Logger {
  private executionId: string = '';

  setExecutionId(id: string) {
    this.executionId = id;
  }

  info(message: string, meta: Record<string, any> = {}) {
    this.log('INFO', message, meta);
  }

  warn(message: string, meta: Record<string, any> = {}) {
    this.log('WARN', message, meta);
  }

  error(message: string, meta: Record<string, any> = {}) {
    this.log('ERROR', message, meta);
  }

  debug(message: string, meta: Record<string, any> = {}) {
    if (CONFIG.LOG_LEVEL === 'debug') {
      this.log('DEBUG', message, meta);
    }
  }

  private log(level: LogLevel, message: string, meta: Record<string, any>) {
    const timestamp = new Date().toISOString();
    
    const entry: LogEntry = {
      timestamp,
      level,
      executionId: this.executionId,
      message,
      ...meta,
    };

    console.log(JSON.stringify(entry));
  }
}

export const logger = new Logger();
