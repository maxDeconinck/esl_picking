import express from "express";
import Picking from "../models/Picking.js";
import Device from "../models/Device.js";
import MinewService from "../services/Minew.js";
import DolibarrAPI from "../services/DolibarrAPI.js";

const router = express.Router();

/**
 * GET /pickings
 * Récupérer tous les pickings
 */
router.get("/", async (req, res) => {
  try {
    const { statut, fk_user } = req.query;
    
    const filters = {};
    if (statut) filters.statut = statut;
    if (fk_user) filters.fk_user = parseInt(fk_user);
    
    const pickings = await Picking.findAll(filters);
    
    res.json({
      success: true,
      pickings: pickings.map(p => Picking.format(p))
    });
  } catch (error) {
    console.error("Error fetching pickings:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /pickings/:id
 * Récupérer un picking spécifique avec ses détails
 */
router.get("/:id", async (req, res) => {
  try {
    const pickingId = parseInt(req.params.id);
    
    const picking = await Picking.findById(pickingId);
    
    if (!picking) {
      return res.status(404).json({ error: "Picking not found" });
    }
    
    const details = await Picking.getDetails(pickingId);
    
    res.json({
      success: true,
      picking: Picking.format(picking),
      details: details
    });
  } catch (error) {
    console.error("Error fetching picking:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Récupérer un picking via son id de commande Dolibarr
 * GET /pickings/order/:orderId
 */
router.get("/order/:orderId", async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    
    const picking = await Picking.findByCommandeId(orderId);
    
    if (!picking) {
      return res.status(404).json({ error: "Picking not found" });
    }
    
    const details = await Picking.getDetails(picking.id);
    
    res.json({
      success: true,
      picking: Picking.format(picking),
      details: details
    });
  } catch (error) {
    console.error("Error fetching picking by order ID:", error);
    res.status(500).json({ error: error.message });
  }
});


/**
 * PUT /pickings/:id/status
 * Mettre à jour le statut d'un picking
 */
router.put("/:id/status", async (req, res) => {
  try {
    const pickingId = parseInt(req.params.id);
    const { statut } = req.body;
    
    if (!statut) {
      return res.status(400).json({ error: "statut is required" });
    }
    
    const validStatuts = ['en_attente', 'en_cours', 'termine', 'annule'];
    if (!validStatuts.includes(statut)) {
      return res.status(400).json({ error: "Invalid statut" });
    }
    
    // Si on termine ou annule le picking, remettre les étiquettes en mode inventaire
    if (statut === 'termine' || statut === 'annule') {
      const details = await Picking.getDetails(pickingId);
      
      for (const detail of details) {
        // Trouver les devices associés à ce produit et cet emplacement
        const devices = await Device.findByProductId(detail.fk_product);
        
        if (devices) {
          for (const device of devices) {
            if (device.emplacement === detail.emplacement) {
                // Arrêter le clignotement de l'étiquette au cas où le premier arrêt ne fonctionne pas
                await MinewService.blinkTag(device.mac, { total: 0, color: 0 });

                // Colonne associée à éteindre aussi
                const columnName = device.emplacement.split('.')[0];
                const columnData = await Device.findByEmplacement(columnName);

                if(!columnData || columnData.type !== 'colonne') {
                  console.warn(`No column found for emplacement ${columnName}, skipping column blink off.`);
                }

                if(columnData && columnData.type === 'colonne') {
                    await MinewService.blinkTag(columnData.mac, {total: 0, color: 0});
                    await Device.update(columnData.id, { mode: 1 });
                }

                // On récupère les dernières informations du produit associé à l'étiquette depuis Dolibarr
                const product = await DolibarrAPI.getProduct(device.fk_product);
                const stock = await DolibarrAPI.getDataByEmplacement(device.emplacement);

                if (!stock || stock.length === 0) {
                    return res.status(404).json({ error: "Stock information not found for the associated product and location" });
                }

                if (!product) {
                    return res.status(404).json({ error: "Associated product not found" });
                }


                setTimeout(async () => {
                  await MinewService.blinkTag(device.mac, { total: 0, color: 0 }); // Arrêter le clignotement au cas où le premier arrêt ne fonctionne pas
                  await Device.update(device.id, { mode: 1 });
                  console.log(`✅ Device ${device.mac} screen refreshed and switched back to inventory mode`);
                }, 100 * Math.floor(Math.random() * (25 - 6 + 1) + 9)); // Rafraîchir l'écran après un délai aléatoire entre 900 et 2500 ms pour éviter de saturer le réseau si plusieurs étiquettes doivent être mises à jour en même temps
                
                // On prépare les informations à afficher sur l'étiquette 
                setTimeout(async () => {
                  await MinewService.refreshGoodsInStore({
                      productId: device.fk_product + '-' + device.emplacement,
                      lot: stock[0].batch_number || "N/A",
                      name: product.label,
                      quantity: 0,
                      emplacement: device.emplacement,
                      stock: stock[0].batch_number === '' ? stock[0].stock_reel : stock[0].stock_total,
                      ref: product.ref,
                      qrcode: `https://erp.materiel-levage.com/product/stock/product.php?id=${device.fk_product}&id_entrepot=${stock[0].warehouse_id}&action=correction&pdluoid=${stock[0].batch_id}&token=minewStock&batch_number=${stock[0].batch_number}`
                  });
                }, 100 * Math.floor(Math.random() * (25 - 6 + 1) + 9)); // Rafraîchir l'écran après un délai aléatoire entre 900 et 2500 ms pour éviter de saturer le réseau si plusieurs étiquettes doivent être mises à jour en même temps
              
                console.log(`✅ Device ${device.mac} switched back to inventory mode`);
            }
          }
        }
      }
    }
    
    await Picking.update(pickingId, { 
      statut,
      date_fin: statut === 'termine' || statut === 'annule' ? new Date() : null
    });
    
    const picking = await Picking.findById(pickingId);
    
    res.json({
      success: true,
      picking: Picking.format(picking)
    });
  } catch (error) {
    console.error("Error updating picking status:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /pickings/:id
 * Supprimer un picking et ses détails
 */
router.delete("/:id", async (req, res) => {
  try {
    const pickingId = parseInt(req.params.id);
    
    // Avant de supprimer, remettre les étiquettes en mode inventaire
    const details = await Picking.getDetails(pickingId);
    
    for (const detail of details) {
      // Trouver les devices associés à ce produit et cet emplacement
      const devices = await Device.findByProductId(detail.fk_product);
      
      if (devices) {
        for (const device of devices) {
          if (device.emplacement === detail.emplacement) {
            // Arrêter le clignotement de l'étiquette
            await MinewService.blinkTag(device.mac, { total: 0, color: 0 });
            
            // Remettre l'étiquette en mode inventaire (mode 1)
            await Device.update(device.id, { mode: 1 });
            
            console.log(`✅ Device ${device.mac} switched back to inventory mode`);
          }
        }
      }
    }
    
    // Note: La suppression des détails est gérée par CASCADE dans la base de données
    const deleted = await Picking.delete(pickingId);
    
    if (!deleted) {
      return res.status(404).json({ error: "Picking not found" });
    }
    
    res.json({
      success: true,
      message: "Picking deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting picking:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
