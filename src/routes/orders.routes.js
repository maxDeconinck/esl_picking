import express from "express";
import Order from "../models/Order.js";
import logger from "../services/Logger.js";
import Minew from "../services/Minew.js";
import Device from "../models/Device.js";

const router = express.Router();

/**
 * GET /orders/:id/details
 * Récupérer une commande avec tous ses détails (produits + emplacements)
 */
router.get("/:id/details", async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);

    if (isNaN(orderId)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    const orderDetails = await Order.findByIdWithDetails(orderId);

    if (!orderDetails) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(orderDetails);
  } catch (error) {
    logger.error(`Failed to fetch order details ${req.params.id}`, {
      error: error.message,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /orders/:id/lines
 * Récupérer les lignes (produits) d'une commande
 */
router.get("/:id/lines", async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);

    if (isNaN(orderId)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    const lines = await Order.getOrderLines(orderId);

    res.json(lines);
  } catch (error) {
    logger.error(`Failed to fetch order lines ${req.params.id}`, {
      error: error.message,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /orders/:id/picking
 * Lancer le picking pour une commande spécifique via l'id de la commande Dolibarr
 */
router.post("/:id/picking", async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);

    const order = await Order.findByIdWithDetails(orderId);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    for (const line of order.lines) {
      // Check si une etiquette est associé à ce produit
      const device = await Device.findByProductId(line.fk_product);
      if (device) {
        for (const element of device) {
          for (const stock of line.stock_locations) {
            if(stock.warehouse_ref === element.emplacement) {
              // Generate data for the tag
              let result = await Minew.addGoodsToStore({
                productId: line.fk_product + '-' + element.emplacement, // On peut ajouter l'emplacement pour différencier les produits s'il y en a plusieurs
                lot: stock.batch_number || "N/A",
                name: line.product_details.label,
                quantity: line.quantity,
                emplacement: element.emplacement,
                stock: stock.stock_qty // A gérer selon la disponibilité du stock dans Dolibarr
              });

              console.log('Data generated for tag:', {
                productId: line.fk_product + '-' + element.emplacement, // On peut ajouter l'emplacement pour différencier les produits s'il y en a plusieurs
                lot: stock.batch_number || "N/A",
                name: line.product_details.label,
                quantity: line.quantity,
                emplacement: element.emplacement,
                stock: stock.stock_qty // A gérer selon la disponibilité du stock dans Dolibarr
              });

              // Associer la data au template de l'étiquette
              await Minew.changeTagDisplay(element.mac, {
                mode: "picking",
                idData: line.fk_product + '-' + element.emplacement // Id utilisé dans le template pour afficher les bonnes infos
              });

              console.log('Tag updated for device:', element.mac, { result });
            } else {
              console.log('Stock location does not match device emplacement:', stock.warehouse_ref, element.emplacement);
            }
          }
        }
      }
    }

    // await order.startPicking();

    res.json({
      success: true,
      message: "Picking process started for order ID " + orderId,
    });
  } catch (error) {
    logger.error("Error starting picking process:", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;