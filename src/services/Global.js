import Picking from "../models/Picking.js";
import Minew from "../services/Minew.js";
import Device from "../models/Device.js";
class Global {

  /**
   * 
   * @param {*} line 
   * @param {*} device 
   * @returns {Promise<Array|boolean>} Retourne un tableau d'étiquettes à faire clignoter ou false s'il n'y en a aucune à faire clignoter
    * Règles métiers pour déterminer quelle étiquette faire clignoter lorsqu'on a plusieurs étiquettes associées à un même produit :
    * 1. On cherche l'emplacement le plus ancien et on vérifie si il a assez de quantité pour couvrir la quantité à prélever. Si oui, on prend l'étiquette associée à cet emplacement.
    * 2. Si aucun emplacement n'a assez de quantité, on ne fait clignoter aucune étiquette (on retourne false) car cela signifie que le stock est insuffisant pour prélever la quantité demandée.
  */

  static async getDeviceToBlink(line, device) {
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

  /**
   * 
   * @param {*} pickingId 
   * @param {*} line 
   * @param {*} element 
   * @param {*} stock 
   * @returns {Promise<void>} Préparer les données pour l'étiquette ESL et mettre à jour le picking en base de données
   */
  static async prepareESL(pickingId, line, element, stock, complementInformation = '') {
    let lotNumber = stock[0].batch_number || "N/A";
    let stockDisplay = line.quantity;
    if(stock.length > 0 && stock[0].batch_qty !== undefined && stock[0].batch_qty !== null) {
      stockDisplay += ' / ' + stock[0].batch_qty;
    }

    if(element.emplacement && element.emplacement.includes('FU.') && complementInformation !== '') {
      // Il faut afficher le nombre de maillon et de brin dans la quantité à prélevé pour les produits de type câble (FU.)
      stockDisplay += ` (${complementInformation})`;
    }

    // Ajouter la ligne de détail au picking
    await Picking.addDetail({
      fk_picking: pickingId,
      fk_product: line.fk_product,
      product_ref: line.product_details.ref,
      product_name: line.product_details.label,
      emplacement: element.emplacement,
      fk_batch: null,
      batch_number: lotNumber,
      fk_warehouse: stock[0].warehouse_id,
      qty_demandee: line.quantity,
      ordre: null
    });

    // Generate data for the tag
    setTimeout(async () => {
      await Minew.picking({
        mac: element.mac,
        productId: line.fk_product + '-' + element.emplacement, // On peut ajouter l'emplacement pour différencier les produits s'il y en a plusieurs
        lot: lotNumber,
        name: line.product_details.label,
        quantity: line.quantity,
        emplacement: element.emplacement,
        stock: stockDisplay, // Afficher la quantité demandée / quantité totale disponible
        ref: line.product_details.ref,
        mode: 'A prélever',
        qrcode: `https://erp.materiel-levage.com/product/stock/product.php?id=${line.fk_product}&id_entrepot=${stock[0].warehouse_id}&action=correction&pdluoid=${stock[0].batch_id}&token=minewStock&batch_number=${stock[0].batch_number}`,
        color: 7,
        total: 900,
        interval: 800,
        period : 600,
      });
    }, 100 * Math.floor(Math.random() * (25 - 6 + 1) + 9)); // Délai aléatoire entre 900 et 2500 ms pour éviter de saturer le réseau si plusieurs étiquettes doivent être mises à jour en même temps

    console.log('Tag updated for device:', element.mac);

    // Passer l'étiquette en mode picking
    await Device.update(element.id, { mode: 0 });
  }
}

export default Global;