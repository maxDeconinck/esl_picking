import axios from "axios";
import logger from "./Logger.js";

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

class DolibarrAPI {
  constructor() {
    this.baseURL = process.env.DOLIBARR_URL;
    this.apiKey = process.env.DOLIBARR_API_KEY;
    
    if (!this.baseURL || !this.apiKey) {
      throw new Error("DOLIBARR_URL and DOLIBARR_API_KEY must be defined in .env");
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        "DOLAPIKEY": this.apiKey,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    // Intercepteur pour logger toutes les requêtes
    this.client.interceptors.request.use(
      (config) => {
        logger.info("Dolibarr API Request", {
          method: config.method.toUpperCase(),
          url: config.url,
          params: sanitize(config.params),
          data: sanitize(config.data),
        });
        return config;
      },
      (error) => {
        logger.error("Dolibarr API Request Error", { error: error.message });
        return Promise.reject(error);
      }
    );

    // Intercepteur pour logger toutes les réponses
    this.client.interceptors.response.use(
      (response) => {
        logger.info("Dolibarr API Response", {
          status: response.status,
          url: response.config.url,
          data: sanitize(response.data),
        });
        return response;
      },
      (error) => {
        logger.error("Dolibarr API Response Error", {
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
          data: sanitize(error.response?.data),
          requestData: sanitize(error.config?.data),
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Récupérer une commande par son ID avec toutes ses informations
   * @param {number} orderId - ID de la commande Dolibarr
   * @returns {Promise<Object>}
   */
  async getOrder(orderId) {
    try {
      const response = await this.client.get(`/api/index.php/orders/${orderId}`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch order ${orderId}`, { error: error.message });
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
      const order = await this.getOrder(orderId);
      return order.lines || [];
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
      const response = await this.client.get(`/api/index.php/products/${productId}`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch product ${productId}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Récupérer le stock d'un produit dans un entrepôt spécifique
   * @param {number} productId - ID du produit
   * @param {number} warehouseId - ID de l'entrepôt (optionnel)
   * @returns {Promise<Array>}
   */
  async getProductStock(productId, warehouseId = null) {
    try {
      const params = warehouseId ? { warehouse_id: warehouseId } : {};
      const response = await this.client.get(
        `/api/index.php/products/${productId}/stock`,
        { params }
      );
      
      const stockData = response.data;
      for (const [key, stock] of Object.entries(stockData.stock_warehouses || [])) {
        try {
          const warehouseInfo = await this.getWarehousesInfosByID(key);
          stock.warehouse_info = warehouseInfo;
        } catch (error) {
          logger.warn(`Failed to fetch warehouse info for warehouse ${stock.warehouse}`, { error: error.message });
          stock.warehouse_info = null;
        }
      }
      
      return stockData;
    } catch (error) {
      logger.error(`Failed to fetch stock for product ${productId}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Récupérer les entrepôts
   * @returns {Promise<Array>}
   */
  async getWarehousesInfosByID() {
    try {
      const response = await this.client.get(`/api/index.php/warehouses`);
      return response.data;
    } catch (error) {
      logger.error("Failed to fetch warehouses", { error: error.message });
      throw error;
    }
  }

  /**
   * Récupérer les données d'un emplacement pour un produit donné (ex: stock, etc.)
   * @param {string} emplacement - Emplacement à rechercher
   * @returns {Promise<Object>}
   */
  async getDataByEmplacement(emplacement) {
    try {
      const response = await this.client.get(`/api/index.php/stock/emplacement`, {
        params: { emplacement },
      });
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch data for emplacement ${emplacement}`, { error: error.message });
      throw error;
    }
  }


  /**
   * Récupérer une commande complète avec produits et emplacements
   * @param {number} orderId - ID de la commande
   * @returns {Promise<Object>}
   */
  async getOrderWithDetails(orderId) {
    try {
      // 1. Récupérer la commande
      const order = await this.getOrder(orderId);

      // 2. Enrichir chaque ligne avec les détails du produit et son stock
      const enrichedLines = await Promise.all(
        (order.lines || []).map(async (line) => {
          try {
            // Récupérer les infos produit
            const product = await this.getProduct(line.fk_product);
            
            // Récupérer le stock du produit (tous les entrepôts)
            const stock = await this.getProductStock(line.fk_product);

            return {
              ...line,
              product_details: {
                ref: product.ref,
                label: product.label,
                description: product.description,
                barcode: product.barcode,
              },
              stock_locations: stock,
            };
          } catch (error) {
            logger.warn(`Failed to enrich line for product ${line.fk_product}`, {
              error: error.message,
            });
            return {
              ...line,
              product_details: null,
              stock_locations: [],
            };
          }
        })
      );

      return {
        id: order.id,
        ref: order.ref,
        date: order.date,
        status: order.statut,
        customer: {
          id: order.socid,
          name: order.thirdparty?.name,
        },
        lines: enrichedLines,
        total_ht: order.total_ht,
        total_ttc: order.total_ttc,
      };
    } catch (error) {
      logger.error(`Failed to fetch order with details ${orderId}`, {
        error: error.message,
      });
      throw error;
    }
  }
}

// Export une instance unique (singleton)
export default new DolibarrAPI();
