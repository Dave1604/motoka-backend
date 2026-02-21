import express from "express";
import { testSupabaseConnection } from "../controllers/testController.js";

const router = express.Router();

router.get("/test-db", testSupabaseConnection);

export default router;
