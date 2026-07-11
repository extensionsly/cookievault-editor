import { z } from 'zod';
import { CookieSchema } from './cookie.js';

/**
 * A Profile is a named snapshot of a cookie store, owned by one user.
 * Pro tier may hold many; Free tier is capped at 1 (the active set).
 */
export const ProfileSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(64),
    /** ISO 8601 timestamp; clock skew tolerated, used only for display + sync. */
    createdAt: z.string(),
    updatedAt: z.string(),
    /** Optional user-chosen tint for the UI swatch (`#rrggbb`). */
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    cookies: z.array(CookieSchema),
  })
  .strict();
export type Profile = z.infer<typeof ProfileSchema>;
