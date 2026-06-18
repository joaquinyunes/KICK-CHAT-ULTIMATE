import { Router } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import {
  listTriggers, createTrigger, updateTrigger, deleteTrigger,
  listActions, createAction, getAction, deleteAction, getActionTypes,
} from "../controllers/actions.controller";

const router = Router();

const protect = [requireAuth, requireAdmin];

// Triggers
router.get("/api/admin/triggers", ...protect, listTriggers);
router.post("/api/admin/triggers", ...protect, createTrigger);
router.put("/api/admin/triggers/:id", ...protect, updateTrigger);
router.delete("/api/admin/triggers/:id", ...protect, deleteTrigger);

// Actions
router.get("/api/admin/actions", ...protect, listActions);
router.post("/api/admin/actions", ...protect, createAction);
router.get("/api/admin/actions/:id", ...protect, getAction);
router.delete("/api/admin/actions/:id", ...protect, deleteAction);

// Metadata
router.get("/api/admin/action-types", ...protect, getActionTypes);

export default router;
