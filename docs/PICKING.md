# Système de Picking - Documentation

## 🎯 Vue d'ensemble

Le système de picking permet de gérer la préparation de commandes avec des étiquettes électroniques (ESL). Il automatise le processus de prélèvement des produits en entrepôt.

## 📊 Fonctionnalités

### 1. Création de picking
- Sélection d'un utilisateur Dolibarr
- Sélection d'une commande à préparer
- Création automatique des lignes de produits à prélever
- Récupération automatique des emplacements et lots

### 2. Workflow de prélèvement
1. **Création** : Le picking est créé avec statut "en_attente"
2. **Démarrage** : Passage en statut "en_cours" → Les étiquettes ESL clignotent en rouge
3. **Prélèvement** : 
   - Clic sur l'étiquette ESL → Décrémente automatiquement la quantité
   - OU modification manuelle dans l'interface web
4. **Fin** : Quand tous les produits sont prélevés → Statut "terminé"

### 3. Interface web
- Liste des pickings en cours
- Affichage du progrès (X/Y produits prélevés)
- Accordéon pour voir les détails de chaque picking
- Actions disponibles :
  - Démarrer le picking
  - Relancer les étiquettes (faire clignoter à nouveau)
  - Modifier les quantités manuellement
  - Annuler le picking

## 🗄️ Structure des tables

### Table `picking`
```sql
- id : ID unique
- fk_commande : ID de la commande Dolibarr
- ref_commande : Référence de la commande
- fk_user : ID utilisateur Dolibarr
- user_name : Nom de l'utilisateur
- date_debut : Date de création
- date_fin : Date de fin (NULL si en cours)
- statut : en_attente | en_cours | termine | annule | en_erreur
```

### Table `picking_detail`
```sql
- id : ID unique
- fk_picking : ID du picking parent
- fk_product : ID du produit
- product_ref : Référence du produit
- product_name : Nom du produit
- emplacement : Emplacement en entrepôt
- fk_batch : ID du lot (pdluoid)
- batch_number : Numéro de lot
- fk_warehouse : ID de l'entrepôt
- qty_demandee : Quantité commandée
- qty_prelevee : Quantité déjà prélevée
- date_prelevement : Date du prélèvement
- statut : en_attente | partiel | complete
```

## 🔌 API Endpoints

### GET /pickings
Liste tous les pickings
```javascript
Query params:
- statut : Filtrer par statut
- fk_user : Filtrer par utilisateur
```

### GET /pickings/:id
Détails d'un picking avec ses lignes

### POST /pickings
Créer un picking
```json
{
  "fk_commande": 123,
  "fk_user": 45,
  "user_name": "John Doe"
}
```

### PUT /pickings/:id/status
Changer le statut d'un picking
```json
{
  "statut": "en_cours"
}
```

### PUT /pickings/:id/details/:detailId
Mettre à jour une quantité prélevée
```json
{
  "qty_prelevee": 5
}
```

### POST /pickings/:id/details/:detailId/increment
Incrémenter la quantité (utilisé par le clic ESL)
```json
{
  "increment": 1
}
```

### GET /pickings/orders/available
Liste des commandes Dolibarr disponibles

### GET /pickings/users/list
Liste des utilisateurs Dolibarr

## 🏷️ Intégration ESL

### Comportement des étiquettes

1. **Picking démarré** :
   - Toutes les étiquettes des produits à prélever clignotent en rouge
   - Mode = 1 (mode picking)

2. **Clic sur étiquette** :
   - Recherche du picking actif pour ce produit
   - Incrémente la quantité prélevée (+1)
   - Si quantité complète : arrête le clignotement
   - Sinon : continue de clignoter

3. **Picking terminé** :
   - Toutes les étiquettes repassent en mode normal
   - Mode = 0

## 🚀 Utilisation

### 1. Accéder à l'interface
```
http://localhost:4000/view/pickings
```

### 2. Créer un picking
1. Sélectionner l'utilisateur qui fait le picking
2. Sélectionner la commande à préparer
3. Cliquer sur "Créer le picking"

### 3. Démarrer le picking
1. Trouver le picking dans la liste
2. Cliquer dessus pour ouvrir les détails
3. Cliquer sur "▶️ Démarrer le picking"
4. Les étiquettes ESL commencent à clignoter

### 4. Prélever les produits
Deux méthodes :
- **Automatique** : Cliquer sur le bouton de l'étiquette ESL
- **Manuel** : Modifier la quantité dans l'interface web

### 5. Terminer
Le picking passe automatiquement à "terminé" quand tous les produits sont prélevés.

## 🔧 Configuration

### Variables d'environnement requises
```env
# Base de données locale
DB_HOST=127.0.0.1
DB_PORT=8889
DB_USER=root
DB_PASSWORD=root
DB_NAME=esl_picking

# Base de données Dolibarr
DB_DOLIBARR_HOST=192.168.8.33
DB_DOLIBARR_PORT=3306
DB_DOLIBARR_USER=esl_picking
DB_DOLIBARR_PASSWORD=***
DB_DOLIBARR_NAME=agriaus
DOLIBARR_TABLE_PREFIX=llx_
```

### Installation
```bash
# Créer les tables
cd src
node create-picking-tables.js

# Démarrer le serveur
npm start
```

## 📝 Notes techniques

### Gestion des lots
- Le système récupère automatiquement les informations de lots depuis Dolibarr
- Chaque ligne de picking peut avoir un lot spécifique (pdluoid)
- Le QR code généré pointe vers la bonne ligne de lot dans Dolibarr

### Performance
- Auto-refresh de la liste toutes les 10 secondes
- Requêtes optimisées avec index SQL
- Jointures pour éviter les N+1 queries

### Sécurité
- Authentification par token API
- Validation des données en entrée
- Transactions SQL pour la cohérence

## 🐛 Dépannage

### Les étiquettes ne clignotent pas
1. Vérifier que le device a bien un `mac` et un `emplacement`
2. Vérifier la connexion au service Minew
3. Vérifier les logs du serveur

### Le picking ne se termine pas automatiquement
1. Vérifier que toutes les lignes ont statut "complete"
2. Vérifier les quantités (qty_prelevee >= qty_demandee)

### Erreur "Order not found"
1. Vérifier que la commande existe dans Dolibarr
2. Vérifier que le statut de la commande est valide (1 ou 2)
3. Vérifier les permissions de l'utilisateur DB

## 📈 Évolutions futures possibles

- [ ] Historique complet des pickings
- [ ] Statistiques (temps moyen, productivité)
- [ ] Export PDF des pickings
- [ ] Notifications push
- [ ] Multi-entrepôts
- [ ] Scanner de codes-barres
- [ ] Mise à jour automatique du stock Dolibarr
