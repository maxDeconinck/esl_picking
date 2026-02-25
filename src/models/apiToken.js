import pool from "../config/database.js";
import crypto from "crypto";

class ApiToken {
  /**
   * Générer un token API sécurisé
   * @returns {string} Token de 32 caractères
   */
  static generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Créer un nouveau token API
   * @param {Object} data - Données du token
   * @param {string} data.name - Nom descriptif du token
   * @param {Date} [data.expiresAt] - Date d'expiration (optionnelle)
   * @returns {Promise<{id: number, token: string}>}
   */
  static async create({ name, expiresAt = null }) {
    // Validation
    if (!name) {
      throw new Error('Token name is required');
    }

    // Générer un token unique
    const token = this.generateToken();

    const [result] = await pool.execute(
      `INSERT INTO API_TOKENS (apitok_name, apitok_token, apitok_expiresAt)
       VALUES (?, ?, ?)`,
      [name, token, expiresAt]
    );

    return {
      id: result.insertId,
      token: token
    };
  }

  /**
   * Trouver un token par sa valeur
   * @param {string} token - Le token à rechercher
   * @returns {Promise<Object|null>}
   */
  static async findByToken(token) {
    const [rows] = await pool.execute(
      `SELECT apitok_id, apitok_name, apitok_token,
              apitok_active, apitok_expiresAt, apitok_createdAt, apitok_lastUsedAt
       FROM API_TOKENS
       WHERE apitok_token = ? AND apitok_active = TRUE`,
      [token]
    );

    if (rows.length === 0) {
      return null;
    }

    const tokenData = rows[0];

    // Vérifier l'expiration
    if (tokenData.apitok_expiresAt && new Date(tokenData.apitok_expiresAt) < new Date()) {
      return null; // Token expiré
    }

    return tokenData;
  }

  /**
   * Mettre à jour la date de dernière utilisation
   * @param {string} token - Le token utilisé
   */
  static async updateLastUsed(token) {
    await pool.execute(
      `UPDATE API_TOKENS SET apitok_lastUsedAt = NOW() WHERE apitok_token = ?`,
      [token]
    );
  }

  /**
   * Récupérer tous les tokens (avec pagination)
   * @param {Object} options - Options de pagination
   * @param {number} [options.page=1] - Page courante
   * @param {number} [options.itemsPerPage=20] - Éléments par page
   * @returns {Promise<{tokens: Array, total: number}>}
   */
  static async findAll({ page = 1, itemsPerPage = 20 } = {}) {
    const offset = (page - 1) * itemsPerPage;
    let whereConditions = [];
    let params = [];

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    // Récupérer les tokens avec les informations
    const [rows] = await pool.execute(
      `SELECT t.apitok_id, t.apitok_name, t.apitok_token,
              t.apitok_active, t.apitok_expiresAt, 
              t.apitok_createdAt, t.apitok_lastUsedAt
       FROM API_TOKENS t
       ${whereClause}
       ORDER BY t.apitok_createdAt DESC
       LIMIT ? OFFSET ?`,
      [...params, itemsPerPage, offset]
    );

    // Compter le total
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM API_TOKENS ${whereClause}`,
      params
    );

    return {
      tokens: rows,
      total: countResult[0].total
    };
  }

  /**
   * Trouver un token par son ID
   * @param {number} tokenId - ID du token
   * @returns {Promise<Object|null>}
   */
  static async findById(tokenId) {
    const [rows] = await pool.execute(
      `SELECT t.apitok_id, t.apitok_name, t.apitok_token, 
              t.apitok_active, t.apitok_expiresAt, 
              t.apitok_createdAt, t.apitok_lastUsedAt
       FROM API_TOKENS t
       WHERE t.apitok_id = ?`,
      [tokenId]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Révoquer un token (désactiver)
   * @param {number} tokenId - ID du token à révoquer
   */
  static async revoke(tokenId) {
    const [result] = await pool.execute(
      `UPDATE API_TOKENS SET apitok_active = FALSE WHERE apitok_id = ?`,
      [tokenId]
    );

    return result.affectedRows > 0;
  }

  /**
   * Activer un token
   * @param {number} tokenId - ID du token à activer
   */
  static async activate(tokenId) {
    const [result] = await pool.execute(
      `UPDATE API_TOKENS SET apitok_active = TRUE WHERE apitok_id = ?`,
      [tokenId]
    );

    return result.affectedRows > 0;
  }

  /**
   * Supprimer un token définitivement
   * @param {number} tokenId - ID du token à supprimer
   */
  static async delete(tokenId) {
    const [result] = await pool.execute(
      `DELETE FROM API_TOKENS WHERE apitok_id = ?`,
      [tokenId]
    );

    return result.affectedRows > 0;
  }

}

export default ApiToken;