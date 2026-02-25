import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { testConnection } from "./config/database.js";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { authenticateApiToken } from "./middleware/apiToken.js";
import { requestLogger } from "./middleware/requestLogger.js";
import logger from "./services/Logger.js";

import devicesRoutes from "./routes/devices.routes.js";
import ordersRoutes from "./routes/orders.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger le fichier .env depuis le répertoire parent
dotenv.config({ path: join(__dirname, '..', '.env') });

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Servir les fichiers statiques du dossier public
app.use(express.static(join(__dirname, 'public')));

// Middleware de logging pour toutes les requêtes
app.use(requestLogger);

app.use("/devices", authenticateApiToken, devicesRoutes);
app.use("/orders", authenticateApiToken, ordersRoutes);

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "ESL PICKING API" });
});

// Route pour la page de status
app.get("/view/devices", (req, res) => {
  res.sendFile(join(__dirname, 'public', 'devices.html'));
});

// Démarrer le serveur après avoir vérifié la connexion DB
testConnection().then((connected) => {
  if (connected) {
    app.listen(port, () => {
      logger.info(`🚀 API running on http://localhost:${port}`);
      console.log(`🚀 API running on http://localhost:${port}`);
    });
  } else {
    logger.error("⚠️  Failed to connect to database. Server not started.");
    console.error("⚠️  Failed to connect to database. Server not started.");
    process.exit(1);
  }
});