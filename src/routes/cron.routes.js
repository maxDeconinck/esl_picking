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
            // Arrêter le clignotement de l'étiquette
            await MinewService.blinkTag(device.mac, { total: 0, color: 0 });
            // Remettre l'étiquette en mode normal
            await Device.update(device.id, { mode: 1 });

            // On éteint la colonne associé si il n'y a pu d'étiquette de ce côté du rack en picking
            let rack = device.emplacement.split('.')[0]; // Supposons que l'emplacement est au format "rack-colonne-étage" et que le rack est la première partie
            if(await Picking.hasOtherPickingForThisRack(picking.id, rack) === false) {
              await MinewService.blinkTagByPosition(rack, { total: 0, color: 0 }); // On éteint la colonne
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
            let result = await MinewService.changeTagDisplay(device.mac, {
              idData: device.fk_product + '-' + device.emplacement, // Id utilisé dans le template pour afficher les bonnes infos
              mode: "inventory", // Choix du template selon le mode de l'étiquette
              device: device
            });
            console.log(`✅ Detail ${detail.id} is now complete, updated device ${device.mac} to normal mode`);
            
            // Check si c'est le dernier détail du picking, si oui on peut marquer le picking comme terminé
            const isPickingComplete = updatedDetails.every(d => d.statut === 'complete');
            if (isPickingComplete) {
              await Picking.update(picking.id, { statut: 'complete', date_fin: new Date() });
              console.log(`🎉 Picking ${picking.id} is now complete!`);

              // Par sécurité on éteint tout les équipements du picking (dans le cas où il y en aurait plusieurs avec des produits différents)
              for (const d of updatedDetails) {
                const dDevice = await Device.findByEmplacement(d.emplacement);
                if (dDevice) {
                  await MinewService.blinkTag(dDevice.mac, { total: 0, color: 0 });
                  await Device.update(dDevice.id, { mode: 1 });
                  console.log(`✅ Updated device ${dDevice.mac} to normal mode as part of picking completion`);
                }
              }
            }
          }

          // On check si le picking est en terminé et si c'est la cas on éteint tout les équipements du picking (dans le cas où il y en aurait plusieurs avec des produits différents)
          if(await Picking.isComplete(picking.id)) {
            const emplacements = await Picking.getEmplacements(picking.id);
            for (const emplacement of emplacements) {
              const dDevice = await Device.findByEmplacement(emplacement);
              if (dDevice) {
                await MinewService.blinkTag(dDevice.mac, { total: 0, color: 0 });
                await Device.update(dDevice.id, { mode: 1 });
                console.log(`✅ Updated device ${dDevice.mac} to normal mode as part of picking completion`);
              }
            }
          }
          
          break; // On ne traite qu'un seul picking à la fois
        } else {
          console.log(`No matching picking detail found for device ${device.mac} (product ${device.fk_product}, location ${device.emplacement}) in picking ${picking.id}`);
        }
      }
    } else {
      console.log(`Device ${device.mac} clicked but is not in picking mode, no action taken`);
      
      // Arrêter le clignotement de l'étiquette
      await MinewService.blinkTag(device.mac, { total: 0, color: 0 });
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

export default router;