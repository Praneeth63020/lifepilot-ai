import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@lifepilot/db";
import { AppError, audit, deleteUserAccount, exportUserData, type CoreContext } from "@lifepilot/core";
import { SESSION_COOKIE, uid, verifyPassword } from "../auth.js";
import { parse } from "../http.js";

export function accountRoutes(ctx: CoreContext): Router {
  const r = Router();

  r.get("/export", async (req, res) => {
    const userId = uid(req);
    const data = await exportUserData(ctx, userId);
    await audit(ctx, userId, "account.exported", "user", userId, undefined, req.ip);
    res.setHeader("content-disposition", `attachment; filename="lifepilot-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  });

  /** Requires the password again. Revokes Google tokens, cancels jobs, deletes all data. */
  r.delete("/", async (req, res) => {
    const userId = uid(req);
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    const user = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new AppError(401, "invalid_credentials", "Password is incorrect");
    }
    await deleteUserAccount(ctx, userId);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });

  return r;
}
