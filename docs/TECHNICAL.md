# ESL Picking API — Documentation Technique

> **Version :** 1.0.0  
> **Runtime :** Node.js (ESM)  
> **Port par défaut :** 4000

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Architecture](#2-architecture)
3. [Installation et configuration](#3-installation-et-configuration)
4. [Structure du projet](#4-structure-du-projet)
5. [Base de données](#5-base-de-données)
6. [Authentification](#6-authentification)
7. [Référence API](#7-référence-api)
   - [Devices (étiquettes ESL)](#71-devices--étiquettes-esl)
   - [Orders (commandes)](#72-orders--commandes)
   - [Pickings (préparations)](#73-pickings--préparations)
   - [CRON (tâches planifiées)](#74-cron--tâches-planifiées)
8. [Workflow de picking](#8-workflow-de-picking)
9. [Service Minew (ESL)](#9-service-minew-esl)
10. [Intégration Dolibarr](#10-intégration-dolibarr)
11. [Logging et monitoring](#11-logging-et-monitoring)
12. [Déploiement et maintenance](#12-déploiement-et-maintenance)

---

## 1. Vue d'ensemble

**ESL Picking API** est une API REST Node.js qui orchestre la préparation de commandes en entrepôt à l'aide d'**étiquettes électroniques de rayonnage** (ESL — *Electronic Shelf Labels*, matériel **Minew**).

Le système s'interface avec :
- **Dolibarr ERP** (via accès direct à sa base MySQL) pour lire les commandes, produits et stocks
- **Minew ESL Gateway** (via API REST) pour contrôler les étiquettes (clignotement, affichage, mode)
- Une **base de données locale MySQL** pour stocker les pickings et la configuration des étiquettes

**Principe de fonctionnement :**

Quand une commande est déclenchée en picking, chaque ligne de commande déclenche l'allumage de l'étiquette ESL correspondant à l'emplacement du produit en entrepôt. L'opérateur se dirige vers l'emplacement indiqué par l'étiquette clignotante, prélève la quantité indiquée, puis appuie sur le bouton de l'étiquette pour valider le prélèvement. L'étiquette revient ensuite en mode inventaire affichant le stock mis à jour.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Web UI / Dolibarr)               │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTP (Port 4000)
┌─────────────────────▼───────────────────────────────────────────┐
│                     Express.js API Server                        │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  │
│  │  /devices  │  │  /orders   │  │ /pickings  │  │  /cron   │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └────┬─────┘  │
│        │               │               │               │        │
│  ┌─────▼──────────────────────────────────────────────▼─────┐  │
│  │              Models (Device, Picking, Order, ApiToken)    │  │
│  └──────────────────────────┬────────────────────────────────┘  │
│                             │                                    │
│  ┌──────────────────────────▼────────────────────────────────┐  │
│  │              Services (DolibarrAPI, Minew, Logger)        │  │
│  └──────────────────────────────────────────────────────────-┘  │
└─────────────────────────────────────────────────────────────────┘
           │                                    │
┌──────────▼──────────┐              ┌──────────▼──────────┐
│   MySQL (Picking DB) │              │  MySQL (Dolibarr DB) │
│                      │              │                      │
│  - DEVICES           │              │  - llx_commande      │
│  - picking           │              │  - llx_commandedet   │
│  - picking_detail    │              │  - llx_product       │
│  - API_TOKENS        │              │  - llx_product_stock │
└──────────────────────┘              │  - llx_entrepot      │
                                      │  - llx_product_batch │
                                      └──────────────────────┘
                                                 │
                                      ┌──────────▼──────────┐
                                      │   Minew ESL Gateway  │
                                      │  (HTTP REST API)     │
                                      └─────────────────────-┘
```

---

## 3. Installation et configuration

### 3.1 Prérequis

- Node.js >= 18 (modules ES natifs)
- MySQL 5.7+ ou MariaDB 10.4+ (deux instances : picking + Dolibarr)
- Accès réseau à la passerelle Minew ESL

### 3.2 Installation

```bash
cd esl_picking
npm install
```

### 3.3 Variables d'environnement

Créer un fichier `.env` à la racine du projet (`esl_picking/.env`) :

```dotenv
# ── Serveur ────────────────────────────────────────────────────────
PORT=4000
NODE_ENV=production

# ── Base de données Picking (locale) ───────────────────────────────
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=votre_mot_de_passe
DB_NAME=esl_picking

# ── Base de données Dolibarr ───────────────────────────────────────
DB_DOLIBARR_HOST=localhost
DB_DOLIBARR_PORT=3306
DB_DOLIBARR_USER=dolibarr_user
DB_DOLIBARR_PASSWORD=votre_mot_de_passe
DB_DOLIBARR_NAME=dolibarr

# ── Minew ESL Gateway ──────────────────────────────────────────────
MINEW_BASE_URL=http://192.168.x.x:8080
MINEW_STORE_ID=votre_store_id
MINEW_CLIENT_ID=votre_client_id
MINEW_CLIENT_SECRET=votre_client_secret

# ── Logging Loki (optionnel) ───────────────────────────────────────
LOG_LEVEL=info
LOKI_URL=http://loki-host:3100
LOKI_USERNAME=loki_user
LOKI_PASSWORD=loki_password
```

### 3.4 Initialisation de la base de données

Exécuter le script SQL fourni dans `docs/database_picking.sql` sur la base de données picking :

```bash
mysql -u root -p esl_picking < docs/database_picking.sql
```

### 3.5 Démarrage

```bash
# Développement
npm run dev

# Production
node src/server.js
```

Le serveur démarre sur le port défini dans `PORT` (défaut : 4000).  
Deux interfaces web sont disponibles :
- `http://localhost:4000/view/devices` — Gestion des étiquettes
- `http://localhost:4000/view/pickings` — Suivi des préparations

---

## 4. Structure du projet

```
esl_picking/
├── .env                          # Variables d'environnement (non versionné)
├── package.json                  # Dépendances racine (winston-transport)
├── docs/
│   ├── database_picking.sql      # Script de création de la BDD picking
│   ├── PICKING.md                # Documentation fonctionnelle du picking
│   └── TECHNICAL.md              # Ce document
└── src/
    ├── package.json              # Dépendances principales (express, mysql2, axios…)
    ├── server.js                 # Point d'entrée Express
    ├── .minew_token.json         # Cache du token Minew (généré automatiquement)
    ├── config/
    │   ├── database.js           # Pool MySQL (base picking)
    │   └── database_dolibarr.js  # Pool MySQL (base Dolibarr)
    ├── middleware/
    │   ├── apiToken.js           # Auth API Token + Auth CRON
    │   └── requestLogger.js      # Logger HTTP des requêtes entrantes
    ├── models/
    │   ├── apiToken.js           # CRUD table API_TOKENS
    │   ├── Device.js             # CRUD table DEVICES
    │   ├── Order.js              # (réservé — lecture Dolibarr)
    │   └── Picking.js            # CRUD tables picking + picking_detail
    ├── routes/
    │   ├── devices.routes.js     # Routes /devices
    │   ├── orders.routes.js      # Routes /orders
    │   ├── picking.routes.js     # Routes /pickings
    │   └── cron.routes.js        # Routes /cron
    ├── services/
    │   ├── DolibarrAPI.js        # Accès MySQL Dolibarr (singleton)
    │   ├── Minew.js              # Client HTTP Minew Gateway (singleton)
    │   └── Logger.js             # Logger Winston (+Loki optionnel)
    └── public/                   # Fichiers statiques des interfaces web
```

### Dépendances principales

| Package | Version | Usage |
|---|---|---|
| `express` | ^5.2.1 | Framework HTTP |
| `mysql2` | ^3.15.3 | Client MySQL avec pool de connexions |
| `axios` | ^1.13.2 | Requêtes HTTP vers Minew Gateway |
| `dotenv` | ^17.2.3 | Chargement des variables d'environnement |
| `winston` | ^3.19.0 | Logging structuré |
| `winston-loki` | ^6.1.3 | Transport Loki (Grafana) |
| `jsonwebtoken` | ^9.0.3 | (disponible, non utilisé en production) |
| `cors` | ^2.8.5 | Middleware CORS |

---

## 5. Base de données

### 5.1 Base de données Picking (locale)

#### Table `DEVICES`

Stocke la configuration des étiquettes ESL physiques.

| Colonne | Type | Description |
|---|---|---|
| `de_id` | INT AUTO_INCREMENT | Identifiant unique |
| `de_mac` | VARCHAR | Adresse MAC de l'étiquette |
| `de_key` | VARCHAR | Clé d'identification Minew |
| `de_name` | VARCHAR | Nom descriptif |
| `de_pos` | VARCHAR | Emplacement en entrepôt (ex : `E.3.3.3`) |
| `de_fk_product` | INT | ID du produit Dolibarr associé (nullable) |
| `de_mode` | INT | Mode courant : `0` = picking, `1` = inventaire |
| `de_type` | VARCHAR | Type d'étiquette (modèle Minew) |

#### Table `picking`

Représente une session de préparation de commande.

| Colonne | Type | Description |
|---|---|---|
| `id` | INT AUTO_INCREMENT | Identifiant unique |
| `fk_commande` | INT | ID de la commande Dolibarr |
| `ref_commande` | VARCHAR(128) | Référence lisible de la commande |
| `fk_user` | INT | ID utilisateur Dolibarr |
| `user_name` | VARCHAR(255) | Nom de l'opérateur |
| `date_debut` | DATETIME | Date/heure de début |
| `date_fin` | DATETIME | Date/heure de fin (NULL si en cours) |
| `statut` | ENUM | `en_attente` / `en_cours` / `termine` / `annule` / `en_erreur` |
| `created_at` | DATETIME | Horodatage de création |
| `updated_at` | DATETIME | Horodatage de dernière modification |

#### Table `picking_detail`

Représente une ligne de produit à prélever dans un picking.

| Colonne | Type | Description |
|---|---|---|
| `id` | INT AUTO_INCREMENT | Identifiant unique |
| `fk_picking` | INT | Clé étrangère vers `picking.id` (CASCADE DELETE) |
| `fk_product` | INT | ID produit Dolibarr |
| `product_ref` | VARCHAR(128) | Référence produit |
| `product_name` | VARCHAR(255) | Nom du produit |
| `emplacement` | VARCHAR(128) | Emplacement physique (ex : `E.3.3.3`) |
| `fk_batch` | INT | ID du lot (`pdluoid` Dolibarr) |
| `batch_number` | VARCHAR(128) | Numéro de lot |
| `fk_warehouse` | INT | ID de l'entrepôt Dolibarr |
| `qty_demandee` | DECIMAL(10,2) | Quantité commandée |
| `qty_prelevee` | DECIMAL(10,2) | Quantité effectivement prélevée |
| `date_prelevement` | DATETIME | Date/heure du prélèvement |
| `statut` | ENUM | `en_attente` / `partiel` / `complete` |
| `ordre` | INT | Ordre de passage (optimisation du trajet) |

#### Table `API_TOKENS`

| Colonne | Type | Description |
|---|---|---|
| `apitok_id` | INT AUTO_INCREMENT | Identifiant unique |
| `apitok_name` | VARCHAR | Nom descriptif du token |
| `apitok_token` | VARCHAR(64) | Valeur du token (hex 32 octets) |
| `apitok_active` | BOOLEAN | Actif / révoqué |
| `apitok_expiresAt` | DATETIME | Date d'expiration (NULL = permanent) |
| `apitok_createdAt` | DATETIME | Date de création |
| `apitok_lastUsedAt` | DATETIME | Dernière utilisation |

### 5.2 Base de données Dolibarr (lecture seule)

L'API accède directement aux tables suivantes de Dolibarr (préfixe `llx_`) :

| Table | Usage |
|---|---|
| `llx_commande` | En-tête des commandes |
| `llx_commandedet` | Lignes de commandes (produits + quantités) |
| `llx_product` | Catalogue produits |
| `llx_product_stock` | Stocks par entrepôt |
| `llx_product_batch` | Stocks par lot |
| `llx_entrepot` | Référentiel des entrepôts et emplacements |

---

## 6. Authentification

### Routes protégées par API Token

Les routes `/devices`, `/orders` et `/pickings` requièrent un token API valide.

Le token peut être transmis de deux façons :

```http
X-API-Token: <token>
```
ou
```http
Authorization: Bearer <token>
```

Les tokens sont stockés dans la table `API_TOKENS`. Le middleware vérifie l'existence, l'état actif et la date d'expiration, puis met à jour `apitok_lastUsedAt` de façon asynchrone.

### Routes CRON

Les routes `/cron/*` utilisent un token statique distinct :

```http
X-Cron-Token: ESL_CRON_2026_ML
```
ou via query string : `?token=ESL_CRON_2026_ML`

---

## 7. Référence API

> **Base URL :** `http://localhost:4000`  
> Toutes les réponses sont en `application/json`.

---

### 7.1 Devices — Étiquettes ESL

#### `GET /devices`

Retourne toutes les étiquettes ESL enregistrées.

**Réponse** `200`
```json
{
  "success": true,
  "devices": [
    {
      "id": 1,
      "name": "Étagère A1",
      "mac": "AA:BB:CC:DD:EE:FF",
      "key": "abc123",
      "mode": 1,
      "emplacement": "E.1.1.1",
      "fk_product": 42,
      "product": null
    }
  ]
}
```

---

#### `GET /devices/:id`

Retourne une étiquette par son ID.

**Réponse** `200` — objet `device`  
**Erreur** `404` si non trouvé

---

#### `POST /devices`

Crée une nouvelle étiquette.

**Corps**
```json
{
  "name": "Étagère B2",
  "mac": "AA:BB:CC:DD:EE:FF",
  "key": "abc123",
  "emplacement": "E.2.2.2",
  "fk_product": 55
}
```

**Réponse** `201`
```json
{
  "success": true,
  "message": "Device created successfully",
  "device": { "id": 12, ... }
}
```

---

#### `PUT /devices/:id`

Met à jour les champs d'une étiquette (tous optionnels).

**Corps** (champs au choix) : `name`, `mac`, `key`, `emplacement`, `fk_product`, `mode`

---

#### `DELETE /devices/:id`

Supprime une étiquette.

---

#### `GET /devices/emplacement/:emplacement`

Trouve une étiquette par son emplacement physique.

---

#### `GET /devices/mac/:mac`

Trouve une étiquette par son adresse MAC.

---

#### `POST /devices/:id/blink`

Fait clignoter l'étiquette en **cyan** pendant 30 secondes (localisation physique).

**Réponse** `200`
```json
{
  "success": true,
  "message": "Blink command sent successfully",
  "device": { ... },
  "result": { ... }
}
```

---

#### `POST /devices/:id/turn-off-blink`

Arrête le clignotement d'une étiquette.

---

#### `POST /devices/emplacement/:id/blink`

Fait clignoter l'étiquette à l'emplacement donné en **magenta** pendant 90 secondes.

---

#### `POST /devices/product/:id/blink`

Fait clignoter toutes les étiquettes associées au produit `id` en **magenta** pendant 90 secondes.

---

#### `PATCH /devices/:id/detach`

Détache l'étiquette de son produit et vide son emplacement (`fk_product = NULL`, `emplacement = NULL`).

---

#### `POST /devices/:id/mode`

Change le mode d'affichage d'une étiquette.

**Corps**
```json
{ "mode": "inventory" }
```
ou
```json
{ "mode": "picking" }
```

- `inventory` → `de_mode = 1` + template inventaire (affiche stock + QR code)
- `picking` → `de_mode = 0` + template picking (affiche lot à prélever, clignote rouge)

---

#### `POST /devices/:id/update-screen`

Force la mise à jour de l'affichage d'une étiquette avec les données Dolibarr les plus récentes (stock, lot, QR code).

Requiert que l'étiquette soit associée à un produit (`fk_product` non NULL).

---

### 7.2 Orders — Commandes

#### `GET /orders/:id/details`

Retourne les détails complets d'une commande Dolibarr avec les emplacements et lots de chaque produit.

**Réponse** `200`
```json
{
  "success": true,
  "order": {
    "id": 123,
    "ref": "CO-2024-0456",
    "lines": [
      {
        "fk_product": 42,
        "product_ref": "REF-001",
        "product_label": "Sangle 3T",
        "qty": 5,
        "stock_locations": [
          {
            "emplacement": "E.2.1.3",
            "batch_number": "LOT-A",
            "batch_id": 18,
            "warehouse_id": 3,
            "stock_reel": 12
          }
        ]
      }
    ]
  }
}
```

---

#### `GET /orders/:id/lines`

Retourne uniquement les lignes (produits) d'une commande, sans les données de stock.

---

#### `POST /orders/:id/picking`

**Déclenche la création complète d'un picking** pour la commande `id`. C'est le point d'entrée principal du workflow.

**Corps**
```json
{
  "fk_user": 5,
  "user_name": "Jean Dupont"
}
```

**Traitement interne :**
1. Vérifie qu'aucun picking actif n'existe déjà pour cette commande
2. Crée l'enregistrement `picking` (statut `en_attente`)
3. Pour chaque ligne de commande :
   - Récupère les emplacements et lots depuis Dolibarr
   - Applique la règle de sélection d'étiquette (`getDeviceToBlink()`)
   - Appelle `prepareESL()` pour activer l'étiquette avec un délai aléatoire
4. Met à jour le statut du picking en `en_cours`

**Règle de sélection `getDeviceToBlink()` :**
- Si une seule étiquette est associée → on l'utilise
- Si plusieurs → on sélectionne celle dont le lot est le **plus ancien** avec une quantité suffisante

**Réponse** `201`
```json
{
  "success": true,
  "message": "Picking created successfully",
  "picking": { "id": 7, "statut": "en_cours", ... }
}
```

---

### 7.3 Pickings — Préparations

#### `GET /pickings`

Liste tous les pickings.

**Query params facultatifs :**
- `statut` : filtre par statut (`en_attente`, `en_cours`, `termine`, `annule`)
- `fk_user` : filtre par utilisateur Dolibarr

**Réponse** `200` — tableau enrichi avec `total_products`, `products_complete`, `progress` (%)

---

#### `GET /pickings/:id`

Retourne un picking avec ses lignes de détail.

**Réponse** `200`
```json
{
  "success": true,
  "picking": {
    "id": 7,
    "ref_commande": "CO-2024-0456",
    "statut": "en_cours",
    "total_products": 4,
    "products_complete": 1,
    "progress": 25,
    ...
  },
  "details": [
    {
      "id": 12,
      "fk_product": 42,
      "product_ref": "REF-001",
      "emplacement": "E.2.1.3",
      "batch_number": "LOT-A",
      "qty_demandee": 5,
      "qty_prelevee": 0,
      "statut": "en_attente"
    }
  ]
}
```

---

#### `GET /pickings/order/:orderId`

Trouve le picking actif (`en_attente` ou `en_cours`) pour une commande Dolibarr donnée.

---

#### `PUT /pickings/:id/status`

Change le statut d'un picking.

**Corps**
```json
{ "statut": "termine" }
```

**Valeurs autorisées :** `en_attente`, `en_cours`, `termine`, `annule`

**Effets secondaires lors du passage à `termine` ou `annule` :**
- Toutes les étiquettes ESL associées sont **réinitialisées en mode inventaire**
- Le clignotement est stoppé (`blinkTag` avec `total: 0`)
- L'affichage est mis à jour avec le stock Dolibarr actualisé (`picking()` avec données inventaire)

---

#### `PUT /pickings/:id/details/:detailId`

Met à jour la quantité prélevée d'une ligne de picking.

**Corps**
```json
{ "qty_prelevee": 3 }
```

Le statut de la ligne est automatiquement calculé :
- `en_attente` si `qty = 0`
- `partiel` si `0 < qty < qty_demandee`
- `complete` si `qty >= qty_demandee`

---

#### `DELETE /pickings/:id`

Supprime un picking et toutes ses lignes (CASCADE).  
Avant suppression, toutes les étiquettes associées sont réinitialisées en mode inventaire.

---

### 7.4 CRON — Tâches planifiées

> Authentification via `X-Cron-Token: ESL_CRON_2026_ML`

#### `GET /cron/update-all-screens`

Met à jour l'affichage de **toutes** les étiquettes affectées à un produit avec les données Dolibarr les plus récentes. Remet toutes les étiquettes en mode inventaire (`mode = 1`).

Recommandé en exécution périodique (ex : toutes les heures via `crontab`).

```bash
# crontab — toutes les heures
0 * * * * curl -s -H "X-Cron-Token: ESL_CRON_2026_ML" http://localhost:4000/cron/update-all-screens
```

---

#### `GET /cron/check-stuck-pickings`

Détecte les pickings restés en statut `en_cours` depuis plus de **60 minutes** et les réinitialise :
1. Stoppe le clignotement de chaque étiquette associée
2. Remet l'étiquette en mode inventaire avec les données Dolibarr actualisées
3. Marque le picking comme `annule`

Recommandé toutes les 30 minutes.

```bash
# crontab — toutes les 30 minutes
*/30 * * * * curl -s -H "X-Cron-Token: ESL_CRON_2026_ML" http://localhost:4000/cron/check-stuck-pickings
```

---

#### `POST /cron/button`

Webhook appelé par la passerelle Minew lors d'un **clic sur une étiquette**.

**Corps (envoyé par Minew)**
```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "buttonId": "1",
  "buttonEvent": "click",
  "buttonTime": "2024-01-15T10:30:00Z"
}
```

**Traitement :**
1. Identifie l'étiquette par son adresse MAC
2. Si elle est en **mode picking** (`mode = 0`) :
   - Cherche un picking `en_cours` dont une ligne correspond à cet emplacement + produit
   - Incrémente `qty_prelevee` de `qty_demandee` (validation en une pression)
   - Si la ligne est `complete`, remet l'étiquette en mode inventaire
3. Si elle est en mode inventaire, ignore le clic

---

## 8. Workflow de picking

### Vue d'ensemble du flux

```
Dolibarr (commande validée)
         │
         ▼
POST /orders/:id/picking
         │
         ├─ Création du picking (statut: en_attente)
         │
         ├─ Pour chaque ligne de commande :
         │    ├─ Recherche des emplacements Dolibarr
         │    ├─ Sélection de l'étiquette (règle lot le plus ancien)
         │    ├─ Création d'une ligne picking_detail
         │    └─ Activation de l'étiquette ESL (clignotement rouge)
         │
         └─ picking.statut → en_cours
                  │
                  ▼
         Opérateur en entrepôt
                  │
         ┌────────┴────────┐
         │                 │
     Bouton ESL        Interface web
         │                 │
POST /cron/button    PUT /pickings/:id/details/:detailId
         │                 │
         └────────┬────────┘
                  │
         qty_prelevee += qty_demandee (ou valeur manuelle)
         statut ligne → complete
                  │
                  ▼
         Quand toutes les lignes sont complete
                  │
         PUT /pickings/:id/status { statut: "termine" }
                  │
         Réinitialisation de toutes les étiquettes
         → mode inventaire + affichage stock Dolibarr
```

### États d'un picking

```
en_attente ──▶ en_cours ──▶ termine
                  │
                  └────────▶ annule
```

### États d'une ligne de détail

```
en_attente ──▶ partiel ──▶ complete
en_attente ──────────────▶ complete
```

---

## 9. Service Minew (ESL)

Le service `Minew.js` est un singleton (`export default new Minew()`) qui encapsule toutes les communications avec la passerelle ESL Minew.

### Authentification Minew

- Authentification via `POST /apis/action/login` (clientId + clientSecret)
- Token JWT valide 24h, mis en cache dans `.minew_token.json`
- Rafraîchissement automatique avant expiration (marge 5 s)
- En cas d'erreur, toutes les commandes font **1 retry automatique** après 500ms

### Codes couleur LED

| Nom | Code Minew |
|---|---|
| `off` | `0` |
| `blue` | `1` |
| `green` | `2` |
| `red` | `3` |
| `yellow` | `4` |
| `white` | `5` |
| `magenta` | `6` |
| `cyan` | `7` |

### Templates d'affichage

Deux templates sont configurés dans l'API Minew :

| Mode | Template ID | Usage |
|---|---|---|
| Picking | `2026214340654272512` | Affiche lot + quantité, clignote rouge |
| Inventaire | `2026695741933621248` | Affiche stock + QR code Dolibarr |

Le QR code pointe vers la fiche stock Dolibarr :
```
https://erp.materiel-levage.com/product/stock/product.php
  ?id={fk_product}
  &id_entrepot={warehouse_id}
  &action=correction
  &pdluoid={batch_id}
  &token=minewStock
  &batch_number={batch_number}
```

### Méthodes disponibles

| Méthode | Description |
|---|---|
| `blinkTag(mac, options)` | Fait clignoter une étiquette |
| `blinkMultipleTag(macs[], options)` | Clignotement groupé |
| `blinkTagByPosition(emplacement, options)` | Clignotement par emplacement |
| `addGoodsToStore(data)` | Ajoute un produit au store Minew (supprime + recrée) |
| `refreshGoodsInStore(data)` | Met à jour les données produit sans recréation |
| `picking(data)` | Active le mode picking sur une étiquette (update + blink) |
| `changeTagDisplay(mac, {mode, idData})` | Change le template d'affichage |

### Données envoyées à Minew pour un produit

```json
{
  "id": "{fk_product}-{emplacement}",
  "PartNo": "LOT-A",
  "name": "Sangle 3 tonnes",
  "quantity": 2,
  "specification": "E.2.1.3",
  "stock": 12,
  "ref": "REF-001",
  "qrcode": "https://erp.materiel-levage.com/..."
}
```

> **Note :** Le champ `id` combine `fk_product` et `emplacement` pour gérer les cas où un même produit est stocké à plusieurs emplacements.

---

## 10. Intégration Dolibarr

La connexion à Dolibarr se fait via **accès direct à la base de données MySQL** (pas de REST API Dolibarr). La classe `DolibarrAPI` est un singleton (`export default new DolibarrAPI()`).

### Méthodes disponibles

#### `getOrderLines(orderId)`
Retourne les lignes d'une commande avec les références produit depuis `llx_commandedet` + `llx_product`.

#### `getProduct(productId)`
Retourne les informations d'un produit depuis `llx_product`.

#### `getProductStock(productId, warehouseId?)`
Retourne les stocks par entrepôt depuis `llx_product_stock` + `llx_entrepot`.

#### `getDataByEmplacement(emplacement)`
**Méthode principale pour le picking.** Retourne les données de stock pour un emplacement donné :
```sql
SELECT e.ref, ps.fk_product, p.ref, p.label, ps.reel AS stock_total,
       pb.batch AS batch_number, pb.qty AS batch_qty, 
       ps.fk_entrepot, pb.rowid AS batch_id
FROM llx_entrepot e
LEFT JOIN llx_product_stock ps ON e.rowid = ps.fk_entrepot
LEFT JOIN llx_product p ON ps.fk_product = p.rowid
LEFT JOIN llx_product_batch pb ON pb.fk_product_stock = ps.rowid
WHERE e.ref LIKE '%{emplacement}%'
```

> La recherche sur `e.ref` utilise un `LIKE '%{emplacement}%'` pour correspondre aux références d'entrepôt Dolibarr qui encodent l'emplacement physique.

---

## 11. Logging et monitoring

### Logger Winston

Configurable via `LOG_LEVEL` (défaut : `info`). Format JSON structuré avec timestamp et métadonnées.

Chaque log inclut :
```json
{
  "timestamp": "2024-01-15 10:30:00",
  "level": "info",
  "message": "MinewService: blinkTag command sent",
  "service": "esl-picking-api",
  "environment": "production"
}
```

### Transport Loki (optionnel)

Si `LOKI_URL`, `LOKI_USERNAME` et `LOKI_PASSWORD` sont définis, les logs sont envoyés à **Grafana Loki** avec le label `app=esl-picking-api`. Le batching est désactivé (envoi immédiat).

### Points de log critiques

| Niveau | Événement |
|---|---|
| `info` | Commandes Minew envoyées (blink, picking, refresh) |
| `info` | Requêtes SQL exécutées (avec les 200 premiers caractères) |
| `warn` | Étiquette sans adresse MAC détectée |
| `warn` | Produit/stock non trouvé lors d'une mise à jour |
| `error` | Échec de commande Minew (avant retry) |
| `error` | Échec de requête SQL |
| `error` | Erreur d'authentification |

---

## 12. Déploiement et maintenance

### Démarrage en production (PM2)

```bash
npm install -g pm2
pm2 start src/server.js --name esl-picking-api --interpreter node
pm2 save
pm2 startup
```

### Configuration nginx (reverse proxy)

```nginx
server {
    listen 80;
    server_name esl-picking.domaine.fr;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Tâches CRON recommandées

```cron
# Mise à jour de tous les écrans — tout les jours 1x par jour
http://localhost:4000/cron/update-all-screens

# Détection des pickings bloqués — toutes les 30 minutes
http://localhost:4000/cron/check-stuck-pickings
```

### Gestion des tokens API

Pour créer un token pour une nouvelle application cliente, exécuter directement en Node.js :

```javascript
import ApiToken from './src/models/apiToken.js';
const { token } = await ApiToken.create({ name: 'Mon application' });
console.log(token); // Stocker ce token, il ne sera plus affiché
```

### Points de vérification au démarrage

Au lancement, le serveur effectue automatiquement :
1. Test de connexion à la base picking (`DB_NAME`)
2. Test de connexion à la base Dolibarr (`DB_DOLIBARR_NAME`)
3. Chargement du token Minew depuis `.minew_token.json` (si disponible)

En cas d'échec de connexion BDD, une erreur est loguée mais le serveur démarre quand même (mode dégradé).

### Ressources et limites

- Pool MySQL picking : 10 connexions simultanées max
- Pool MySQL Dolibarr : 10 connexions simultanées max
- Timeout requêtes Minew : 10 000 ms
- Token Minew : durée de vie 24h avec cache fichier
- Délai anti-saturation réseau lors d'un picking avec plusieurs étiquettes : délai aléatoire entre chaque commande Minew

---

*Documentation générée pour ESL Picking API v1.0.0*
