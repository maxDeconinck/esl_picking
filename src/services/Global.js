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

    if(element.emplacement && element.emplacement.includes('FU.') && complementInformation) {
      // Il faut afficher le nombre de maillon et de brin dans la quantité à prélevé pour les produits de type câble (FU.)
      // Exemple contenu : 93 maillons pour une longueur de 1,62 m par brin de chaine
      let maillons = complementInformation.match(/(\d+)\s*maillons/i);
      let longueursBrin = complementInformation.match(/longueur\s*de\s*([\d.,]+)\s*m/i);
      let NbBrins = 0;
      if(maillons !== null && longueursBrin !== null) {
        if(longueursBrin.length > 1) {
          longueursBrin[1] = longueursBrin[1].replace(',', '.'); // Remplacer la virgule par un point pour convertir en nombre à virgule flottante
          NbBrins = Math.floor(line.quantity / longueursBrin[1].replace(',', '.')); // Calcul du nombre de brins à prélever en fonction de la quantité demandée et de la longueur d'un brin
        }
      }
      if(maillons) {
        stockDisplay = `${maillons[1]}*${NbBrins} x${line.nb_chaine}`; // Affichage du nombre de maillons et de brins à prélever
      }
    }

    if(element.serial === 'serial') {
      if(line.quantity == 1 ){
        lotNumber = stock[0].batch_number; // Si la quantité à prélever est de 1, on affiche le numéro de série complet
      } else {
        // Si le produit est en mode "serial", on n'affiche pas le numéro de lot mais les numéros de séries des produits à la place
        lotNumber = await Global.formatLots(stock.map(s => s.batch_number));
        // On garde uniquement le nombre de numéro de série égal à la quantité demandée (ex : si on doit prélever 2 produits identiques avec les numéros de série "1234" et "5678", on affiche "1234 | 5678" sur l'étiquette)
        lotNumber = lotNumber.slice(0, line.quantity);

        // Convertion en string si lotNumber est un tableau (cas où il y a plusieurs numéros de série à afficher), en séparant les numéros de série par " | "
        if(Array.isArray(lotNumber)) {
          lotNumber = lotNumber.join(" | ");
        }
      }
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

  /**
   * 
   * @param {*} batches 
   * @returns {Promise<Array>} Formater les numéros de lots pour n'afficher que les 4 derniers chiffres, en ajoutant des lettres si nécessaire pour différencier les doublons
   * Règles métiers pour formater les numéros de lots :
   * 1. Par défaut, on affiche les 4 derniers chiffres du numéro de lot.
   * 2. Si plusieurs lots ont les mêmes 4 derniers chiffres, on ajoute les lettres précédant ces chiffres pour différencier les lots.
   *    Par exemple, si on a les lots "ABC1234" et "DEF1234", on affichera "ABC1234" et "DEF1234" au lieu de "1234" pour les deux.
   * 3. Si un lot n'a pas de lettres précédant les 4 derniers chiffres, on l'affiche tel quel (ex : "1234").
   * 4. Si un lot a moins de 4 caractères, on affiche le lot entier (ex : "123").
   * 5. Si un lot est vide ou null, on affiche "N/A".
   */
  static async formatLots(batches) {

    const base = batches.map(b => ({
      full: b,
      short: b.slice(-4)
    }));

    const counts = {};
    base.forEach(b => {
      counts[b.short] = (counts[b.short] || 0) + 1;
    });

    base.forEach(b => {
      if (counts[b.short] > 1) {
        const letters = b.full.match(/[A-Z]+/g)?.pop() || '';
        b.short = `${letters}${b.short}`;
      }
    });

    return base.map(b => b.short);
  }
}

export default Global;