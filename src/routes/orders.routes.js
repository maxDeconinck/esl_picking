import express from "express";
import Order from "../models/Order.js";
import logger from "../services/Logger.js";
import Minew from "../services/Minew.js";
import Device from "../models/Device.js";
import Picking from "../models/Picking.js";
import Global from "../services/Global.js";

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

    // On vérifie que le picking n'est pas déjà lancé pour cette commande
    const existingPicking = await Picking.findByCommandeId(order.id, 'order');
    if (existingPicking) {
      return res.status(400).json({ error: "Picking already exists for this order" });
    }

    // Créer le picking dans la base de données
    const pickingId = await Picking.create({
      fk_commande: order.id,
      ref_commande: order.ref,
      fk_user: null,
      user_name: null,
      statut: 'en_cours',
      type: 'order'
    });

    for (const line of order.lines) {
      // Check si une etiquette est associé à ce produit
      const device = await Device.findByProductId(line.fk_product);


      if (!device || device.length === 0) {
        logger.warn(`No device associated with product ${line.fk_product} on order line ${line.id}`);
        continue; // Skip this line if no device is associated
      }
      // Pour chaque produit on va chercher le device à allumé en fonction des règles métiers
      let deviceToBlink = await Global.getDeviceToBlink(line, device);

      // console.log(`Device to blink for product ${line.fk_product} on order line ${line.id}:`, deviceToBlink, line.stock_locations);
      if (deviceToBlink && deviceToBlink.length > 0) {
        for (const element of deviceToBlink) {

          let stock = line.stock_locations.filter(s => s.warehouse_ref === element.emplacement);
          if(stock.length > 0){
            await Global.prepareESL(pickingId, line, element, stock);

            // Get Column to blink
            const columnName = element.emplacement.split('.')[0];
            const columnData = await Device.findByEmplacement(columnName);
            if(columnData && columnData.type === 'colonne') {
              await Minew.blinkTag(columnData.mac, {total: 900, color: "cyan"}); // Clignote pendant 15 minutes (60 secondes * 15)
              await Device.update(columnData.id, { mode: 0 });
            }
          } else {
            console.log(`No stock found for product ${line.fk_product} at location ${element.emplacement}`, { stock: line.stock_locations, element });
          }
        }
      }
    }

    res.json({
      success: true,
      message: "Picking process started for order ID " + orderId,
      pickingId: pickingId
    });
  } catch (error) {
    logger.error("Error starting picking process:", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;