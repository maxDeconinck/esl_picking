import logger from "../services/Logger.js";

const SENSITIVE_RE = /password|pass|pwd|secret|token|authorization|auth/i;

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  try {
    const clone = JSON.parse(JSON.stringify(obj));
    const mask = (o) => {
      if (Array.isArray(o)) {
        o.forEach(mask);
      } else if (o && typeof o === 'object') {
        Object.keys(o).forEach((k) => {
          if (SENSITIVE_RE.test(k)) {
            o[k] = '***';
          } else if (o[k] && typeof o[k] === 'object') {
            mask(o[k]);
          }
        });
      }
    };
    mask(clone);
    return clone;
  } catch (e) {
    return obj;
  }
}

/**
 * Middleware pour logger toutes les requêtes et réponses de l'API
 */
export function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Logger la requête entrante (avec masquage des champs sensibles)
  logger.info("API Request Received", {
    method: req.method,
    url: req.url,
    path: req.path,
    query: sanitize(req.query),
    body: sanitize(req.body),
    headers: sanitize({
      "user-agent": req.get("user-agent"),
      "content-type": req.get("content-type"),
      authorization: req.get("authorization"),
    }),
    ip: req.ip,
  });

  // Capturer la réponse originale
  const originalSend = res.send;
  const originalJson = res.json;

  let responseBody;

  // Override res.send
  res.send = function (body) {
    responseBody = body;
    return originalSend.call(this, body);
  };

  // Override res.json
  res.json = function (body) {
    responseBody = body;
    return originalJson.call(this, body);
  };

  // Logger la réponse quand elle est terminée
  res.on("finish", () => {
    const duration = Date.now() - startTime;

    const logData = {
      method: req.method,
      url: req.url,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      responseBody: (() => {
        if (!responseBody) return responseBody;
        if (typeof responseBody === 'string') {
          try {
            const parsed = JSON.parse(responseBody);
            return sanitize(parsed);
          } catch (e) {
            return responseBody.substring(0, 1000);
          }
        }
        return sanitize(responseBody);
      })(),
    };

    if (res.statusCode >= 400) {
      logger.error("API Request Failed", logData);
    } else {
      logger.info("API Request Completed", logData);
    }
  });

  next();
}
