import express from "express";
import pool from "../config/database.js";
import Device from "../models/Device.js";
import DolibarrAPI from "../services/DolibarrAPI.js";
import MinewService from "../services/Minew.js";
import logger from "../services/Logger.js";
import Picking from "../models/Picking.js";
import Inventory from "../models/Inventory.js";
import Global from "../services/Global.js";

const router = express.Router();

router.get('/fix-id-product-emplacement', async (req, res) => {
  try {
    const devices = await Device.findAll();
    let nbErrors = 0;

    for (const device of devices) {
      if (device.fk_product && device.emplacement) {
        // On récupère le produit associé à cet emplacement depuis Dolibarr pour vérifier si l'id_product_emplacement est correct
        const stock = await DolibarrAPI.getDataByEmplacement(device.emplacement);
        if(!stock || stock.length === 0) {
          console.warn(`Stock information not found for product ${device.fk_product} at location ${device.emplacement}, skipping device ${device.id}`);
          continue;
        } else {
          // Vérifier que product_id existe et est valide avant de mettre à jour
          if(stock[0].product_id && stock[0].product_id !== device.fk_product) {
            nbErrors++;
            console.warn(`Mismatch for device ${device.id}: expected product ${device.fk_product} but found ${stock[0].product_id} at location ${device.emplacement}. Updating...`);
            await Device.update(device.id, { fk_product: stock[0].product_id });
          } else if(!stock[0].product_id) {
            console.warn(`Product ID is empty or invalid in stock data for location ${device.emplacement}, skipping device ${device.id}`);
          }
        }
      }
    }

    res.json({
      success: true,
      message: `All devices updated with new id_product_emplacement. Total errors: ${nbErrors}`
    });
  } catch (error) {
    console.error("Error updating devices:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

/**
 * GET /cron/reset-unassigned-devices
 * Réinitialiser 5 étiquettes sans emplacement ni produit associé
 * Utile pour nettoyer les étiquettes orphelines
 * Paramètre optionnel: ?force=true pour forcer le re-reset
 */
router.get('/reset-unassigned-devices', async (req, res) => {
  try {
    const forceReset = req.query.force === 'true';
    const macFilter = req.query.mac; // Optionnel: réinitialiser une étiquette spécifique par son MAC
    let query;
    let params = [];
    
    if(macFilter) {
      // Réinitialiser une étiquette spécifique par son MAC
      query = "SELECT de_id AS 'id', de_mac AS 'mac', de_name AS 'name' FROM DEVICES WHERE de_mac = ?";
      params.push(macFilter);
    } else {
      // Construire la requête
      query = "SELECT de_id AS 'id', de_mac AS 'mac', de_name AS 'name' FROM DEVICES WHERE (de_pos IS NULL OR de_pos = '') AND de_fk_product IS NULL";
    }
    
    // Si pas de force, exclure les étiquettes déjà réinitialisées
    if (!forceReset) {
      query += " AND de_reset_at IS NULL";
    }
    
    query += " LIMIT 20";
    
    // Trouver les étiquettes sans emplacement ET sans produit
    const [unassignedDevices] = await pool.execute(query, params);

    if (!unassignedDevices || unassignedDevices.length === 0) {
      return res.json({
        success: true,
        message: forceReset 
          ? "Aucune étiquette à réinitialiser en mode force" 
          : "Aucune étiquette sans emplacement ni produit trouvée à réinitialiser",
        devices_updated: 0
      });
    }

    // Réinitialiser chaque étiquette
    for (const device of unassignedDevices) {
      try {
        // Réinitialiser le mode à 1 (inventaire) et marquer comme reset
        await Device.update(device.id, { mode: 1 });
        
        // Marquer la date de reset dans la BD directement
        await pool.execute(
          "UPDATE DEVICES SET de_reset_at = NOW() WHERE de_id = ?",
          [device.id]
        );

        // Afficher un message "no_data" sur l'étiquette
        if (device.mac) {
          await MinewService.addGoodsToStore({
            productId: 'reset-' + device.id,
            ref: `${device.mac.slice(-5)}`,
          });

          await new Promise(resolve => setTimeout(resolve, 500));

          await MinewService.changeTagDisplay(device.mac, {
            idData: 'reset-' + device.id,
            mode: "no_data",
            device: device
          });
        }

        console.log(`✅ Device ${device.id} (${device.mac}) réinitialisé`);
      } catch (deviceError) {
        console.error(`Erreur lors de la réinitialisation du device ${device.id}:`, deviceError);
      }
    }

    res.json({
      success: true,
      message: `${unassignedDevices.length} étiquette(s) réinitialisée(s)`,
      devices_updated: unassignedDevices.length,
      devices: unassignedDevices.map(d => ({ id: d.id, mac: d.mac, name: d.name }))
    });
  } catch (error) {
    console.error("Error resetting unassigned devices:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

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
          let stockToDisplay = stock[0].batch_number === '' ? stock[0].stock_reel : stock[0].stock_total;
          if(stockToDisplay && stockToDisplay % 1 !== 0) {
            stockToDisplay = stockToDisplay.toFixed(2); // Afficher 2 décimales si la quantité n'est pas un entier
          }

          let numLot = stock[0].batch_number || "N/A";
          if(device.serial === 'serial'){
            numLot = ''; // Si le produit est en mode "serial", on n'affiche pas le numéro de lot mais les numéros de séries des produits à la place
            // Si le produit est en mode "serial", on affiche les numéro de séries des produits à la place du numéro de lot
            numLot = await Global.formatLots(stock.map(s => s.batch_number));
            // Convertion en string si numLot est un tableau (cas où il y a plusieurs numéros de série à afficher), en séparant les numéros de série par " | "
            if(Array.isArray(numLot)) {
              numLot = numLot.join(" | ");
            }
          }

          await MinewService.refreshGoodsInStore({
            productId: device.fk_product + '-' + device.emplacement, // On peut ajouter l'emplacement pour différencier les produits s'il y en a plusieurs
            lot: numLot,
            name: product.label,
            quantity: 0,
            emplacement: device.emplacement,
            stock: stockToDisplay,
            ref: product.ref,
            qrcode: `https://erp.materiel-levage.com/product/stock/product.php?id=${device.fk_product}&id_entrepot=${stock[0].warehouse_id}&action=correction&pdluoid=${stock[0].batch_id}&token=minewStock&batch_number=${stock[0].batch_number}`,
          });
        
          // Remettre l'étiquette en mode inventaire (mode 1)
          await Device.update(device.id, { mode: 1 });
          
          console.log(`✅ Device ${device.mac} screen updated successfully`);
        }
      }
      if(!device.fk_product && device.emplacement) {
        console.warn(`Device ${device.id} has no associated product, show "no product" screen`);
        
        await MinewService.addGoodsToStore({
          productId: 'temp-' + device.emplacement,
          emplacement: device.emplacement
        });

        await new Promise(resolve => setTimeout(resolve, 2000)); // On attend 2 secondes pour que Minew ait le temps de créer l'entrée dans le store avant de changer l'affichage

        // On associe à l'étiquette le template "no_product" pour indiquer qu'aucun produit n'est associé à l'étiquette et on arrête le processus de mise à jour de l'affichage
        await MinewService.changeTagDisplay(device.mac, {
          mode: "no_product",
          idData: 'temp-' + device.emplacement // On utilise un identifiant temporaire pour que Minew puisse faire le lien entre les données et l'étiquette
        });
      }
      if(!device.emplacement) {
        await MinewService.addGoodsToStore({
          productId: 'temp-' + device.mac.slice(-5), // On utilise les 4 derniers caractères de l'adresse MAC pour créer un identifiant temporaire unique
          ref: device.mac.slice(-5),
        });

        await new Promise(resolve => setTimeout(resolve, 2000)); // On attend 2 secondes pour que Minew ait le temps de créer l'entrée dans le store avant de changer l'affichage

        await MinewService.changeTagDisplay(device.mac, {
          idData: 'no_data',
          mode: "no_data",
          device: device
        });
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
      const pickings = await Picking.findAll({ statut: 'en_cours', emplacement: device.emplacement });
      
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
    } else if(device.mode === 1) { // Si l'étiquette est en mode inventaire
      // Valider le device pour l'inventaire
      const validated = await Device.validateInventory(device.id);
      console.log(`✅ Device ${device.mac} validated for inventory`);

      // Récupérer l'inventaire actif (le plus récent en in_progress)
      const activeInventories = await Inventory.findAll({ 
        limit: 1, 
        status: 'in_progress' 
      });

      if (activeInventories && activeInventories.length > 0) {
        const activeInventory = activeInventories[0];

        // Incrémenter le compteur de succès
        const currentInventory = await Inventory.findById(activeInventory.iv_id);
        const newSuccessCount = (currentInventory.iv_successful || 0) + 1;
        const remainingDevices = currentInventory.iv_selected_devices - newSuccessCount;

        // Vérifier si tous les devices ont été validés
        if (newSuccessCount >= currentInventory.iv_selected_devices) {
          // Marquer l'inventaire comme complété
          await Inventory.update(activeInventory.iv_id, {
            status: 'completed',
            successful: newSuccessCount,
            completed_at: new Date()
          });
          console.log(`✅ Inventory ${activeInventory.iv_id} completed!`);
        } else {
          // Mettre à jour juste le compteur
          await Inventory.update(activeInventory.iv_id, {
            successful: newSuccessCount
          });
          console.log(`✅ Inventory progress: ${newSuccessCount}/${currentInventory.iv_selected_devices}`);
        }
      }
    } else {
      console.log(`Device ${device.mac} clicked but is not in picking or inventory mode, no action taken`);
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

          let numLot = stock[0].batch_number || "N/A";
          if(device.serial === 'serial'){
            numLot = ''; // Si le produit est en mode "serial", on n'affiche pas le numéro de lot mais les numéros de séries des produits à la place
            // Si le produit est en mode "serial", on affiche les numéro de séries des produits à la place du numéro de lot
            numLot = await Global.formatLots(stock.map(s => s.batch_number));
            // Convertion en string si numLot est un tableau (cas où il y a plusieurs numéros de série à afficher), en séparant les numéros de série par " | "
            if(Array.isArray(numLot)) {
              numLot = numLot.join(" | ");
            }
          }

          // On prépare les informations à afficher sur l'étiquette 
          await MinewService.addGoodsToStore({
              productId: device.fk_product + '-' + device.emplacement, // On peut ajouter l'emplacement pour différencier les produits s'il y en a plusieurs
              lot: numLot,
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