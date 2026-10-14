// FILLCO Production Planner — self-hosted backend.
// One Node process serves the JSON REST API (/api/*) and the static
// frontend (public/), so the whole app is one thing to run on the shop's
// Windows server. See README.md for setup.
const express = require("express");
const cookieParser = require("cookie-parser");

const config = require("./config");
require("./db"); // opens the DB + runs migrations/seed before anything else
const { attachUser, requireAuth } = require("./middleware/auth");
const { errorMiddleware } = require("./util/http");

const authRoutes = require("./routes/auth");
const orderRoutes = require("./routes/orders");
const scheduleRoutes = require("./routes/schedule");
const logRoutes = require("./routes/logs");
const deliverySlipRoutes = require("./routes/deliverySlips");
const settingsRoutes = require("./routes/settings");
const userRoutes = require("./routes/users");

const app = express();
app.disable("x-powered-by");

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser(config.sessionSecret));
app.use(attachUser);

// Mounted at /api so the router's own /login, /logout, /me paths line up.
// /api/login is the only one of the three that doesn't require a session
// (enforced inside routes/auth.js itself, per-route).
app.use("/api", authRoutes);

app.use("/api/orders", requireAuth, orderRoutes);
app.use("/api/schedule", requireAuth, scheduleRoutes);
app.use("/api/logs", requireAuth, logRoutes);
app.use("/api/delivery-slips", requireAuth, deliverySlipRoutes);
app.use("/api/settings", requireAuth, settingsRoutes);
app.use("/api/users", requireAuth, userRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "No such API endpoint." });
});

// Static frontend — a later phase drops the ported UI into public/.
app.use(express.static(config.publicDir));

app.use(errorMiddleware);

app.listen(config.port, () => {
  console.log(`FILLCO Production Planner backend listening on http://0.0.0.0:${config.port}`);
  console.log(`Database file: ${config.dbPath}`);
});
