import winston from "winston";
import LokiTransport from "winston-loki";

// Configuration du logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: "esl-picking-api",
    environment: process.env.NODE_ENV || "development",
  },
  transports: [
    // Console transport (toujours actif)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? `\n${JSON.stringify(meta, null, 2)}`
            : "";
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      ),
    }),
  ],
});

// Ajouter Loki transport si configuré
if (process.env.LOKI_URL && process.env.LOKI_USERNAME && process.env.LOKI_PASSWORD) {
  try {
    const lokiTransport = new LokiTransport({
      host: process.env.LOKI_URL,
      labels: {
        app: "esl-picking-api",
      },
      basicAuth: `${process.env.LOKI_USERNAME}:${process.env.LOKI_PASSWORD}`,
      json: true,
      batching: false, // Désactiver le batching pour tester
      replaceTimestamp: true,
      timeout: 30000,
      onConnectionError: (err) => {
        console.error("❌ Loki error:", err.message);
        if (err.response) {
          console.error("   Status:", err.response.status);
          console.error("   Data:", JSON.stringify(err.response.data));
        }
      },
    });

    logger.add(lokiTransport);
    console.log(`✅ Loki configured: ${process.env.LOKI_URL}`);
    console.log(`   Label: app=esl-picking-api`);
    console.log(`   Batching: DISABLED (immediate send)`);
    
  } catch (error) {
    console.error("❌ Loki setup failed:", error.message);
  }
} else {
  console.warn("⚠️  Loki not configured");
}

export default logger;
