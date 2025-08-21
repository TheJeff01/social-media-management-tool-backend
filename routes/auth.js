const express = require("express");
const router = express.Router();

// Health check for auth routes
router.get("/status", (req, res) => {
  res.json({
    status: "Auth service is running",
    timestamp: new Date().toISOString(),
    availableProviders: ["twitter", "linkedin", "facebook", "instagram"],
  });
});

module.exports = router;
