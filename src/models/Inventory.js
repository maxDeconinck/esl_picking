import pool from "../config/database.js";
import dolibarrAPI from "../services/DolibarrAPI.js";

class Inventory {
  /**
   * Créer un nouvel inventaire
   * @param {Object} data - Données de l'inventaire
   * @returns {Promise<number>} ID de l'inventaire créé
   */
  static async create(data) {
    try {
      const {
        percentage,
        total_devices,
        selected_devices,
        mode,
        status = "in_progress",
        successful = 0,
        failed = 0
      } = data;

      const [result] = await pool.execute(
        `INSERT INTO inventory 
         (iv_percentage, iv_total_devices, iv_selected_devices, iv_mode, iv_status, iv_successful, iv_failed, iv_created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [percentage, total_devices, selected_devices, mode, status, successful, failed]
      );

      return result.insertId;
    } catch (error) {
      console.error("Error creating inventory:", error);
      throw error;
    }
  }

  /**
   * Récupérer tous les inventaires
   * @param {Object} filters - Filtres optionnels (limit, offset, status)
   * @returns {Promise<Array>}
   */
  static async findAll(filters = {}) {
    try {
      let query = "SELECT * FROM inventory WHERE 1=1";
      const params = [];

      if (filters.status) {
        query += " AND iv_status = ?";
        params.push(filters.status);
      }

      query += " ORDER BY iv_created_at DESC";

      if (filters.limit) {
        query += " LIMIT ?";
        params.push(parseInt(filters.limit));

        if (filters.offset) {
          query += " OFFSET ?";
          params.push(parseInt(filters.offset));
        }
      }

      const [rows] = await pool.execute(query, params);
      return rows;
    } catch (error) {
      console.error("Error finding all inventories:", error);
      throw error;
    }
  }

  /**
   * Récupérer un inventaire par son ID
   * @param {number} id - ID de l'inventaire
   * @returns {Promise<Object|null>}
   */
  static async findById(id) {
    try {
      const [rows] = await pool.execute(
        "SELECT * FROM inventory WHERE iv_id = ?",
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error("Error finding inventory by ID:", error);
      throw error;
    }
  }

  /**
   * Mettre à jour un inventaire
   * @param {number} id - ID de l'inventaire
   * @param {Object} data - Données à mettre à jour
   * @returns {Promise<boolean>}
   */
  static async update(id, data) {
    try {
      const {
        status,
        successful,
        failed,
        completed_at
      } = data;

      const fields = [];
      const params = [];

      if (status !== undefined) {
        fields.push("iv_status = ?");
        params.push(status);
      }

      if (successful !== undefined) {
        fields.push("iv_successful = ?");
        params.push(successful);
      }

      if (failed !== undefined) {
        fields.push("iv_failed = ?");
        params.push(failed);
      }

      if (completed_at !== undefined) {
        fields.push("iv_completed_at = ?");
        params.push(completed_at);
      }

      fields.push("iv_updated_at = NOW()");

      if (fields.length === 1) {
        // Aucune modification à faire
        return false;
      }

      params.push(id);

      const query = `UPDATE inventory SET ${fields.join(", ")} WHERE iv_id = ?`;
      const [result] = await pool.execute(query, params);

      return result.affectedRows > 0;
    } catch (error) {
      console.error("Error updating inventory:", error);
      throw error;
    }
  }

  /**
   * Supprimer un inventaire
   * @param {number} id - ID de l'inventaire
   * @returns {Promise<boolean>}
   */
  static async delete(id) {
    try {
      const [result] = await pool.execute(
        "DELETE FROM inventory WHERE iv_id = ?",
        [id]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error("Error deleting inventory:", error);
      throw error;
    }
  }

  /**
   * Récupérer le nombre total d'inventaires
   * @returns {Promise<number>}
   */
  static async count() {
    try {
      const [rows] = await pool.execute(
        "SELECT COUNT(*) as total FROM inventory"
      );
      return rows[0].total;
    } catch (error) {
      console.error("Error counting inventories:", error);
      throw error;
    }
  }

  /**
   * Récupérer les statistiques des inventaires
   * @returns {Promise<Object>}
   */
  static async getStats() {
    try {
      const [rows] = await pool.execute(`
        SELECT 
          COUNT(*) as total_inventories,
          SUM(CASE WHEN iv_status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN iv_status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN iv_status = 'error' THEN 1 ELSE 0 END) as error,
          AVG(iv_percentage) as avg_percentage,
          SUM(iv_successful) as total_successful,
          SUM(iv_failed) as total_failed
        FROM inventory
      `);
      return rows[0];
    } catch (error) {
      console.error("Error getting inventory stats:", error);
      throw error;
    }
  }

  /**
   * Récupérer les 20% des produits les plus utilisés (basé sur mouvements de stock Dolibarr)
   * @returns {Promise<Array>} Liste des device IDs
   */
  static async getTopUsedProductDevices(limit) {
    try {
      // Récupérer les mouvements de stock des 30 derniers jours depuis Dolibarr
      const movements = await dolibarrAPI.getStockMovements(30);
      
      if (movements.length === 0) {
        return [];
      }

      // Limiter au nombre de produits demandé (20% du total)
      const topProducts = movements.slice(0, limit).map(m => m.product_id);

      if (topProducts.length === 0) {
        return [];
      }

      // Récupérer les devices assignés à ces produits
      const placeholders = topProducts.map(() => '?').join(',');
      
      const [devices] = await pool.execute(`
        SELECT de_id
        FROM DEVICES
        WHERE de_fk_product IN (${placeholders})
        ORDER BY RAND()
      `, topProducts);

      return devices.map(d => d.de_id);
    } catch (error) {
      console.error("Error getting top used product devices:", error);
      throw error;
    }
  }

  /**
   * Récupérer les étiquettes sans mouvement de stock depuis le dernier contrôle
   * @param {Array} excludeIds - IDs à exclure
   * @param {number} limit - Nombre limite de résultats
   * @returns {Promise<Array>} Liste des device IDs
   */
  static async getInactiveDevices(excludeIds = [], limit) {
    try {
      // Récupérer tous les devices avec produit
      const [allDevices] = await pool.execute(`
        SELECT DISTINCT d.de_id, d.de_fk_product
        FROM DEVICES d
        WHERE d.de_fk_product IS NOT NULL
      `);

      if (allDevices.length === 0) {
        return [];
      }

      // Vérifier pour chaque device s'il a un mouvement depuis le dernier inventaire
      const inactiveDeviceIds = [];

      for (const device of allDevices) {
        // Ignorer les devices du groupe 1
        if (excludeIds.includes(device.de_id)) {
          continue;
        }

        // Récupérer la date du dernier mouvement de stock
        const lastMovementDate = await dolibarrAPI.getLastStockMovementDate(device.de_fk_product);
        
        // Si pas de mouvement récent ou mouvement antérieur au dernier inventaire, inclure
        if (!lastMovementDate || new Date(lastMovementDate) <= new Date(device.de_last_inventory_check || '1900-01-01')) {
          inactiveDeviceIds.push(device.de_id);
        }

        // Arrêter si on a assez de devices
        if (inactiveDeviceIds.length >= limit) {
          break;
        }
      }

      // Shuffler et retourner
      return inactiveDeviceIds.sort(() => Math.random() - 0.5).slice(0, limit);
    } catch (error) {
      console.error("Error getting inactive devices:", error);
      throw error;
    }
  }

  /**
   * Sélectionner intelligemment les devices pour l'inventaire
   * @param {number} percentage - Pourcentage du parc
   * @param {number} totalDevices - Nombre total de devices
   * @returns {Promise<Object>} {group1: Array, group2: Array, total: number}
   */
  static async selectDevicesForInventory(percentage, totalDevices) {
    try {
      const totalToSelect = Math.max(1, Math.ceil(totalDevices * percentage / 100));
      const halfTotal = Math.ceil(totalToSelect / 2);

      // Calculer le nombre de produits (20% du total des produits)
      const [productCount] = await pool.execute(`
        SELECT COUNT(DISTINCT fk_product) as total FROM picking_detail WHERE fk_product IS NOT NULL
      `);
      const topProductLimit = Math.max(1, Math.ceil(productCount[0].total * 0.2));

      // Groupe 1: Devices assignés aux 20% des produits les plus utilisés
      const group1 = await this.getTopUsedProductDevices(topProductLimit);
      
      // Limiter le groupe 1 à 50% du total à sélectionner
      const group1Selected = group1.slice(0, halfTotal);

      // Groupe 2: Devices inactifs (aléatoire), en excluant groupe 1
      const group2 = await this.getInactiveDevices(group1, halfTotal);

      // Compléter avec des devices aléatoires si nécessaire
      let finalGroup1 = group1Selected;
      let finalGroup2 = group2;

      const selectedCount = finalGroup1.length + finalGroup2.length;
      if (selectedCount < totalToSelect) {
        // Récupérer des devices aléatoires pour compléter
        const allSelectedIds = [...finalGroup1, ...finalGroup2];
        const placeholders = allSelectedIds.map(() => '?').join(',');
        
        let query = `
          SELECT de_id FROM DEVICES
          WHERE de_fk_product IS NOT NULL
        `;
        
        if (allSelectedIds.length > 0) {
          query += ` AND de_id NOT IN (${placeholders})`;
        }
        
        query += ` ORDER BY RAND() LIMIT ?`;
        
        const params = allSelectedIds.length > 0 
          ? [...allSelectedIds, totalToSelect - selectedCount]
          : [totalToSelect - selectedCount];

        const [extras] = await pool.execute(query, params);
        finalGroup2.push(...extras.map(e => e.de_id));
      }

      return {
        group1: finalGroup1,
        group2: finalGroup2.slice(0, totalToSelect - finalGroup1.length),
        total: Math.min(finalGroup1.length + finalGroup2.length, totalToSelect)
      };
    } catch (error) {
      console.error("Error selecting devices for inventory:", error);
      throw error;
    }
  }

  /**
   * Ajouter les devices sélectionnés à un inventaire
   * @param {number} inventoryId - ID de l'inventaire
   * @param {Array} deviceIds - Liste des IDs de devices
   * @returns {Promise<boolean>}
   */
  static async addDevicesToInventory(inventoryId, deviceIds) {
    try {
      if (!deviceIds || deviceIds.length === 0) {
        return true;
      }

      const values = deviceIds.map(id => `(${inventoryId}, ${id})`).join(',');
      const [result] = await pool.execute(`
        INSERT INTO inventory_device (fk_inventory, fk_device)
        VALUES ${values}
      `);

      return result.affectedRows > 0;
    } catch (error) {
      console.error("Error adding devices to inventory:", error);
      throw error;
    }
  }

  /**
   * Récupérer les devices sélectionnés pour un inventaire
   * @param {number} inventoryId - ID de l'inventaire
   * @returns {Promise<Array>}
   */
  static async getInventoryDevices(inventoryId) {
    try {
      const [rows] = await pool.execute(`
        SELECT 
          d.de_id as id,
          d.de_mac as mac,
          d.de_key as 'key',
          d.de_name as name,
          d.de_pos as emplacement,
          d.de_fk_product as fk_product,
          d.de_mode as mode,
          d.de_type as type,
          d.de_serial as serial,
          d.de_size as size,
          d.de_last_inventory_check,
          d.de_inventory_valid,
          id_dev.validated
        FROM inventory_device id_dev
        JOIN DEVICES d ON id_dev.fk_device = d.de_id
        WHERE id_dev.fk_inventory = ?
        ORDER BY d.de_id ASC
      `, [inventoryId]);

      return rows;
    } catch (error) {
      console.error("Error getting inventory devices:", error);
      throw error;
    }
  }

  /**
   * Récupérer les devices du dernier inventaire (en cours ou le plus récent)
   * @returns {Promise<Array>}
   */
  static async getLastInventoryDevices() {
    try {
      const [inventories] = await pool.execute(`
        SELECT iv_id 
        FROM inventory 
        ORDER BY iv_created_at DESC 
        LIMIT 1
      `);

      if (!inventories || inventories.length === 0) {
        return [];
      }

      const lastInventory = inventories[0];
      return this.getInventoryDevices(lastInventory.iv_id);
    } catch (error) {
      console.error("Error getting last inventory devices:", error);
      throw error;
    }
  }

  /**
   * Formater un inventaire pour la réponse API
   * @param {Object} inventory - Objet inventaire
   * @returns {Object}
   */
  static format(inventory) {
    return {
      id: inventory.iv_id,
      percentage: inventory.iv_percentage,
      total_devices: inventory.iv_total_devices,
      selected_devices: inventory.iv_selected_devices,
      mode: inventory.iv_mode === 1 ? 'inventory' : 'picking',
      status: inventory.iv_status,
      successful: inventory.iv_successful,
      failed: inventory.iv_failed,
      created_at: inventory.iv_created_at,
      completed_at: inventory.iv_completed_at,
      updated_at: inventory.iv_updated_at
    };
  }
}

export default Inventory;
