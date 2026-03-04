-- Table pour les pickings (préparations de commandes)
CREATE TABLE IF NOT EXISTS `picking` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `fk_commande` INT(11) NOT NULL COMMENT 'ID de la commande Dolibarr',
  `ref_commande` VARCHAR(128) DEFAULT NULL COMMENT 'Référence de la commande Dolibarr',
  `fk_user` INT(11) DEFAULT NULL COMMENT 'ID de l\'utilisateur Dolibarr qui fait le picking',
  `user_name` VARCHAR(255) DEFAULT NULL COMMENT 'Nom de l\'utilisateur',
  `date_debut` DATETIME NOT NULL COMMENT 'Date de début du picking',
  `date_fin` DATETIME DEFAULT NULL COMMENT 'Date de fin du picking',
  `statut` ENUM('en_attente', 'en_cours', 'termine', 'annule', 'en_erreur') DEFAULT 'en_attente' COMMENT 'Statut du picking',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fk_commande` (`fk_commande`),
  KEY `idx_fk_user` (`fk_user`),
  KEY `idx_statut` (`statut`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Gestion des pickings (préparations de commandes)';

-- Table pour le détail des produits à prélever dans chaque picking
CREATE TABLE IF NOT EXISTS `picking_detail` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `fk_picking` INT(11) NOT NULL COMMENT 'ID du picking',
  `fk_product` INT(11) NOT NULL COMMENT 'ID du produit',
  `product_ref` VARCHAR(128) DEFAULT NULL COMMENT 'Référence du produit',
  `product_name` VARCHAR(255) DEFAULT NULL COMMENT 'Nom du produit',
  `emplacement` VARCHAR(128) DEFAULT NULL COMMENT 'Emplacement du produit',
  `fk_batch` INT(11) DEFAULT NULL COMMENT 'ID du lot (pdluoid)',
  `batch_number` VARCHAR(128) DEFAULT NULL COMMENT 'Numéro de lot',
  `fk_warehouse` INT(11) DEFAULT NULL COMMENT 'ID de l\'entrepôt',
  `qty_demandee` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'Quantité demandée',
  `qty_prelevee` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'Quantité prélevée',
  `date_prelevement` DATETIME DEFAULT NULL COMMENT 'Date du prélèvement',
  `statut` ENUM('en_attente', 'partiel', 'complete') DEFAULT 'en_attente' COMMENT 'Statut de la ligne',
  `ordre` INT(11) DEFAULT NULL COMMENT 'Ordre de prélèvement (optionnel)',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fk_picking` (`fk_picking`),
  KEY `idx_fk_product` (`fk_product`),
  KEY `idx_statut` (`statut`),
  CONSTRAINT `fk_picking_detail_picking` FOREIGN KEY (`fk_picking`) REFERENCES `picking` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Détail des produits à prélever pour chaque picking';

-- Index pour optimiser les recherches
CREATE INDEX idx_picking_statut_date ON picking(statut, date_debut DESC);
CREATE INDEX idx_picking_detail_complete ON picking_detail(fk_picking, statut);
