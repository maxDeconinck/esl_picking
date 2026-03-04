import express from "express";
import Device from "../models/Device.js";
import DolibarrAPI from "../services/DolibarrAPI.js";
import MinewService from "../services/Minew.js";
import Picking from "../models/Picking.js";

const router = express.Router();

/**
 * GET /devices
 * Récupérer toutes les étiquettes avec leurs produits associés
 */
router.get("/", async (req, res) => {
  try {
    const devices = await Device.findAll();

    // Enrichir chaque device avec les informations produit si fk_product est défini
    const enrichedDevices = await Promise.all(
      devices.map(async (device) => {
        if (device.fk_product) {
          try {
            const product = await DolibarrAPI.getProduct(device.fk_product);
            return {
              ...device,
              product: {
                id: product.id,
                ref: product.ref,
                label: product.label,
                url: `${process.env.DOLIBARR_URL}/product/card.php?id=${product.id}`
              }
            };
          } catch (error) {
            console.warn(`Failed to fetch product ${device.fk_product} for device ${device.id}:`, error.message);
            return device;
          }
        }
        return device;
      })
    );

    res.json({
      success: true,
      devices: enrichedDevices
    });
  } catch (error) {
    console.error("Error fetching devices:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /devices/:id
 * Récupérer une étiquette spécifique
 */
router.get("/:id", async (req, res) => {
  try {
    const deviceId = parseInt(req.params.id, 10);

    const device = await Device.findById(deviceId);

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    res.json({
      success: true,
      device: Device.format(device),
    });
  } catch (error) {
    console.error("Error fetching device:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /devices
 * Créer une nouvelle étiquette
 */
router.post("/", async (req, res) => {
  try {
    const { name, mac, key, emplacement, fk_product } = req.body;

    if (!mac || !key) {
      return res.status(400).json({ error: "Device MAC and key are required" });
    }

    const deviceId = await Device.create({
      name,
      mac,
      key,
      emplacement,
      fk_product
    });

    const device = await Device.findById(deviceId);

    res.status(201).json({
      success: true,
      device: Device.format(device),
    });
  } catch (error) {
    console.error("Error creating device:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /devices/:id
 * Mettre à jour une étiquette existante
 */
router.put("/:id", async (req, res) => {
  try {
    const deviceId = parseInt(req.params.id, 10);
    const { name, mac, key, emplacement, fk_product, mode } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: "Device ID is required" });
    }

    const updated = await Device.update(deviceId, {
      name,
      mac,
      key,
      emplacement,
      fk_product,
      mode
    });

    if (!updated) {
      return res.status(404).json({ error: "Device not found" });
    }

    const device = await Device.findById(deviceId);

    res.json({
      success: true,
      device: Device.format(device),
    });
  } catch (error) {
    console.error("Error updating device:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /devices/:id
 * Supprimer une étiquette existante
 */
router.delete("/:id", async (req, res) => {
  try {
    const deviceId = parseInt(req.params.id, 10);

    const deleted = await Device.delete(deviceId);

    if (!deleted) {
      return res.status(404).json({ error: "Device not found" });
    }

    res.json({
      success: true,
      message: "Device deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting device:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /devices/emplacement/:emplacement
 * Récupérer une étiquette par son emplacement
 */
router.get("/emplacement/:emplacement", async (req, res) => {
  try {
    const { emplacement } = req.params;

    const device = await Device.findByEmplacement(emplacement);

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    res.json({
      success: true,
      device: Device.format(device),
    });
  } catch (error) {
    console.error("Error fetching device by emplacement:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /devices/mac/:mac
 * Récupérer une étiquette par son adresse MAC
 */
router.get("/mac/:mac", async (req, res) => {
  try {
    const { mac } = req.params;

    const device = await Device.findByMac(mac);

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    res.json({
      success: true,
      device: Device.format(device),
    });
  } catch (error) {
    console.error("Error fetching device by MAC:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /devices/:id/blink
 * Faire clignoter une étiquette pendant 10 secondes
 */
router.post("/:id/blink", async (req, res) => {
  try {
    const deviceId = parseInt(req.params.id, 10);
    const device = await Device.findById(deviceId);

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    if (!device.mac) {
      return res.status(400).json({ error: "Device has no MAC address" });
    }

    // Faire clignoter l'étiquette pendant 30 secondes
    const result = await MinewService.blinkTag(device.mac, {
      total: 30,      // 30 clignotements
      color: "cyan"
    });

    res.json({
      success: true,
      message: "Blink command sent successfully",
      device: Device.format(device),
      result: result
    });
  } catch (error) {
    console.error("Error blinking device:", error);
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
    req.body = {"mac":"e10000031d63","buttonId":"01","buttonEvent":"01","buttonTime":1770829136661,"opcode":368099704} // Mock de payload pour les tests, à supprimer en production
    const { mac, buttonId, buttonEvent, buttonTime } = JSON.parse(JSON.stringify(req.body)); // On stringify pour éviter les problèmes de parsing des logs avec des objets complexes
    // On écrit le payload reçu dans les logs pour debugger les notifications de clics
    // Le log : {"mac":"e10000031d63","buttonId":"01","buttonEvent":"01","buttonTime":1770829136661,"opcode":368099704}

    if (!mac) {
      return res.status(400).json({ error: "Device MAC is required" });
    }

    const device = await Device.findByMac(mac);

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    console.log(`Button event received from device ${device.id} ${device.mode}`);

    if(device.mode === 1) { // Si l'étiquette est en mode picking
      // Chercher un picking actif avec ce produit
      const pickings = await Picking.findAll({ statut: 'en_cours' });
      
      let updated = false;
      
      for (const picking of pickings) {
        const details = await Picking.getDetails(picking.id);
        
        console.log(`Checking picking ${picking.id} with details:`, details);
        // Trouver la ligne de détail correspondant au produit
        const detail = details.find(d => 
          d.fk_product === device.fk_product && 
          d.emplacement === device.emplacement &&
          d.statut !== 'complete'
        );
        
        if (detail) {
          console.log(`Found detail ${detail.id} for product ${device.fk_product} at location ${device.emplacement}`);
          // Incrémenter la quantité prélevée
          await Picking.incrementDetail(detail.id, 1);
          console.log(`✅ Incremented picking ${picking.id}, detail ${detail.id} for product ${device.fk_product}`);
          updated = true;
          
          // Récupérer les détails mis à jour
          const updatedDetails = await Picking.getDetails(picking.id);
          const updatedDetail = updatedDetails.find(d => d.id === detail.id);
          
          if (updatedDetail && updatedDetail.statut === 'complete') {
            // Arrêter le clignotement de l'étiquette
            await MinewService.blinkTag(device.mac, { total: 0, color: 0 });
            // Remettre l'étiquette en mode normal
            await Device.update(device.id, { mode: 1 });
          }
          
          break; // On ne traite qu'un seul picking à la fois
        }
      }
    }

    res.json({
      success: true,
      message: "Button click received",
      device: Device.format(device),
    });
  } catch (error) {
    console.error("Error handling button click:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /devices/:id/detach
 * Détacher une étiquette de son produit
 */
router.patch("/:id/detach", async (req, res) => {
  try {
    const deviceId = parseInt(req.params.id, 10);

    const updated = await Device.update(deviceId, {
      fk_product: null,
      emplacement: null
    });

    if (!updated) {
      return res.status(404).json({ error: "Device not found" });
    }

    const device = await Device.findById(deviceId);

    res.json({
      success: true,
      message: "Device detached from product successfully",
      device: Device.format(device),
    });
  } catch (error) {
    console.error("Error detaching device:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/** 
 * POST /devices/:id/mode
 * Changer le mode d'une étiquette (ex: picking, inventory, etc.)
 * Note: cette fonctionnalité permet de changer le comportement de l'étiquette selon le mode choisi.
 * Par exemple, en mode "picking", l'étiquette affiche le numéro de lot à prélever et clignote en rouge pour attirer l'attention du préparateur.
 * En mode "inventory", elle pourrait clignoter en bleu pour indiquer qu'elle doit être comptabilisée et affiche le stock actuel et un QR code pour accéder à la fiche produit dans Dolibarr.
 */
router.post("/:id/mode", async (req, res) => {
  try {
    const deviceId = parseInt(req.params.id, 10);
    const { mode } = req.body;

    if (!mode) {
      return res.status(400).json({ error: "Mode is required" });
    }

    const device = await Device.findById(deviceId);

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    if (!device.mac) {
      return res.status(400).json({ error: "Device has no MAC address" });
    }

    // On met à jour le mode de l'étiquette dans la base de données
    await Device.update(deviceId, { mode: mode === "inventory" ? 1 : 0 });

    // On récupère les informations à afficher sur l'étiquette en fonction du mode choisi et on envoie la commande à l'étiquette pour mettre à jour son affichage et son comportement
    let content = { lot: 'test', quantity: 3, stock: 10, empl: 'E.3.3.3' } // Exemple de contenu à afficher sur l'étiquette, à adapter selon vos besoins et la doc Minew

    let result;
    result = await MinewService.changeTagDisplay(device.mac, {
      content, // Exemple de texte à afficher (numéro de lot)
      template: mode === "inventory" ? "inventory_template" : "picking_template", // Exemple de template à utiliser selon le mode
      device: device // On passe le device pour récupérer fk_product et emplacement
    });
    console.log("changeTagDisplay result:", result)

    res.json({
      success: true,
      message: `Device mode changed to ${mode} successfully`,
      device: Device.format(device),
      result: result
    });
  } catch (error) {
    console.error("Error changing device mode:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

/**
 * POST /devices/:id/update-screen
 * Mettre à jour l'affichage d'une étiquette avec les informations du produit associé
 * Note: cette fonctionnalité permet de forcer la mise à jour de l'affichage d'une étiquette, par exemple après avoir modifié les informations du produit dans Dolibarr ou après avoir changé le mode de l'étiquette. Elle récupère les dernières informations du produit associé à l'étiquette et envoie une commande à l'étiquette pour mettre à jour son affichage.
 */
router.post("/:id/update-screen", async (req, res) => {
  try {
    const deviceId = parseInt(req.params.id, 10);
    const device = await Device.findById(deviceId);

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    if (!device.mac) {
      return res.status(400).json({ error: "Device has no MAC address" });
    }

    if (!device.fk_product) {
      return res.status(400).json({ error: "Device is not associated with any product" });
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
      qrcode: `https://erp.materiel-levage.com/product/stock/product.php?id=${device.fk_product}&id_entrepot=${stock[0].warehouse_id}&action=correction&pdluoid=${stock[0].batch_id}&token=minewStock`
    });

    // On envoie la commande à l'étiquette pour mettre à jour son affichage
    let result = await MinewService.changeTagDisplay(device.mac, {
      idData: device.fk_product + '-' + device.emplacement, // Id utilisé dans le template pour afficher les bonnes infos
      mode: "inventory", // Choix du template selon le mode de l'étiquette
      device: device
    });

    res.json({
      success: true,
      message: "Device screen updated successfully",
      device: Device.format(device),
      result: result
    });
  } catch (error) {
    console.error("Error updating device screen:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

export default router;