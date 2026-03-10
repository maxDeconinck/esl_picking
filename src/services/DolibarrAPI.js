import pool from "../config/database_dolibarr.js";
import logger from "./Logger.js";

class DolibarrAPI {
  constructor() {
    this.db = pool;
    this.tablePrefix = "llx_";
  }

  /**
   * Exécuter une requête SQL avec logging
   * @param {string} query - Requête SQL
   * @param {Array} params - Paramètres de la requête
   * @returns {Promise<Array>}
   */
  async executeQuery(query, params = []) {
    try {
      logger.info("Executing SQL query", {
        query: query.substring(0, 200),
        params,
      });
      
      const [rows] = await this.db.execute(query, params);
      
      logger.info("SQL query successful", {
        rowCount: Array.isArray(rows) ? rows.length : 1,
      });
      
      return rows;
    } catch (error) {
      logger.error("SQL query failed", {
        error: error.message,
        query: query.substring(0, 200),
        params,
      });
      throw error;
    }
  }

  /**
   * Récupérer les lignes (produits) d'une commande
   * @param {number} orderId - ID de la commande Dolibarr
   * @returns {Promise<Array>}
   */
  async getOrderLines(orderId) {
    try {
      const query = `
        SELECT 
          cd.*,
          p.ref as product_ref,
          p.label as product_label,
          p.description as product_description,
          p.barcode as product_barcode
        FROM ${this.tablePrefix}commandedet cd
        LEFT JOIN ${this.tablePrefix}product p ON cd.fk_product = p.rowid
        WHERE cd.fk_commande = ?
        ORDER BY cd.rang, cd.rowid
      `;
      
      const rows = await this.executeQuery(query, [orderId]);
      
      return rows.map(line => ({
        id: line.rowid,
        fk_commande: line.fk_commande,
        fk_product: line.fk_product,
        description: line.description,
        label: line.label,
        qty: parseFloat(line.qty),
        tva_tx: parseFloat(line.tva_tx),
        subprice: parseFloat(line.subprice),
        total_ht: parseFloat(line.total_ht),
        total_tva: parseFloat(line.total_tva),
        total_ttc: parseFloat(line.total_ttc),
        product_ref: line.product_ref,
        product_label: line.product_label,
        product_description: line.product_description,
        product_barcode: line.product_barcode,
      }));
    } catch (error) {
      logger.error(`Failed to fetch order lines for ${orderId}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Récupérer les informations d'un produit
   * @param {number} productId - ID du produit
   * @returns {Promise<Object>}
   */
  async getProduct(productId) {
    try {
      const query = `
        SELECT 
          p.*
        FROM ${this.tablePrefix}product p
        WHERE p.rowid = ?
      `;
      
      const rows = await this.executeQuery(query, [productId]);
      
      if (rows.length === 0) {
        throw new Error(`Product ${productId} not found`);
      }
      
      const product = rows[0];
      
      return {
        id: product.rowid,
        ref: product.ref,
        label: product.label,
        description: product.description,
        barcode: product.barcode,
        price: parseFloat(product.price || 0),
        price_ttc: parseFloat(product.price_ttc || 0),
        tva_tx: parseFloat(product.tva_tx || 0),
        stock_reel: parseFloat(product.stock || 0),
        weight: parseFloat(product.weight || 0),
        length: parseFloat(product.length || 0),
        width: parseFloat(product.width || 0),
        height: parseFloat(product.height || 0),
      };
    } catch (error) {
      logger.error(`Failed to fetch product ${productId}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Récupérer le stock d'un produit dans un entrepôt spécifique
   * @param {number} productId - ID du produit
   * @param {number} warehouseId - ID de l'entrepôt (optionnel)
   * @returns {Promise<Object>}
   */
  async getProductStock(productId, warehouseId = null) {
    try {
      let query = `
        SELECT 
          ps.*,
          e.ref as warehouse_ref,
          e.description as warehouse_description,
          e.lieu as warehouse_location
        FROM ${this.tablePrefix}product_stock ps
        LEFT JOIN ${this.tablePrefix}entrepot e ON ps.fk_entrepot = e.rowid
        WHERE ps.fk_product = ?
      `;
      
      const params = [productId];
      
      if (warehouseId) {
        query += ` AND ps.fk_entrepot = ?`;
        params.push(warehouseId);
      }
      
      const rows = await this.executeQuery(query, params);
      
      const stockWarehouses = {};
      
      for (const stock of rows) {
        stockWarehouses[stock.fk_entrepot] = {
          warehouse_id: stock.fk_entrepot,
          warehouse_ref: stock.warehouse_ref,
          warehouse_description: stock.warehouse_description,
          warehouse_location: stock.warehouse_location,
          reel: parseFloat(stock.reel || 0),
          warehouse_info: {
            id: stock.fk_entrepot,
            ref: stock.warehouse_ref,
            description: stock.warehouse_description,
            lieu: stock.warehouse_location,
          },
        };
      }
      
      return {
        stock_warehouses: stockWarehouses,
      };
    } catch (error) {
      logger.error(`Failed to fetch stock for product ${productId}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Récupérer les données d'un emplacement pour un produit donné (ex: stock, etc.)
   * @param {string} emplacement - Emplacement à rechercher
   * @returns {Promise<Array>}
   */
  async getDataByEmplacement(emplacement) {
    try {
      const query = `
        SELECT 
          e.ref as warehouse_ref,
          e.description as warehouse_description,
          ps.fk_product as product_id,
          p.ref as product_ref,
          p.label as product_label,
          p.barcode as barcode,
          ps.reel as stock_total,
          pb.batch as batch_number,
          pb.qty as batch_qty,
          ps.fk_entrepot as warehouse_id,
          pb.rowid as batch_id
        FROM ${this.tablePrefix}entrepot e
        LEFT JOIN ${this.tablePrefix}product_stock ps ON e.rowid = ps.fk_entrepot
        LEFT JOIN ${this.tablePrefix}product p ON ps.fk_product = p.rowid
        LEFT JOIN ${this.tablePrefix}product_batch pb ON pb.fk_product_stock = ps.rowid
        WHERE e.ref LIKE ?
      `;
      
      const rows = await this.executeQuery(query, [`%${emplacement}%`]);
      
      return rows.map(row => ({
        product_id: row.product_id,
        product_ref: row.product_ref,
        product_label: row.product_label,
        warehouse_id: row.warehouse_id,
        warehouse_ref: row.warehouse_ref,
        warehouse_description: row.warehouse_description,
        stock_total: parseFloat(row.stock_total || 0), // Stock total tous lots confondus
        stock_reel: parseFloat(row.batch_qty || 0), // Stock du lot spécifique
        batch_number: row.batch_number || "N/A",
        batch_id: row.batch_id
      }));
    } catch (error) {
      logger.error(`Failed to fetch data for emplacement ${emplacement}`, { error: error.message });
      throw error;
    }
  }
}

// Export une instance unique (singleton)
export default new DolibarrAPI();
