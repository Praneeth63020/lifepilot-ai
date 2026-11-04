import { Router } from "express";
import { z } from "zod";
import { editPlanItems, generatePlan, getCurrentPlan, getPrefs, setPlanStatus, type CoreContext } from "@lifepilot/core";
import { localDate, planGenerateSchema, planItemsUpdateSchema } from "@lifepilot/shared";
import { uid } from "../auth.js";
import { idParam, parse } from "../http.js";
import { planDTO } from "../serialize.js";

export function planRoutes(ctx: CoreContext): Router {
  const r = Router();

  r.get("/current", async (req, res) => {
    const userId = uid(req);
    const { date } = parse(z.object({ date: z.iso.date().optional() }), req.query);
    const prefs = await getPrefs(ctx, userId);
    const plan = await getCurrentPlan(ctx, userId, date ?? localDate(ctx.now(), prefs.timezone));
    res.json({ plan: plan ? planDTO(plan) : null });
  });

  r.post("/generate", async (req, res) => {
    const { date } = parse(planGenerateSchema, req.body ?? {});
    res.status(201).json({ plan: planDTO(await generatePlan(ctx, uid(req), date)) });
  });

  /** Re-plan today from the current time (missed tasks, new events). Returns a proposal plus what changed. */
  r.post("/replan", async (req, res) => {
    res.status(201).json({ plan: planDTO(await generatePlan(ctx, uid(req))) });
  });

  r.post("/:id/accept", async (req, res) => {
    res.json({ plan: planDTO(await setPlanStatus(ctx, uid(req), idParam(req), "accepted")) });
  });

  r.post("/:id/reject", async (req, res) => {
    res.json({ plan: planDTO(await setPlanStatus(ctx, uid(req), idParam(req), "rejected")) });
  });

  r.patch("/:id/items", async (req, res) => {
    const { items } = parse(planItemsUpdateSchema, req.body);
    res.json({ plan: planDTO(await editPlanItems(ctx, uid(req), idParam(req), items)) });
  });

  return r;
}
