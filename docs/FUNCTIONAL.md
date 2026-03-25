# Système de Picking ESL — Documentation Fonctionnelle

> **Destinataires :** Responsables logistique, opérateurs entrepôt, gestionnaires de commandes  
> **Dernière mise à jour :** Mars 2026

---

## Table des matières

1. [Présentation du système](#1-présentation-du-système)
2. [Acteurs et rôles](#2-acteurs-et-rôles)
3. [Fonctionnalités principales](#3-fonctionnalités-principales)
4. [Processus de préparation d'une commande](#4-processus-de-préparation-dune-commande)
5. [Les étiquettes électroniques (ESL)](#5-les-étiquettes-électroniques-esl)
6. [Interface web — Interface de gestion](#6-interface-web--interface-de-gestion)
7. [Gestion des anomalies](#7-gestion-des-anomalies)
8. [Glossaire](#8-glossaire)

---

## 1. Présentation du système

Le **système de picking ESL** est un outil de préparation de commandes assisté par **étiquettes électroniques de rayonnage** (ESL — *Electronic Shelf Labels*).

Son objectif est de **guider physiquement les opérateurs en entrepôt** lors de la préparation des commandes clients, en utilisant des étiquettes lumineuses positionnées sur les rayonnages.

### Le problème qu'il résout

Sans ce système, un préparateur de commande doit :
1. Imprimer ou consulter une liste papier/écran
2. Parcourir l'entrepôt en cherchant les emplacements
3. Identifier le bon lot parmi plusieurs
4. Compter manuellement les quantités

Avec le système ESL, **l'étiquette du bon emplacement clignote directement**, indiquant visuellement au préparateur où aller et quoi prélever, sans qu'il ait besoin de consulter un document.

### Intégration avec l'ERP

Le système est **directement connecté à Dolibarr** (ERP de l'entreprise). Les commandes sont pilotées depuis Dolibarr. Lorsqu'une commande est prête à être préparée, l'opérateur lance le picking depuis l'interface ESL ou depuis Dolibarr — le système récupère automatiquement les lignes de la commande, les emplacements des produits et les numéros de lots en stock.

---

## 2. Acteurs et rôles

### Gestionnaire de commandes
- Suit l'état des pickings depuis l'interface web
- Lance une nouvelle préparation depuis une commande Dolibarr
- Peut annuler ou modifier manuellement une préparation

### Opérateur entrepôt (préparateur)
- Reçoit le signal visuel des étiquettes clignotantes
- Prélève les produits aux emplacements indiqués
- Valide chaque prélèvement en **appuyant sur le bouton de l'étiquette**
- Peut aussi saisir les quantités manuellement via l'interface web

### Système (automatique)
- Vérifie régulièrement les pickings bloqués (cron)
- Met à jour les affichages des étiquettes chaque nuit (cron)
- Réinitialise les étiquettes en cas d'incident

---

## 3. Fonctionnalités principales

### 3.1 Lancement d'un picking

À partir d'une commande Dolibarr, le système :
- Génère automatiquement une liste de prélèvements
- Identifie l'emplacement et le lot de chaque produit en entrepôt
- Active les étiquettes ESL correspondantes (clignotement bleu)

### 3.2 Guidage de l'opérateur

- L'étiquette clignote en bleu pour attirer l'attention
- Elle affiche le **numéro de lot à prélever** et la **quantité demandée**
- L'opérateur appuie sur le bouton de l'étiquette pour confirmer le prélèvement

### 3.3 Suivi en temps réel

- L'interface dolibarr affiche le **taux d'avancement** de chaque picking avec une pastille de couleur verte (refresh toutes les 5 secondes)
- Chaque ligne de détail indique son statut : en attente / partiel / complet (dans l'interface)
- Modification manuelle des quantités possible

### 3.4 Clôture automatique

Quand tous les articles sont prélevés :
- Le picking passe au statut **Terminé**
- Les étiquettes reviennent en **mode inventaire** (affichage du stock + QR code)
(C'est Dolibarr qui fait l'appel)

### 3.5 Fonctions de maintenance des étiquettes

- **Localiser une étiquette** : faire clignoter en violet une étiquette spécifique pour la retrouver physiquement
- **Forcer la mise à jour de l'affichage** : rafraîchir les informations d'une étiquette depuis Dolibarr
- **Détacher une étiquette** : dissocier une étiquette d'un produit (déplacement de stock)
- **Changer de mode** : basculer manuellement entre mode picking et mode inventaire

---

## 4. Processus de préparation d'une commande

### Étape 1 — Déclenchement

Le gestionnaire sélectionne une expédition dans Dolibarr ou dans l'interface web et lance la préparation. Il renseigne l'identifiant de l'opérateur qui effectuera le picking.

```
Interface web / Dolibarr
        │
        ▼
  Lancement du picking
  pour la commande CO-2024-0456
```

### Étape 2 — Activation des étiquettes

Le système parcourt automatiquement toutes les lignes de la commande. Pour chaque produit :

1. Il recherche l'emplacement du produit dans l'entrepôt (via Dolibarr)
2. Il identifie le **numéro de lot** à utiliser — en priorité le lot le plus ancien ayant une quantité suffisante (méthode FIFO)
3. Il active l'étiquette ESL correspondant à cet emplacement : elle se met à **clignoter en bleu** et affiche le lot + la quantité à prélever

```
Commande : 3 lignes
   │
   ├─ Produit A → Emplacement E.1.2.3 → Étiquette A clignote 🔴
   ├─ Produit B → Emplacement E.2.1.1 → Étiquette B clignote 🔴
   └─ Produit C → Emplacement E.3.4.2 → Étiquette C clignote 🔴
```

Le picking passe automatiquement en statut **En cours**.

### Étape 3 — Prélèvement par l'opérateur

L'opérateur parcourt l'entrepôt en suivant les étiquettes clignotantes. Pour chaque emplacement :

1. Il se rend à l'emplacement indiqué par le clignotement
2. Il prélève la quantité affichée sur l'étiquette, en vérifiant le numéro de lot affiché
3. Il **appuie sur le bouton de l'étiquette** — cela confirme le prélèvement

```
Opérateur arrive à E.1.2.3
         │
   Lit l'affichage :
   Lot : LOT-2024-001
   Quantité : 5 unités
         │
   Prélève 5 unités
         │
   Appuie sur le bouton de l'étiquette
         │
   ✅ Ligne validée — étiquette s'éteint
```

### Étape 4 — Validation

Lorsque l'opérateur appuie sur le bouton :
- La ligne de prélèvement passe au statut **Complet**
- Si toutes les lignes sont complètes, le picking passe au statut **Terminé**
- L'étiquette retourne en **mode inventaire** (affichage de stock normal)

### Étape 5 — Clôture

Une fois le picking terminé :
- Toutes les étiquettes utilisées reviennent en mode inventaire avec le stock Dolibarr actualisé
- Le gestionnaire peut consulter le récapitulatif dans l'interface web

### Validation manuelle (alternative)

Si l'opérateur ne peut pas utiliser le bouton de l'étiquette, il peut saisir les quantités prélevées directement dans l'interface web. Chaque ligne peut être mise à jour indépendamment.

---

## 5. Les étiquettes électroniques (ESL)

### Qu'est-ce qu'une étiquette ESL ?

Une étiquette ESL (marque **Minew**) est un petit écran électronique à encre numérique fixé sur un rayonnage. Elle communique sans fil via une **passerelle Minew** installée dans l'entrepôt.

Ses caractéristiques :
- Écran e-ink (lisible en toutes conditions lumineuses, même en plein soleil)
- LED colorée pour le clignotement (rouge, cyan, magenta, vert…)
- **Bouton physique** pour la validation de prélèvement
- Autonomie longue durée (piles)

### Les deux modes d'affichage

#### Mode Inventaire (mode normal)

C'est le mode permanent en dehors des opérations de picking.

L'étiquette affiche :
- La **référence** du produit
- Le **nom** du produit
- Le **numéro de lot** actuellement stocké à cet emplacement
- Le **stock disponible**
- L'**emplacement** (code du rayonnage)
- Un **QR code** permettant d'accéder directement à la fiche stock dans Dolibarr

#### Mode Picking (mode opérationnel)

Activé automatiquement lors d'un picking. L'étiquette :
- Clignote en **bleu** pour attirer l'attention
- Affiche le lot à prélever et la quantité demandée
- Attend la pression du bouton pour valider

### Codes couleur des clignotements

| Couleur | Usage |
|---|---|
| bleu | Picking actif — article à prélever |
| Cyan | Localisation d'une étiquette (test/maintenance) |
| Magenta | Localisation d'un produit ou emplacement |
| Éteint | Mode inventaire normal |

### Attribution étiquette ↔ emplacement

Chaque étiquette est associée à :
- Un **emplacement physique** (ex : `E.3.3.3` = Étagère 3, Colonne 3, Niveau 3)
- Un **produit Dolibarr** (via son ID)

Cette association est configurée dans l'interface web de gestion des étiquettes.

---

## 6. Interface web — Interface de gestion

Deux interfaces sont accessibles depuis un navigateur.

### 6.1 Interface Pickings (`/view/pickings`)

Tableau de bord principal des opérations de picking.

**Contenu :**
- Liste de tous les pickings avec leur statut (en attente, en cours, terminé, annulé)
- Barre de progression pour chaque picking (X/Y produits prélevés)
- Détail de chaque picking en accordéon : liste des lignes de prélèvement avec leur état

**Actions disponibles :**
- **Démarrer** un picking en attente (active les étiquettes)
- **Relancer les étiquettes** (faire clignoter à nouveau si une étiquette s'est éteinte)
- **Modifier une quantité** manuellement
- **Annuler** un picking en cours

### 6.2 Interface Devices (`/view/devices`)

Gestion des étiquettes ESL enregistrées dans le système.

**Contenu :**
- Liste de toutes les étiquettes avec leur emplacement et produit associé
- Indicateur du mode courant (inventaire / picking)

**Actions disponibles :**
- **Ajouter** une nouvelle étiquette (saisir adresse MAC, emplacement, produit)
- **Modifier** les informations d'une étiquette
- **Faire clignoter** une étiquette pour la localiser physiquement
- **Arrêter le clignotement** d'une étiquette
- **Forcer la mise à jour** de l'affichage depuis Dolibarr
- **Détacher** une étiquette de son produit
- **Changer le mode** d'une étiquette manuellement
- **Supprimer** une étiquette du système

---

## 7. Gestion des anomalies

### Un picking reste bloqué (opérateur absent)

Si un picking reste en statut **En cours** pendant plus d'**1 heure** sans activité, le système le détecte automatiquement (cron toutes les 30 minutes) et :
1. Stoppe le clignotement de toutes les étiquettes concernées
2. Remet les étiquettes en mode inventaire
3. Passe le picking au statut **Annulé**

Le gestionnaire peut alors relancer un nouveau picking si nécessaire.

### Une étiquette ne répond pas

Si le système ne parvient pas à envoyer une commande à une étiquette, il effectue **automatiquement une nouvelle tentative** après 500 ms. Si la deuxième tentative échoue, une erreur est enregistrée dans les logs.

Actions possibles :
1. Vérifier que la passerelle Minew est joignable
2. Vérifier les piles de l'étiquette
3. Utiliser "Forcer la mise à jour" depuis l'interface web

### Une étiquette affiche des informations incorrectes

Utiliser l'action **"Forcer la mise à jour de l'affichage"** depuis l'interface web de gestion des étiquettes. Le système récupère les données les plus récentes de Dolibarr et les envoie à l'étiquette.

La mise à jour complète de toutes les étiquettes s'effectue également **automatiquement une fois par jour** via la tâche planifiée.

### Un produit n'a pas d'étiquette associée

Si aucune étiquette n'est configurée pour l'emplacement d'un produit lors du lancement d'un picking, cette ligne est créée dans la préparation mais **sans activation d'étiquette**. L'opérateur doit traiter cette ligne manuellement depuis l'interface web.

### La connexion à Dolibarr est indisponible

Le serveur reste fonctionnel pour la gestion des étiquettes, mais il n'est plus possible de lancer de nouveaux pickings ni de mettre à jour les affichages. Les opérations en cours ne sont pas interrompues.

---

## 8. Glossaire

| Terme | Définition |
|---|---|
| **ESL** | Electronic Shelf Label — étiquette électronique de rayonnage |
| **Picking** | Opération de préparation d'une commande : prélèvement des articles en entrepôt |
| **Picking detail** | Ligne d'un picking correspondant à un article à prélever dans un emplacement précis |
| **Emplacement** | Code identifiant la position physique d'un article en entrepôt (ex : `E.3.3.3`) |
| **Lot / Batch** | Regroupement d'articles d'un même produit selon leur date de réception ou production (numéro de lot) |
| **FIFO** | First In, First Out — règle de gestion des stocks : le lot le plus ancien est prélevé en priorité |
| **Mode inventaire** | Mode normal des étiquettes : affichage du stock et du QR code Dolibarr |
| **Mode picking** | Mode opérationnel : l'étiquette clignote et affiche les informations de prélèvement |
| **Passerelle Minew** | Équipement réseau qui pilote les étiquettes ESL sans fil |
| **Dolibarr** | ERP (logiciel de gestion) de l'entreprise, source des commandes et des stocks |
| **Statut en_attente** | Picking créé mais pas encore commencé |
| **Statut en_cours** | Picking en cours de préparation — étiquettes actives |
| **Statut termine** | Picking terminé — tous les articles prélevés |
| **Statut annule** | Picking interrompu avant sa fin |
| **QR code** | Code scannable sur l'étiquette permettant d'accéder à la fiche stock Dolibarr |

---

*Documentation fonctionnelle — Système de Picking ESL v1.0.0*
