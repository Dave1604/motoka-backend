import express from "express";
import * as driverLicense from "../controllers/driverLicense.Controller.js";
import { authenticate } from "../middleware/authenticate.js"; // middleware to attach req.user

const router = express.Router();

router.use(authenticate);

router.post("/apply", driverLicense.createDriverLicense);           // Create new / renew / lost_damaged license
router.get("/license", driverLicense.getDriverLicenses);             // Get all user licenses
router.get("/:slug", driverLicense.getDriverLicenseBySlug);   // Get single license

export default router;
