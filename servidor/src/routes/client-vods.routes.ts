import { Router } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireFeature } from "../middleware/permissions.middleware";
import { handleListVods, handleAddVod, handleDeleteVod, handleStartViewer, handleStopViewer, handleViewerStats } from "../controllers/client-vods.controller";

const router = Router();

router.get("/api/client/vods", requireAuth, requireFeature("vods"), handleListVods);
router.post("/api/client/vods", requireAuth, requireFeature("vods"), handleAddVod);
router.delete("/api/client/vods/:id", requireAuth, requireFeature("vods"), handleDeleteVod);
router.post("/api/client/vods/start", requireAuth, requireFeature("vods"), handleStartViewer);
router.post("/api/client/vods/stop", requireAuth, requireFeature("vods"), handleStopViewer);
router.get("/api/client/vods/stats", requireAuth, requireFeature("vods"), handleViewerStats);

export default router;
