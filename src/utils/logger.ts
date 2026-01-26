import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

interface LoggerConfig {
  logFile?: string;
  logLevel?: string;
  enableConsole?: boolean;
}

class Logger {
  private static instance: winston.Logger | null = null;
  private static config: LoggerConfig = {};

  static initialize(config: LoggerConfig = {}): void {
    Logger.config = config;
    Logger.instance = Logger.createLogger();
  }

  private static createLogger(): winston.Logger {
    const { logFile, logLevel = 'info', enableConsole = false } = Logger.config;

    const transports: winston.transport[] = [];

    // 1. File transports (if logFile is specified)
    if (logFile) {
      const logDir = path.dirname(logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const baseFileName = path.basename(logFile, path.extname(logFile));

      transports.push(
        new DailyRotateFile({
          filename: path.join(logDir, `${baseFileName}-%DATE%.log`),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          level: logLevel,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
          )
        })
      );

      transports.push(
        new DailyRotateFile({
          filename: path.join(logDir, `${baseFileName}-error-%DATE%.log`),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '30d',
          level: 'error',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
          )
        })
      );
    }

    // 2. Console transport
    // Always log to console if enableConsole is true OR if no logFile is specified
    if (enableConsole || !logFile) {
      transports.push(
        new winston.transports.Console({
          level: logLevel,
          format: enableConsole
            ? winston.format.combine(
              winston.format.colorize(),
              winston.format.timestamp({ format: 'HH:mm:ss' }),
              winston.format.printf(({ timestamp, level, message, ...meta }) => {
                let log = `${timestamp} [${level}]: ${message}`;
                if (Object.keys(meta).length > 0) {
                  log += ` ${JSON.stringify(meta)}`;
                }
                return log;
              })
            )
            : winston.format.combine(
              winston.format.timestamp(),
              winston.format.errors({ stack: true }),
              winston.format.printf(({ timestamp, level, message, ...meta }) => {
                let log = `${timestamp} [kg-mcp] [${level}] ${message}`;
                if (Object.keys(meta).length > 0) {
                  log += ` ${JSON.stringify(meta)}`;
                }
                return log;
              })
            )
        })
      );
    }

    return winston.createLogger({
      level: logLevel,
      transports,
      exitOnError: false,
      silent: false
    });
  }

  static getLogger(): winston.Logger {
    if (!Logger.instance) {
      Logger.initialize();
    }
    return Logger.instance!;
  }

  // Convenience methods
  static error(message: string, meta?: any): void {
    Logger.getLogger().error(message, meta);
  }

  static warn(message: string, meta?: any): void {
    Logger.getLogger().warn(message, meta);
  }

  static info(message: string, meta?: any): void {
    Logger.getLogger().info(message, meta);
  }

  static debug(message: string, meta?: any): void {
    Logger.getLogger().debug(message, meta);
  }

  static verbose(message: string, meta?: any): void {
    Logger.getLogger().verbose(message, meta);
  }

  // Method to reconfigure logger (useful for tests or runtime changes)
  static reconfigure(config: LoggerConfig): void {
    Logger.config = { ...Logger.config, ...config };
    Logger.instance = Logger.createLogger();
  }

  // Get current log directory (if using file logging)
  static getLogDirectory(): string | null {
    const { logFile } = Logger.config;
    return logFile ? path.dirname(logFile) : null;
  }
}

export default Logger;