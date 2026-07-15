import express from "express";
import Inventory from "../models/Inventory.js";
import Device from "../models/Device.js";

const router = express.Router();

/**
 * GET /inventory
 * Récupérer la liste des inventaires avec pagination
 */
router.get("/", async (req, res) => {
  try {
    const { limit = 50, offset = 0, status } = req.query;
    
    const filters = {
      limit: parseInt(limit),
      offset: parseInt(offset)
    };
    
    if (status) {
      filters.status = status;
    }
    
    const inventories = await Inventory.findAll(filters);
    const total = await Inventory.count();
    
    res.json({
      success: true,
      total: total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      inventory_history: inventories.map(inv => Inventory.format(inv))
    });
  } catch (error) {
    console.error("Error fetching inventories:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * GET /inventory/history
 * Récupérer l'historique des inventaires (endpoint pour le frontend)
 */
router.get("/history", async (req, res) => {
  try {
    const inventories = await Inventory.findAll({ limit: 100 });
    
    res.json({
      success: true,
      inventory_history: inventories.map(inv => Inventory.format(inv))
    });
  } catch (error) {
    console.error("Error fetching inventory history:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * GET /inventory/:id
 * Récupérer les détails d'un inventaire
 */
router.get("/:id", async (req, res) => {
  try {
    const inventoryId = parseInt(req.params.id);
    
    const inventory = await Inventory.findById(inventoryId);
    
    if (!inventory) {
      return res.status(404).json({ 
        success: false,
        error: "Inventaire non trouvé" 
      });
    }
    
    res.json({
      success: true,
      inventory: Inventory.format(inventory)
    });
  } catch (error) {
    console.error("Error fetching inventory:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * GET /inventory/:id/devices
 * Récupérer les devices sélectionnés pour un inventaire
 */
router.get("/:id/devices", async (req, res) => {
  try {
    const inventoryId = parseInt(req.params.id);
    
    const devices = await Inventory.getInventoryDevices(inventoryId);
    
    res.json({
      success: true,
      inventory_id: inventoryId,
      devices: devices
    });
  } catch (error) {
    console.error("Error fetching inventory devices:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * GET /inventory/devices/last
 * Récupérer les devices du dernier inventaire
 */
router.get("/devices/last", async (req, res) => {
  try {
    const devices = await Inventory.getLastInventoryDevices();
    
    res.json({
      success: true,
      devices: devices
    });
  } catch (error) {
    console.error("Error fetching last inventory devices:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * POST /inventory
 * Créer un nouvel inventaire
 */
router.post("/", async (req, res) => {
  try {
    const {
      percentage,
      mode = 1
    } = req.body;

    // Valider les paramètres
    if (!percentage || percentage < 1 || percentage > 100) {
      return res.status(400).json({
        success: false,
        error: "Le pourcentage doit être entre 1 et 100"
      });
    }

    // Récupérer tous les devices
    const allDevices = await Device.findAll();
    const totalDevices = allDevices.length;

    if (totalDevices === 0) {
      return res.status(400).json({
        success: false,
        error: "Aucune étiquette disponible dans le parc"
      });
    }

    // Calculer le nombre d'étiquettes à sélectionner
    const selectedDevicesCount = Math.max(1, Math.ceil(totalDevices * percentage / 100));

    // Sélectionner intelligemment les étiquettes
    const selection = await Inventory.selectDevicesForInventory(percentage, totalDevices);
    const selectedDeviceIds = [...selection.group1, ...selection.group2];
    const selectedDevices = allDevices.filter(d => selectedDeviceIds.includes(d.id));

    // Créer l'inventaire
    const inventoryId = await Inventory.create({
      percentage: percentage,
      total_devices: totalDevices,
      selected_devices: selectedDevicesCount,
      mode: mode,
      status: "in_progress",
      successful: 0,
      failed: 0
    });

    // Ajouter les devices sélectionnés à l'inventaire
    await Inventory.addDevicesToInventory(inventoryId, selectedDeviceIds);

    // Mettre à jour les étiquettes sélectionnées au mode inventaire
    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (const device of selectedDevices) {
      try {
        const updated = await Device.update(device.id, { mode: mode });
        if (updated) {
          successCount++;
          results.push({
            id: device.id,
            name: device.name || `Étiquette #${device.id}`,
            status: 'success'
          });
        } else {
          failCount++;
          results.push({
            id: device.id,
            name: device.name || `Étiquette #${device.id}`,
            status: 'error'
          });
        }
      } catch (error) {
        failCount++;
        results.push({
          id: device.id,
          name: device.name || `Étiquette #${device.id}`,
          status: 'error'
        });
      }
    }

    // L'inventaire reste en "in_progress" jusqu'à validation manuelle des devices
    // Le comptage des succès/erreurs se fera lors de chaque validation via PUT
    const inventory = await Inventory.findById(inventoryId);

    res.json({
      success: true,
      message: `Inventaire créé et ${successCount} étiquettes mises en mode inventaire. En attente de validation manuelle des devices.`,
      inventory: Inventory.format(inventory),
      details: {
        total_selected: selectedDevicesCount,
        configured: successCount,
        configuration_failed: failCount,
        results: results
      }
    });
  } catch (error) {
    console.error("Error creating inventory:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * PATCH /inventory/:id
 * Mettre à jour un inventaire (pour marquer comme terminé, etc.)
 */
router.patch("/:id", async (req, res) => {
  try {
    const inventoryId = parseInt(req.params.id);
    const { status, successful, failed } = req.body;

    const inventory = await Inventory.findById(inventoryId);

    if (!inventory) {
      return res.status(404).json({ 
        success: false,
        error: "Inventaire non trouvé" 
      });
    }

    const updated = await Inventory.update(inventoryId, {
      status: status,
      successful: successful,
      failed: failed,
      completed_at: status === 'completed' ? new Date() : null
    });

    if (!updated) {
      return res.status(400).json({ 
        success: false,
        error: "Aucune modification effectuée"
      });
    }

    const updatedInventory = await Inventory.findById(inventoryId);

    res.json({
      success: true,
      message: "Inventaire mis à jour avec succès",
      inventory: Inventory.format(updatedInventory)
    });
  } catch (error) {
    console.error("Error updating inventory:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * GET /inventory/stats/overview
 * Récupérer les statistiques globales des inventaires
 */
router.get("/stats/overview", async (req, res) => {
  try {
    const stats = await Inventory.getStats();

    res.json({
      success: true,
      stats: {
        total_inventories: stats.total_inventories,
        completed: stats.completed || 0,
        in_progress: stats.in_progress || 0,
        error: stats.error || 0,
        avg_percentage: Math.round(stats.avg_percentage * 100) / 100 || 0,
        total_successful: stats.total_successful || 0,
        total_failed: stats.total_failed || 0
      }
    });
  } catch (error) {
    console.error("Error fetching inventory stats:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * DELETE /inventory/:id
 * Supprimer un inventaire
 */
router.delete("/:id", async (req, res) => {
  try {
    const inventoryId = parseInt(req.params.id);

    const inventory = await Inventory.findById(inventoryId);

    if (!inventory) {
      return res.status(404).json({ 
        success: false,
        error: "Inventaire non trouvé" 
      });
    }

    const deleted = await Inventory.delete(inventoryId);

    if (!deleted) {
      return res.status(400).json({ 
        success: false,
        error: "Erreur lors de la suppression"
      });
    }

    res.json({
      success: true,
      message: "Inventaire supprimé avec succès"
    });
  } catch (error) {
    console.error("Error deleting inventory:", error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * PUT /inventory/device/:deviceId/validate
 * Valider un device lors d'un inventaire (depuis webhook de l'étiquette)
 * Endpoint accessible sans authentification (utilisé par les étiquettes)
 */
router.put("/device/:deviceId/validate", async (req, res) => {
  try {
    const deviceId = parseInt(req.params.deviceId);

    // Vérifier que le device existe et est en mode inventaire
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: "Device non trouvé"
      });
    }

    if (device.mode !== 1) {
      return res.status(400).json({
        success: false,
        error: "Device non en mode inventaire"
      });
    }

    // Valider le device
    const validated = await Device.validateInventory(deviceId);

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
        message: "Device marqué comme valide",
        device_id: deviceId
      });
    }

    const activeInventory = activeInventories[0];

    // Incrémenter le compteur de succès
    const currentInventory = await Inventory.findById(activeInventory.iv_id);
    const newSuccessCount = (currentInventory.iv_successful || 0) + 1;

    // Vérifier si tous les devices ont été validés
    if (newSuccessCount >= currentInventory.iv_selected_devices) {
      // Marquer l'inventaire comme complété
      await Inventory.update(activeInventory.iv_id, {
        status: 'completed',
        successful: newSuccessCount,
        completed_at: new Date()
      });
    } else {
      // Mettre à jour juste le compteur
      await Inventory.update(activeInventory.iv_id, {
        successful: newSuccessCount
      });
    }

    res.json({
      success: true,
      message: "Emplacement validé",
      device_id: deviceId,
      device_name: device.name || `Étiquette #${deviceId}`,
      inventory_progress: {
        validated: newSuccessCount,
        total: currentInventory.iv_selected_devices
      }
    });
  } catch (error) {
    console.error("Error validating device:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /inventory/webhook/device-button-pressed
 * Webhook appelé par l'étiquette physique quand le bouton est appuyé
 * Endpoint SANS authentification - directement depuis l'étiquette
 */
router.post("/webhook/device-button-pressed", async (req, res) => {
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
        message: "Emplacement validé - Inventaire complété!",
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
        message: `Emplacement validé (${remainingDevices} reste)`,
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
