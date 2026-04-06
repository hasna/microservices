// --- MFA maintenance ---

server.tool(
  "auth_prune_expired_mfa_challenges",
  "Delete expired MFA challenge records from the database",
  { older_than_hours: z.number().int().positive().optional().default(24) },
  async ({ older_than_hours }) =>
    text({ pruned: await pruneExpiredMfaChallenges(sql, older_than_hours) }),
);

