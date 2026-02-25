import ApiToken from "../models/ApiToken.js";

/**
 * Middleware pour authentifier via API Token
 * Supporte deux formats:
 * - Header: X-API-Token: <token>
 * - Header: Authorization: Bearer <token>
 */
export async function authenticateApiToken(req, res, next) {
  try {
    // Extraire le token depuis les headers
    let token = req.headers['x-api-token'];
    
    if (!token) {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(401).json({
        error: 'API token is required',
        hint: 'Provide token via X-API-Token header or Authorization: Bearer <token>'
      });
    }

    // Vérifier le token dans la base de données
    const tokenData = await ApiToken.findByToken(token);

    if (!tokenData) {
      return res.status(401).json({
        error: 'Invalid or expired API token'
      });
    }

    // Mettre à jour la date de dernière utilisation (async, non bloquant)
    ApiToken.updateLastUsed(token).catch(err => 
      console.error('Failed to update token last used:', err)
    );

    // Attacher les informations du token à la requête
    req.apiToken = {
      id: tokenData.apitok_id,
      name: tokenData.apitok_name
    };

    next();
  } catch (error) {
    console.error('API Token authentication error:', error);
    res.status(500).json({
      error: 'Internal server error during authentication'
    });
  }
}

export default {
  authenticateApiToken
};
