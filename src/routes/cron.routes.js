import express from "express";
import Device from "../models/Device.js";
import DolibarrAPI from "../services/DolibarrAPI.js";
import MinewService from "../services/Minew.js";

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

export default router;