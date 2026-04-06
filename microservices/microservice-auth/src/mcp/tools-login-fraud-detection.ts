// --- Login fraud detection ---

server.tool(
  "auth_check_impossible_travel",
  "Detect impossible travel between two login events (geographically implausible speed)",
  {
    user_id: z.string().describe("User UUID"),
    ip: z.string().describe("Current IP address"),
    window_hours: z.number().int().positive().optional().default(24).describe("Hours to look back for prior login"),
    max_speed_kmh: z.number().int().positive().optional().default(900).describe("Max travel speed in km/h"),
  },
  async ({ user_id, ip, window_hours, max_speed_kmh }) => {
    const result = await checkImpossibleTravel(sql, user_id, ip, { window_hours, max_speed_kmh });
    return text(result);
  },
);

server.tool(
  "auth_check_new_device",
  "Check if a login is from a new/unrecognized device",
  {
    user_id: z.string().describe("User UUID"),
    device_fingerprint: z.string().describe("Device fingerprint hash"),
  },
  async ({ user_id, device_fingerprint }) => {
    const result = await checkNewDevice(sql, user_id, device_fingerprint);
    return text(result);
  },
);

server.tool(
  "auth_check_login_velocity",
  "Check if too many login attempts are occurring in a short window",
  {
    email: z.string().describe("User email"),
    window_minutes: z.number().int().positive().optional().default(5),
    max_attempts: z.number().int().positive().optional().default(5),
  },
  async ({ email, window_minutes, max_attempts }) => {
    const result = await checkLoginVelocity(sql, email, { window_minutes, max_attempts });
    return text(result);
  },
);

server.tool(
  "auth_check_credential_stuffing",
  "Detect multiple accounts being accessed from the same IP (potential credential stuffing)",
  {
    ip_address: z.string().describe("IP address to check"),
    window_hours: z.number().int().positive().optional().default(24),
    threshold: z.number().int().positive().optional().default(3),
  },
  async ({ ip_address, window_hours, threshold }) => {
    const result = await checkCredentialStuffing(sql, ip_address, { window_hours, threshold });
    return text(result);
  },
);

server.tool(
  "auth_check_login_fraud",
  "Run all fraud checks on a login and return an overall fraud score",
  {
    user_id: z.string().describe("User UUID"),
    email: z.string().describe("User email"),
    ip: z.string().describe("Current IP address"),
    device_fingerprint: z.string().optional().describe("Device fingerprint hash"),
  },
  async ({ user_id, email, ip, device_fingerprint }) => {
    const result = await checkLoginFraud(sql, user_id, email, ip, device_fingerprint);
    return text(result);
  },
);

