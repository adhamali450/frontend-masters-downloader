import fs from "node:fs";
import path from "node:path";
import slugify from "@sindresorhus/slugify";
import winston from "winston";

const LOG_CONSOLE_ENABLED = process.env.LOG_ENABLED !== "false";
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

const logsDir = path.resolve(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFileName = `${slugify(Date())}.log`;

const transports: winston.transport[] = [
  new winston.transports.File({ filename: path.join(logsDir, logFileName) }),
];

if (LOG_CONSOLE_ENABLED) {
  transports.push(new winston.transports.Console());
}

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${String(level).toUpperCase()}: ${String(message)}`;
    })
  ),
  transports,
});
