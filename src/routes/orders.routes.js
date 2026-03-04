import express from "express";
import Order from "../models/Order.js";
import logger from "../services/Logger.js";
import Minew from "../services/Minew.js";
import Device from "../models/Device.js";
import Picking from "../models/Picking.js";

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

    // Créer le picking dans la base de données
    const pickingId = await Picking.create({
      fk_commande: order.id,
      ref_commande: order.ref,
      fk_user: null,
      user_name: null,
      statut: 'en_cours'
    });

    for (const line of order.lines) {
      // Check si une etiquette est associé à ce produit
      const device = await Device.findByProductId(line.fk_product);
      if (device) {
        for (const element of device) {
          for (const stock of line.stock_locations) {
            if(stock.warehouse_ref === element.emplacement) {
              // Ajouter la ligne de détail au picking
              await Picking.addDetail({
                fk_picking: pickingId,
                fk_product: line.fk_product,
                product_ref: line.product_details.ref,
                product_name: line.product_details.label,
                emplacement: element.emplacement,
                fk_batch: null,
                batch_number: stock.batch_number || null,
                fk_warehouse: stock.warehouse_id,
                qty_demandee: line.quantity,
                ordre: null
              });

              // Generate data for the tag
              let result = await Minew.addGoodsToStore({
                productId: line.fk_product + '-' + element.emplacement, // On peut ajouter l'emplacement pour différencier les produits s'il y en a plusieurs
                lot: stock.batch_number || "N/A",
                name: line.product_details.label,
                quantity: line.quantity,
                emplacement: element.emplacement,
                stock: stock.batch_qty,
                ref: line.product_details.ref
              });

              // Associer la data au template de l'étiquette
              await Minew.changeTagDisplay(element.mac, {
                mode: "picking",
                idData: line.fk_product + '-' + element.emplacement // Id utilisé dans le template pour afficher les bonnes infos
              });

              // Faire clignoter l'étiquette pour attirer l'attention du préparateur
              await Minew.blinkTag(element.mac, {total: 900, color: "cyan"}); // Clignote pendant 15 minutes (60 secondes * 15)
              
              // Get Column to blink
              const columnName = element.emplacement.split('.')[0];
              logger.info(`Device ${element.mac} associated with product ${line.fk_product} at location ${element.emplacement} will blink column ${columnName} on the tag`, { device: element, stock });
              const columnData = await Device.findByEmplacement(columnName);
              if(columnData && columnData.type === 'colonne') {
                await Minew.blinkTag(columnData.mac, {total: 900, color: "cyan"}); // Clignote pendant 15 minutes (60 secondes * 15)
                await Device.update(columnData.id, { mode: 1 });
              }

              // Passer l'étiquette en mode picking
              await Device.update(element.id, { mode: 1 });

              console.log('Tag updated for device:', element.mac, { result });
            } else {
              console.log('Stock location does not match device emplacement:', stock.warehouse_ref, element.emplacement);
            }
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