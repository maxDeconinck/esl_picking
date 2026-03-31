import pool from "../config/database.js";
import dolibarrAPI from "../services/DolibarrAPI.js";

class Device {

  /**
   * Récupérer toutes les étiquettes
   */
  static async findAll() {
    try {
      const [rows] = await pool.execute(
        "SELECT de_id AS 'id', de_mac AS 'mac', de_key AS 'key', de_name AS 'name', de_pos AS 'emplacement', de_fk_product AS 'fk_product', de_mode AS 'mode', de_type AS 'type' FROM DEVICES ORDER BY de_id ASC"
      );
      return rows;
    } catch (error) {
      console.error("Error finding all devices:", error);
      throw error;
    }
  }

  /**
   * Récupérer les étiquettes affectées à un produit (fk_product IS NOT NULL)
   */
  static async findAffected() {
    try {
      const [rows] = await pool.execute(
        "SELECT de_id AS 'id', de_mac AS 'mac', de_key AS 'key', de_name AS 'name', de_pos AS 'emplacement', de_fk_product AS 'fk_product', de_mode AS 'mode', de_type AS 'type' FROM DEVICES WHERE de_fk_product IS NOT NULL ORDER BY de_id ASC"
      );
      return rows;
    } catch (error) {
      console.error("Error finding affected devices:", error);
      throw error;
    }
  }

  /**
   * Récupérer une étiquette par son ID
   * @param {number} id - ID de l'étiquette
   * @returns {Promise<Object|null>}
   */
  static async findById(id) {
    try {
      const [rows] = await pool.execute(
        "SELECT de_id AS 'id', de_mac AS 'mac', de_key AS 'key', de_name AS 'name', de_pos AS 'emplacement', de_fk_product AS 'fk_product', de_mode AS 'mode', de_type AS 'type' FROM DEVICES WHERE de_id = ?",
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error("Error finding device by ID:", error);
      throw error;
    }
  }

  /**
   * Récupérer une étiquette par son emplacement
   * @param {string} emplacement - Emplacement de l'étiquette
   * @returns {Promise<Object|null>}
   */
  static async findByEmplacement(emplacement) {
    try {
      const [rows] = await pool.execute(
        "SELECT de_id AS 'id', de_mac AS 'mac', de_key AS 'key', de_name AS 'name', de_pos AS 'emplacement', de_fk_product AS 'fk_product', de_mode AS 'mode', de_type AS 'type' FROM DEVICES WHERE de_pos = ?",
        [emplacement]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error("Error finding device by emplacement:", error);
      throw error;
    }
  }

  /**
   * Récupérer une étiquette par son adresse MAC
   * @param {string} mac - Adresse MAC de l'étiquette
   * @returns {Promise<Object|null>}
   */
  static async findByMac(mac) {
    try {
      const [rows] = await pool.execute(
        "SELECT de_id AS 'id', de_mac AS 'mac', de_key AS 'key', de_name AS 'name', de_pos AS 'emplacement', de_fk_product AS 'fk_product', de_mode AS 'mode' FROM DEVICES WHERE de_mac = ?",
        [mac]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error("Error finding device by MAC:", error);
      throw error;
    }
  }

    /**
     * Récupérer une étiquette par l'ID du produit associé (fk_product)
     * @param {number} productId - ID du produit Dolibarr
     * @returns {Promise<Object|null>}
     */
    static async findByProductId(productId) {
      try {
        const [rows] = await pool.execute(
          "SELECT de_id AS 'id', de_mac AS 'mac', de_key AS 'key', de_name AS 'name', de_pos AS 'emplacement', de_fk_product AS 'fk_product', de_mode AS 'mode' FROM DEVICES WHERE de_fk_product = ?",
          [productId]
        );
        return rows.length > 0 ? rows : null; // On retourne un tableau d'étiquettes, car il peut y en avoir plusieurs pour un même produit
      } catch (error) {
        console.error("Error finding device by product ID:", error);
        throw error;
      }
    }

  /** 
   * Mettre à jour une étiquette * @param {number} id - ID de l'étiquette à mettre à jour
   * @param {Object} deviceData - Données de l'étiquette à mettre à jour
   * @param {string} [deviceData.name] - Nouveau nom de l'étiquette
   * @param {string} [deviceData.mac] - Nouvelle adresse MAC de l'étiquette
   * @param {string} [deviceData.key] - Nouvelle clé de l'étiquette
   * @param {string} [deviceData.emplacement] - Nouvel emplacement de l'étiquette
   * @param {number} [deviceData.fk_product] - ID du produit Dolibarr
   * @returns {Promise<boolean>} true si la mise à jour a réussi, sinon false
   */
  static async update(id, { name, mac, key, emplacement, fk_product, mode }) {
    try {
      const fields = [];
      const values = [];

      if (name) {
        fields.push("de_name = ?");
        values.push(name);
      }
      if (mac) {
        fields.push("de_mac = ?");
        values.push(mac);
      }
      if (key) {
        fields.push("de_key = ?");
        values.push(key);
      }
      if (mode !== undefined) {
        fields.push("de_mode = ?");
        values.push(mode);
      }
      if (emplacement !== undefined) {
        fields.push("de_pos = ?");
        if(emplacement !== null)
          values.push(emplacement.toUpperCase());
        else         
          values.push(null);
      }
      if (fk_product !== undefined) {
        fields.push("de_fk_product = ?");
        values.push(fk_product);
      }

      if (fields.length === 0) {
        return false; // Aucune donnée à mettre à jour
      }

      values.push(id); // Ajouter l'ID à la fin des valeurs

      const [result] = await pool.execute(
        `UPDATE DEVICES SET ${fields.join(", ")} WHERE de_id = ?`,
        values
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error("Error updating device:", error);
      throw error;
    }
  }

  /**
   * Créer une nouvelle étiquette
   * @param {Object} deviceData - Données de l'étiquette
   * @param {string} deviceData.name - Nom de l'étiquette
   * @param {string} deviceData.mac - Adresse MAC de l'étiquette
   * @param {string} deviceData.key - Clé de l'étiquette
   * @param {string} deviceData.emplacement - Emplacement de l'étiquette
   * @param {number} deviceData.fk_product - ID du produit Dolibarr
   * @returns {Promise<number>} ID de la nouvelle étiquette
   */
  static async create({ name, mac, key, emplacement, fk_product }) {
    try {
      const [result] = await pool.execute(
        "INSERT INTO DEVICES (de_name, de_mac, de_key, de_pos, de_fk_product) VALUES (?, ?, ?, ?, ?)",
        [name, mac, key, emplacement, fk_product || null]
      );
      return result.insertId;
    } catch (error) {
      console.error("Error creating device:", error);
      throw error;
    }
  }

  /**
   * Récupérer les données liées à un emplacement depuis Dolibarr pour générer la data de l'étiquette
   * @param {string} emplacement - Emplacement pour lequel récupérer les données
   * @returns {Promise<Object>} Données liées à l'emplacement
   */
  static async getDolibarrDataByEmplacement(emplacement) {
    try {
      // Appeler l'API Dolibarr pour récupérer les données liées à l'emplacement
      const data = await dolibarrAPI.getDataByEmplacement(emplacement);
      return data;
    } catch (err) {
      console.error(`Error fetching data from Dolibarr for emplacement ${emplacement}:`, err);
    }
  }

  /**
   * Formater les données d'une étiquette pour la réponse API
   * @param {Object} device - Données brutes de l'étiquette
   * @returns {Object} Données formatées
   */
  static format(device) {
    return {
      id: device.id,
      name: device.name,
      mac: device.mac,
      key: device.key,
      mode: device.mode,
      emplacement: device.emplacement,
      fk_product: device.fk_product,
      product: device.product || null
    };
  }
}

export default Device;