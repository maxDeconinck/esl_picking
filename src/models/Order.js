import dolibarrAPI from "../services/DolibarrAPI.js";
import logger from "../services/Logger.js";
import pool from "../config/database_dolibarr.js";

class Order {

  /**
   * Récupérer une commande complète avec produits et emplacements
   * @param {number} id - ID de la commande Dolibarr
   * @returns {Promise<Object|null>}
   */
  static async findByIdWithDetails(id) {
    try {
      // Requête pour récupérer la commande et ses lignes (sans duplication)
      const orderQuery = `
        SELECT 
          c.rowid as order_id,
          c.ref as order_ref,
          c.date_commande as order_date,
          c.fk_statut as order_status,
          c.fk_soc as customer_id,
          c.total_ht,
          c.total_ttc,
          s.nom as customer_name,
          
          cd.rowid as line_id,
          cd.fk_product as product_id,
          cd.qty as quantity,
          cd.subprice as unit_price,
          cd.total_ht as line_total_ht,
          cd.total_ttc as line_total_ttc,
          cd.description as line_description,
          cd.product_type,
          
          p.ref as product_ref,
          p.label as product_label,
          p.description as product_description,
          p.barcode as product_barcode
          
        FROM llx_commande c
        LEFT JOIN llx_societe s ON c.fk_soc = s.rowid
        LEFT JOIN llx_commandedet cd ON c.rowid = cd.fk_commande
        LEFT JOIN llx_product p ON cd.fk_product = p.rowid
        WHERE c.rowid = ?
        ORDER BY cd.rang
      `;

      const [orderRows] = await pool.execute(orderQuery, [id]);
      
      if (orderRows.length === 0) {
        return null;
      }

      // Construire les lignes de commande (sans duplication)
      for(let i=0; i<orderRows.length; i++) {
        if (!orderRows[i].line_id) return;

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

        const [stockRows] = await pool.execute(stockQuery, [orderRows[i].product_id]);
        if(stockRows.length === 0) {
          console.log('No stock found for product_id:', orderRows[i].product_id) // Debug log
        } else {
          orderRows[i].stock_locations = stockRows; // Ajouter les infos de stock à la ligne de commande
        }
      }

      // Format final de la commande
      const orderData = {
        id: orderRows[0].order_id,
        ref: orderRows[0].order_ref,
        date: orderRows[0].order_date,
        status: orderRows[0].order_status,
        customer: {
          id: orderRows[0].customer_id,
          name: orderRows[0].customer_name,
        },
        lines: orderRows.map(row => ({
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

      return orderData;
    } catch (error) {
      logger.error(`Error finding order with details by ID: ${id}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Récupérer les lignes (produits) d'une commande
   * @param {number} id - ID de la commande Dolibarr
   * @returns {Promise<Array>}
   */
  static async getOrderLines(id) {
    try {
      const lines = await dolibarrAPI.getOrderLines(id);
      return lines;
    } catch (error) {
      logger.error(`Error getting order lines for order: ${id}`, {
        error: error.message,
      });
      throw error;
    }
  }
}

export default Order;