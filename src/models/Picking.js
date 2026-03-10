import pool from "../config/database.js";

class Picking {
  /**
   * Créer un nouveau picking
   * @param {Object} data - Données du picking
   * @returns {Promise<number>} ID du picking créé
   */
  static async create(data) {
    const { fk_commande, ref_commande, fk_user, user_name, statut = 'en_attente' } = data;
    
    const query = `
      INSERT INTO picking (fk_commande, ref_commande, fk_user, user_name, date_debut, statut)
      VALUES (?, ?, ?, ?, NOW(), ?)
    `;
    
    const [result] = await pool.execute(query, [
      fk_commande,
      ref_commande,
      fk_user,
      user_name,
      statut
    ]);
    
    return result.insertId;
  }

  /**
   * Récupérer un picking par son ID
   * @param {number} id - ID du picking
   * @returns {Promise<Object|null>}
   */
  static async findById(id) {
    const query = `
      SELECT p.*, 
             COUNT(pd.id) as total_products,
             SUM(CASE WHEN pd.statut = 'complete' THEN 1 ELSE 0 END) as products_complete
      FROM picking p
      LEFT JOIN picking_detail pd ON p.id = pd.fk_picking
      WHERE p.id = ?
      GROUP BY p.id
    `;
    
    const [rows] = await pool.execute(query, [id]);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Récupérer tous les pickings avec filtres
   * @param {Object} filters - Filtres (statut, fk_user, etc.)
   * @returns {Promise<Array>}
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT p.*, 
             COUNT(pd.id) as total_products,
             SUM(CASE WHEN pd.statut = 'complete' THEN 1 ELSE 0 END) as products_complete,
             SUM(pd.qty_prelevee) as total_qty_prelevee,
             SUM(pd.qty_demandee) as total_qty_demandee
      FROM picking p
      LEFT JOIN picking_detail pd ON p.id = pd.fk_picking
    `;
    
    const conditions = [];
    const params = [];
    
    if (filters.statut) {
      conditions.push('p.statut = ?');
      params.push(filters.statut);
    }
    
    if (filters.fk_user) {
      conditions.push('p.fk_user = ?');
      params.push(filters.fk_user);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' GROUP BY p.id ORDER BY p.date_debut DESC';
    
    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Mettre à jour un picking
   * @param {number} id - ID du picking
   * @param {Object} data - Données à mettre à jour
   * @returns {Promise<boolean>}
   */
  static async update(id, data) {
    const fields = [];
    const params = [];
    
    if (data.statut !== undefined) {
      fields.push('statut = ?');
      params.push(data.statut);
    }
    
    if (data.date_fin !== undefined) {
      fields.push('date_fin = ?');
      params.push(data.date_fin);
    }
    
    if (fields.length === 0) return false;
    
    params.push(id);
    
    const query = `UPDATE picking SET ${fields.join(', ')} WHERE id = ?`;
    const [result] = await pool.execute(query, params);
    
    return result.affectedRows > 0;
  }

  /**
   * Supprimer un picking
   * @param {number} id - ID du picking
   * @returns {Promise<boolean>}
   */
  static async delete(id) {
    const query = 'DELETE FROM picking WHERE id = ?';
    const [result] = await pool.execute(query, [id]);
    return result.affectedRows > 0;
  }

  /**
   * Ajouter une ligne de détail au picking
   * @param {Object} data - Données de la ligne
   * @returns {Promise<number>} ID de la ligne créée
   */
  static async addDetail(data) {
    const {
      fk_picking,
      fk_product,
      product_ref,
      product_name,
      emplacement,
      fk_batch,
      batch_number,
      fk_warehouse,
      qty_demandee,
      ordre = null
    } = data;
    
    const query = `
      INSERT INTO picking_detail (
        fk_picking, fk_product, product_ref, product_name, emplacement,
        fk_batch, batch_number, fk_warehouse, qty_demandee, qty_prelevee, 
        statut, ordre
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'en_attente', ?)
    `;
    
    const [result] = await pool.execute(query, [
      fk_picking,
      fk_product,
      product_ref,
      product_name,
      emplacement,
      fk_batch,
      batch_number,
      fk_warehouse,
      qty_demandee,
      ordre
    ]);
    
    return result.insertId;
  }

  /**
   * Récupérer les détails d'un picking
   * @param {number} pickingId - ID du picking
   * @returns {Promise<Array>}
   */
  static async getDetails(pickingId) {
    const query = `
      SELECT * FROM picking_detail
      WHERE fk_picking = ?
      ORDER BY COALESCE(ordre, id) ASC
    `;
    
    const [rows] = await pool.execute(query, [pickingId]);
    return rows;
  }

  /**
   * Mettre à jour une ligne de détail (prélèvement)
   * @param {number} detailId - ID de la ligne
   * @param {number} qty - Quantité prélevée
   * @returns {Promise<boolean>}
   */
  static async updateDetail(detailId, qty) {
    // Récupérer la ligne pour comparer
    const [rows] = await pool.execute('SELECT * FROM picking_detail WHERE id = ?', [detailId]);
    
    if (rows.length === 0) return false;
    
    const detail = rows[0];
    const newQty = parseFloat(qty);
    const demandee = parseFloat(detail.qty_demandee);
    
    // Déterminer le statut
    let statut = 'en_attente';
    if (newQty >= demandee) {
      statut = 'complete';
    } else if (newQty > 0) {
      statut = 'partiel';
    }
    
    const query = `
      UPDATE picking_detail 
      SET qty_prelevee = ?,
          statut = ?,
          date_prelevement = NOW()
      WHERE id = ?
    `;
    
    const [result] = await pool.execute(query, [newQty, statut, detailId]);
    return result.affectedRows > 0;
  }

  /**
   * Incrémenter la quantité prélevée d'une ligne
   * @param {number} detailId - ID de la ligne
   * @param {number} increment - Quantité à ajouter (par défaut 1)
   * @returns {Promise<boolean>}
   */
  static async incrementDetail(detailId, increment = 1) {
    const [rows] = await pool.execute('SELECT * FROM picking_detail WHERE id = ?', [detailId]);
    
    if (rows.length === 0) return false;
    
    const detail = rows[0];
    const newQty = parseFloat(detail.qty_prelevee) + parseFloat(increment);
    
    return await this.updateDetail(detailId, newQty);
  }

  /**
   * Vérifier si un picking a d'autres lignes de détail en cours pour la même rangée 
   * @param {number} pickingId - ID du picking
   * @param {string} emplacement - Emplacement à vérifier
   * @returns {Promise<boolean>}
   */
  static async hasOtherPickingForThisRack(pickingId, emplacement) {
    const query = `
      SELECT COUNT(*) as total
      FROM picking_detail
      WHERE fk_picking = ? AND emplacement = ? AND statut != 'complete'
    `;
    const [rows] = await pool.execute(query, [pickingId, emplacement]);
    return rows[0].total > 0;
  }

  /**
   * Vérifier si un picking est complet
   * @param {number} pickingId - ID du picking
   * @returns {Promise<boolean>}
   */
  static async isComplete(pickingId) {
    const query = `
      SELECT COUNT(*) as total,
             SUM(CASE WHEN statut = 'complete' THEN 1 ELSE 0 END) as complete
      FROM picking_detail
      WHERE fk_picking = ?
    `;
    
    const [rows] = await pool.execute(query, [pickingId]);
    const { total, complete } = rows[0];
    
    return total > 0 && total === complete;
  }

  /**
   * Formater un picking pour l'API
   * @param {Object} picking - Picking brut
   * @returns {Object}
   */
  static format(picking) {
    if (!picking) return null;
    
    return {
      id: picking.id,
      fk_commande: picking.fk_commande,
      ref_commande: picking.ref_commande,
      fk_user: picking.fk_user,
      user_name: picking.user_name,
      date_debut: picking.date_debut,
      date_fin: picking.date_fin,
      statut: picking.statut,
      total_products: picking.total_products || 0,
      products_complete: picking.products_complete || 0,
      total_qty_prelevee: parseFloat(picking.total_qty_prelevee || 0),
      total_qty_demandee: parseFloat(picking.total_qty_demandee || 0),
      progress: picking.total_products > 0 
        ? Math.round((picking.products_complete / picking.total_products) * 100)
        : 0,
      created_at: picking.created_at,
      updated_at: picking.updated_at
    };
  }
}

export default Picking;
