import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger le fichier .env depuis le répertoire api/
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

// Pool de connexions MySQL
const pool = mysql.createPool({
  host: process.env.DB_DOLIBARR_HOST,
  port: process.env.DB_DOLIBARR_PORT,
  user: process.env.DB_DOLIBARR_USER,
  password: process.env.DB_DOLIBARR_PASSWORD,
  database: process.env.DB_DOLIBARR_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Test de connexion à la base de données
 */
export async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log("✅ Database connected successfully");
    connection.release();
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    return false;
  }
}

export default pool;