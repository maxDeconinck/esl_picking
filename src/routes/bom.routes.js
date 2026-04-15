import express from "express";
import Bom from "../models/Bom.js";
import logger from "../services/Logger.js";
import Minew from "../services/Minew.js";
import Device from "../models/Device.js";
import Picking from "../models/Picking.js";
import Global from "../services/Global.js";

const router = express.Router();

/**
 * POST /bom/:id/picking
 * Lancer le picking pour une BOM spécifique via l'id de la commande Dolibarr
 */
router.post("/:id/picking", async (req, res) => {
  try {
    const bomId = parseInt(req.params.id, 10);

    const bom = await Bom.findByIdWithDetails(bomId);

    if (!bom) {
      return res.status(404).json({ error: "BOM not found" });
    }

    // On vérifie que le picking n'est pas déjà lancé pour cette BOM
    const existingPicking = await Picking.findByCommandeId(bomId, 'bom');
    if (existingPicking) {
      return res.status(400).json({ error: "Picking already exists for this BOM" });
    }

    // Créer le picking dans la base de données
    const pickingId = await Picking.create({
      fk_commande: bomId,
      ref_commande: bom.ref,
      fk_user: null,
      user_name: null,
      statut: 'en_cours',
      type: 'bom'
    });


    for (const line of bom.lines) {
      // Check si une etiquette est associé à ce produit
      const device = await Device.findByProductId(line.fk_product);

      // Pour chaque produit on va chercher le device à allumé en fonction des règles métiers
      let deviceToBlink = await Global.getDeviceToBlink(line, device);

      if (deviceToBlink && deviceToBlink.length > 0) {
        for (const element of deviceToBlink) {

          let stock = line.stock_locations.filter(s => s.warehouse_ref === element.emplacement);
          let descriptionComplementaire = null;
          if(stock.length > 0){
            if(element.emplacement && element.emplacement.includes('FU.')) {
              descriptionComplementaire = bom.description
            }
            await Global.prepareESL(pickingId, line, element, stock, descriptionComplementaire);

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
      message: "Picking process started for BOM ID " + bomId,
      pickingId: pickingId
    });
  } catch (error) {
    logger.error("Error starting picking process:", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;