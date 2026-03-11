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

    // On vérifie que le picking n'est pas déjà lancé pour cette commande
    const existingPicking = await Picking.findByCommandeId(order.id);
    if (existingPicking) {
      return res.status(400).json({ error: "Picking already exists for this order" });
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

      // Pour chaque produit on va chercher le device à allumé en fonction des règles métiers
      let deviceToBlink = await getDeviceToBlink(line, device);

      // console.log(`Device to blink for product ${line.fk_product} on order line ${line.id}:`, deviceToBlink, line.stock_locations);

      if (deviceToBlink && deviceToBlink.length > 0) {
        for (const element of deviceToBlink) {

          let stock = line.stock_locations.filter(s => s.warehouse_ref === element.emplacement);
          if(stock.length > 0){
            await prepareESL(pickingId, line, element, stock);

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

async function getDeviceToBlink(line, device) {
  if(device.length == 1) {
    // On a qu'un seul device associé, on le prend directement
    return device;
  } else if (device.length > 1) {
    // Si on a plusieurs devices associés, on applique les règles métiers pour choisir lequel allumer
    
    // Règle 1 : On cherche l'emplacement le plus ancien et on vérifie si il a assez de quantité
    if(line.stock_locations && line.stock_locations.length > 0) {
      // Trier les emplacements par date d'entrée en stock (du plus ancien au plus récent)
      const sortedStock = line.stock_locations.sort((a, b) => new Date(a.lot_date) - new Date(b.lot_date));
      
      for(const stock of sortedStock) {
        if(stock.batch_qty >= line.quantity) {
          // On trouve un emplacement qui a assez de quantité, on cherche le device associé à cet emplacement
          const deviceForLocation = device.find(d => d.emplacement === stock.warehouse_ref);
          if(deviceForLocation) {
            return [deviceForLocation]; // On retourne le device associé à cet emplacement
          }
        }
      }
    }
  }
  return false;
}

async function prepareESL(pickingId, line, element, stock) {

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

  console.log('Tag updated for device:', element.mac, { result });

  // Associer la data au template de l'étiquette
  await Minew.changeTagDisplay(element.mac, {
    mode: "picking",
    idData: line.fk_product + '-' + element.emplacement // Id utilisé dans le template pour afficher les bonnes infos
  }).then( async() => {
    logger.info(`Tag display updated for device ${element.mac} with product ${line.fk_product} at location ${element.emplacement}`, { device: element, stock });
    setTimeout(async () => {
      await Minew.blinkTag(element.mac, { total: 900, color: "cyan" }); // Arrêter le clignotement après 15 minutes
    }, 1000 * 60); // 60 secondes pour laisser le temps à l'étiquette de se mettre à jour avant de commencer à clignoter
  }).catch(error => {
    logger.error(`Failed to update tag display for device ${element.mac}`, { error: error.message, device: element });
  });

  // Passer l'étiquette en mode picking
  await Device.update(element.id, { mode: 0 });
}

export default router;