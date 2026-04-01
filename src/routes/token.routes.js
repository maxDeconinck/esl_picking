import express from "express";
import MinewService from "../services/Minew.js";

const router = express.Router();

router.post('/reset', async (req, res) => {
  try {
    // Regénèrer le token Minew
    MinewService.authenticate().then(() => {
      res.json({
        success: true,
        message: "Minew API token reset successfully"
      });
    }).catch((error) => {
      console.error("Error resetting Minew API token:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    });
    
  } catch (error) {
    console.error("Error : ", error);
  }
});

export default router;