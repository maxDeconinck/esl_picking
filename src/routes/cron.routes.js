import express from "express";
import Device from "../models/Device.js";
import DolibarrAPI from "../services/DolibarrAPI.js";
import MinewService from "../services/Minew.js";
import logger from "../services/Logger.js";
import Picking from "../models/Picking.js";

const router = express.Router();

router.get('/update-all-screens', async (req, res) => {
  try {
    const devices = await Device.findAll();

    for (const device of devices) {
      if (device.fk_product && device.emplacement) {
        if (!device.mac) {
          console.warn(`Device ${device.id} has no MAC address, skipping screen update`);
        } else {
          // On récupère les dernières informations du produit associé à l'étiquette depuis Dolibarr
          const product = await DolibarrAPI.getProduct(device.fk_product);
          const stock = await DolibarrAPI.getDataByEmplacement(device.emplacement);

          if (!stock || stock.length === 0) {
              console.warn(`Stock information not found for product ${device.fk_product} at location ${device.emplacement}, skipping device ${device.id}`);
              continue;
          }

          if (!product) {
              console.warn(`Associated product not found for product ID ${device.fk_product}, skipping device ${device.id}`);
              continue;
          }

          // On prépare les informations à afficher sur l'étiquette 
          await MinewService.refreshGoodsInStore({
              productId: device.fk_product + '-' + device.emplacement, // On peut ajouter l'emplacement pour différencier les produits s'il y en a plusieurs
              lot: stock[0].batch_number || "N/A",
              name: product.label,
              quantity: 0,
              emplacement: device.emplacement,
              stock: stock[0].batch_number === '' ? stock[0].stock_reel : stock[0].stock_total,
              ref: product.ref,
              qrcode: `https://erp.materiel-levage.com/product/stock/product.php?id=${device.fk_product}&id_entrepot=${stock[0].warehouse_id}&action=correction&pdluoid=${stock[0].batch_id}&token=minewStock&batch_number=${stock[0].batch_number}`
          });
        
          // Remettre l'étiquette en mode inventaire (mode 1)
          await Device.update(device.id, { mode: 1 });
          
          console.log(`✅ Device ${device.mac} screen updated successfully`);
        }
      }
    }

    res.json({
      success: true,
      message: "All device screens updated successfully"
    });
  } catch (error) {
    console.error("Error updating all device screens:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});


/**
 * POST /devices/button
 * Recevoir les notifications de clics sur les étiquettes
 * Note: cette route est appelée par Minew lorsqu'un utilisateur clique sur une étiquette. Elle reçoit l'ID de l'étiquette et peut être utilisée pour déclencher des actions spécifiques, comme afficher les détails du produit associé ou lancer un processus de picking.
 */
router.post("/button", async (req, res) => {
  try {
    const { mac, buttonId, buttonEvent, buttonTime } = JSON.parse(JSON.stringify(req.body)); // On stringify pour éviter les problèmes de parsing des logs avec des objets complexes

    if (!mac) {
      return res.status(400).json({ error: "Device MAC is required" });
    }

    const device = await Device.findByMac(mac);

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Arrêter le clignotement de l'étiquette
    await MinewService.blinkTag(device.mac, { total: 0, color: 0 });


    if(device.mode === 0) { // Si l'étiquette est en mode picking
      // Chercher un picking actif avec ce produit
      const pickings = await Picking.findAll({ statut: 'en_cours' });
      
      for (const picking of pickings) {
        const details = await Picking.getDetails(picking.id);
        picking.details = details; // Ajouter les détails au picking pour le logging
        
        // Trouver la ligne de détail correspondant au produit
        const detail = details.find(d => 
          d.fk_product === device.fk_product && 
          d.emplacement === device.emplacement &&
          d.statut !== 'complete'
        );
        
        if (detail) {
          // Incrémenter la quantité prélevée
          await Picking.incrementDetail(detail.id, detail.qty_demandee);
          console.log(`✅ Incremented picking ${picking.id}, detail ${detail.id} for product ${device.fk_product}`);
          
          
          // Récupérer les détails mis à jour
          const updatedDetails = await Picking.getDetails(picking.id);
          const updatedDetail = updatedDetails.find(d => d.id === detail.id);
          
          if (updatedDetail && updatedDetail.statut === 'complete') {
            // Remettre l'étiquette en mode normal
            await Device.update(device.id, { mode: 1 });

            // On éteint la colonne associé si il n'y a pu d'étiquette de ce côté du rack en picking
            let rack = device.emplacement.split('.')[0]; // Supposons que l'emplacement est au format "rack-colonne-étage" et que le rack est la première partie
            if(await Picking.hasOtherPickingForThisRack(picking.id, rack) === false) {
              await MinewService.blinkTagByPosition(rack, { total: 0, color: 0 }); // On éteint la colonne
            }
          }

          break; // On ne traite qu'un seul picking à la fois
        } else {
          console.log(`No matching picking detail found for device ${device.mac} (product ${device.fk_product}, location ${device.emplacement}) in picking ${picking.id}`);
        }
      }
    } else {
      console.log(`Device ${device.mac} clicked but is not in picking mode, no action taken`);
    }

    res.json({
      success: true,
      message: "Button click received",
      device: Device.format(device),
    });
  } catch (error) {
    logger.error("Error handling button click:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Vérifier si un picking n'est pas resté bloqué en mode picking (par exemple à cause d'un oubli de l'opérateur de cliquer sur l'étiquette pour valider le prélèvement). On peut exécuter cette route via un cron toutes les heures par exemple pour s'assurer que les étiquettes ne restent pas bloquées en mode picking indéfiniment.
 */
router.get('/check-stuck-pickings', async (req, res) => {
  try {
    const stuckPickings = await Picking.findStuckPickings(60); // Trouver les pickings qui sont en cours depuis plus de 60 minutes

    for (const picking of stuckPickings) {
      const details = await Picking.getDetails(picking.id);
      picking.details = details; // Ajouter les détails au picking pour le logging

      console.warn(`Found stuck picking ${picking.id} (started at ${picking.date_debut}), resetting associated devices`, { picking });

      for (const detail of details) {
        const device = await Device.findByEmplacement(detail.emplacement);
        if (device) {
          await MinewService.blinkTag(device.mac, { total: 0, color: 0 });

          // On récupère les dernières informations du produit associé à l'étiquette depuis Dolibarr
          const product = await DolibarrAPI.getProduct(device.fk_product);
          const stock = await DolibarrAPI.getDataByEmplacement(device.emplacement);

          if (!stock || stock.length === 0) {
              console.warn(`Stock information not found for product ${device.fk_product} at location ${device.emplacement}, skipping device ${device.id}`);
              continue;
          }

          if (!product) {
              console.warn(`Associated product not found for product ID ${device.fk_product}, skipping device ${device.id}`);
              continue;
          }

          // On prépare les informations à afficher sur l'étiquette 
          await MinewService.addGoodsToStore({
              productId: device.fk_product + '-' + device.emplacement, // On peut ajouter l'emplacement pour différencier les produits s'il y en a plusieurs
              lot: stock[0].batch_number || "N/A",
              name: product.label,
              quantity: 0,
              emplacement: device.emplacement,
              stock: stock[0].batch_number === '' ? stock[0].stock_reel : stock[0].stock_total,
              ref: product.ref,
              qrcode: `https://erp.materiel-levage.com/product/stock/product.php?id=${device.fk_product}&id_entrepot=${stock[0].warehouse_id}&action=correction&pdluoid=${stock[0].batch_id}&token=minewStock&batch_number=${stock[0].batch_number}`
          });

          // On envoie la commande à l'étiquette pour mettre à jour son affichage
          await MinewService.changeTagDisplay(device.mac, {
              idData: device.fk_product + '-' + device.emplacement, // Id utilisé dans le template pour afficher les bonnes infos
              mode: "inventory", // Choix du template selon le mode de l'étiquette
              device: device
          });
          
          await Device.update(device.id, { mode: 1 });
          console.log(`✅ Updated device ${device.mac} to normal mode as part of stuck picking reset`);
        }
      }

      // Optionnellement, on peut aussi marquer le picking comme annulé ou terminé pour éviter de le traiter à nouveau
      await Picking.update(picking.id, { statut: 'annule', date_fin: new Date() });
      console.log(`Marked stuck picking ${picking.id} as cancelled`);
    }

    res.json({
      success: true,
      message: `Checked for stuck pickings and reset ${stuckPickings.length} pickings if needed`
    });
  } catch (error) {
    logger.error("Error checking for stuck pickings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;