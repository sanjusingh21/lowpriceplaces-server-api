import { Router } from "express";
import { SuggestionController } from "../controllers/suggestion.controller";

const router = Router();

router.get("/", SuggestionController.getSuggestions);

export default router;
