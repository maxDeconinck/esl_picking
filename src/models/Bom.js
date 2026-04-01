import dolibarrAPI from "../services/DolibarrAPI.js";
import logger from "../services/Logger.js";
import pool from "../config/database_dolibarr.js";

class Bom {

  /**
   * Récupérer une commande complète avec produits et emplacements
   * @param {number} id - ID de la commande Dolibarr
   * @returns {Promise<Object|null>}
   */
  static async findByIdWithDetails(id) {
    try {
      // Requête pour récupérer la commande et ses lignes (sans duplication)
      const queryBom = `
        SELECT 
          llx_mrp_mo.rowid as order_id,
          llx_mrp_mo.fk_bom as bom_id,
          llx_mrp_mo.ref as bom_ref,
          llx_mrp_mo.note_private as bom_description,
          llx_mrp_mo.date_creation as bom_date,
          llx_mrp_mo.status as bom_status,
          llx_bom_bomline.rowid as line_id,
          llx_bom_bomline.fk_product as product_id,
          llx_bom_bomline.qty as quantity,
          llx_bom_bomline.description as line_description,
          p.label as product_label
        FROM llx_bom_bomline
        LEFT JOIN llx_mrp_mo ON llx_mrp_mo.fk_bom = llx_bom_bomline.fk_bom
        LEFT JOIN llx_product p ON llx_bom_bomline.fk_product = p.rowid
        WHERE llx_mrp_mo.rowid = ?
      `;

      const [bomRows] = await pool.execute(queryBom, [id]);
      
      if (bomRows.length === 0) {
        return null;
      }

      // Construire les lignes de commande (sans duplication)
      for(let i=0; i<bomRows.length; i++) {
        if (!bomRows[i].order_id) return;

        const stockQuery = `
          SELECT 
            ps.fk_product as product_id,
            ps.reel as stock_qty,
            ps.fk_entrepot as warehouse_id,
            e.ref as warehouse_ref,
            pb.batch as batch_number,
            pb.qty as batch_qty,
            pl.datec as lot_date
          FROM llx_product_stock ps
          LEFT JOIN llx_entrepot e ON ps.fk_entrepot = e.rowid
          LEFT JOIN llx_product_batch pb ON pb.fk_product_stock = ps.rowid
          LEFT JOIN llx_product_lot pl ON pb.batch = pl.batch
          WHERE ps.fk_product = ?
          AND ps.reel > 0 ORDER BY pl.datec ASC
        `;

        const [stockRows] = await pool.execute(stockQuery, [bomRows[i].product_id]);
        if(stockRows.length === 0) {
          console.log('No stock found for product_id:', bomRows[i].product_id) // Debug log
        } else {
          bomRows[i].stock_locations = stockRows; // Ajouter les infos de stock à la ligne de commande
        }
      }

      // Format final de la commande
      const bomData = {
        id: bomRows[0].bom_id,
        ref: bomRows[0].bom_ref,
        date: bomRows[0].bom_date,
        status: bomRows[0].bom_status,
        description: bomRows[0].bom_description,
        lines: bomRows.map(row => ({
          id: row.line_id,
          fk_product: row.product_id,
          quantity: row.quantity,
          unit_price: row.unit_price,
          total_ht: row.line_total_ht,
          total_ttc: row.line_total_ttc,
          description: row.line_description,
          product_type: row.product_type,
          product_details: {
            ref: row.product_ref,
            label: row.product_label,
            description: row.product_description,
            barcode: row.product_barcode,
          },
          stock_locations: row.stock_locations || [] // Ajouter les infos de stock ou un tableau vide si aucune info
        }))
      };

      return bomData;
    } catch (error) {
      logger.error(`Error finding BOM with details by ID: ${id}`, {
        error: error.message,
      });
      throw error;
    }
  }
}

export default Bom;