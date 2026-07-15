import express from "express";
import Inventory from "../models/Inventory.js";
import Device from "../models/Device.js";

const router = express.Router();

/**
 * POST /webhook/inventory-device-validated
 * Webhook appelé par l'étiquette physique quand le bouton est appuyé
 * Endpoint SANS authentification - directement depuis l'étiquette
 * 
 * Body:
 * {
 *   "device_id": 123,           // OU
 *   "device_mac": "XX:XX:XX:XX:XX:XX"
 * }
 */
router.post("/inventory-device-validated", async (req, res) => {
  try {
    const { device_id, device_mac } = req.body;

    if (!device_id && !device_mac) {
      return res.status(400).json({
        success: false,
        error: "device_id ou device_mac requis"
      });
    }

    // Récupérer le device
    let device;
    if (device_id) {
      device = await Device.findById(parseInt(device_id));
    } else if (device_mac) {
      device = await Device.findByMac(device_mac);
    }

    if (!device) {
      return res.status(404).json({
        success: false,
        error: "Device non trouvé"
      });
    }

    // Vérifier que le device est en mode inventaire
    if (device.mode !== 1) {
      return res.status(400).json({
        success: false,
        error: "Device non en mode inventaire",
        current_mode: device.mode === 1 ? 'inventaire' : 'picking'
      });
    }

    // Valider le device
    const validated = await Device.validateInventory(device.id);

    if (!validated) {
      return res.status(400).json({
        success: false,
        error: "Erreur lors de la validation du device"
      });
    }

    // Récupérer l'inventaire actif (le plus récent en in_progress)
    const activeInventories = await Inventory.findAll({ 
      limit: 1, 
      status: 'in_progress' 
    });

    if (!activeInventories || activeInventories.length === 0) {
      return res.json({
        success: true,
        message: "Emplacement validé - aucun inventaire en cours",
        device_id: device.id,
        device_name: device.name
      });
    }

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

      return res.json({
        success: true,
        message: "Inventaire complété!",
        device_id: device.id,
        device_name: device.name,
        inventory_status: 'completed',
        inventory_progress: {
          validated: newSuccessCount,
          total: currentInventory.iv_selected_devices,
          remaining: 0
        }
      });
    } else {
      // Mettre à jour juste le compteur
      await Inventory.update(activeInventory.iv_id, {
        successful: newSuccessCount
      });

      return res.json({
        success: true,
        message: `Emplacement OK - ${remainingDevices} restant(s)`,
        device_id: device.id,
        device_name: device.name,
        inventory_status: 'in_progress',
        inventory_progress: {
          validated: newSuccessCount,
          total: currentInventory.iv_selected_devices,
          remaining: remainingDevices
        }
      });
    }
  } catch (error) {
    console.error("Error validating device from webhook:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
