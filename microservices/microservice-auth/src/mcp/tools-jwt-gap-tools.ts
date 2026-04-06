// --- JWT gap tools ---

server.tool(
  "auth_sign_jwt",
  "Sign a JWT with a custom payload and expiration (for service-to-service tokens)",
  {
    sub: z.string().describe("Subject (user ID)"),
    email: z.string().describe("Email address"),
    type: z.enum(["access", "refresh"]).default("access"),
    expires_in_seconds: z.number().int().positive().optional().default(900),
  },
  async ({ sub, email, type, expires_in_seconds }) =>
    text({ token: await signJwt({ sub, email, type }, expires_in_seconds) }),
);

server.tool(
  "auth_verify_jwt",
  "Verify and decode a JWT, returning its payload",
  { token: z.string() },
  async ({ token }) => text(await verifyJwt(token)),
);

server.tool(
  "auth_generate_access_token",
  "Generate a short-lived access token (15 min) for a user",
  {
    user_id: z.string(),
    email: z.string(),
  },
  async ({ user_id, email }) =>
    text({ token: await generateAccessToken(user_id, email) }),
);

server.tool(
  "auth_generate_refresh_token",
  "Generate a long-lived refresh token (30 days) for a user",
  {
    user_id: z.string(),
    email: z.string(),
  },
  async ({ user_id, email }) =>
    text({ token: await generateRefreshToken(user_id, email) }),
);

