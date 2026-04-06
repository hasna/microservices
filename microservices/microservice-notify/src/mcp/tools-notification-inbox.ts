// ─── Notification Inbox ────────────────────────────────────────────────────────

server.tool(
  "notify_add_to_inbox",
  "Add a notification to a user's inbox",
  {
    user_id: z.string(),
    workspace_id: z.string().optional(),
    notification_id: z.string().optional(),
    title: z.string(),
    body: z.string(),
    channel: z.string(),
    priority: z.number().optional().default(0),
  },
  async (opts) => text(await addToInbox(sql, {
    userId: opts.user_id,
    workspaceId: opts.workspace_id,
    notificationId: opts.notification_id,
    title: opts.title,
    body: opts.body,
    channel: opts.channel,
    priority: opts.priority,
  })),
);

server.tool(
  "notify_get_inbox_badge",
  "Get unread badge counts for a user's inbox",
  { user_id: z.string() },
  async ({ user_id }) => text(await getInboxBadgeCount(sql, user_id)),
);

server.tool(
  "notify_list_inbox",
  "List items in a user's notification inbox",
  {
    user_id: z.string(),
    status: z.enum(["unread", "read", "archived", "deleted"]).optional(),
    channel: z.string().optional(),
    search: z.string().optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async (opts) => text(await listInboxItems(sql, opts.user_id, {
    status: opts.status,
    channel: opts.channel,
    search: opts.search,
    limit: opts.limit,
    offset: opts.offset,
  })),
);

server.tool(
  "notify_mark_inbox_read",
  "Mark an inbox item as read",
  { item_id: z.string(), user_id: z.string() },
  async ({ item_id, user_id }) =>
    text({ marked: await markInboxRead(sql, item_id, user_id) }),
);

server.tool(
  "notify_archive_inbox_item",
  "Archive an inbox item (soft-delete, user can still view)",
  { item_id: z.string(), user_id: z.string() },
  async ({ item_id, user_id }) =>
    text({ archived: await archiveInboxItem(sql, item_id, user_id) }),
);

server.tool(
  "notify_delete_inbox_item",
  "Permanently delete an inbox item",
  { item_id: z.string(), user_id: z.string() },
  async ({ item_id, user_id }) =>
    text({ deleted: await deleteInboxItem(sql, item_id, user_id) }),
);

server.tool(
  "notify_mark_all_inbox_read",
  "Mark all unread inbox items as read for a user",
  { user_id: z.string() },
  async ({ user_id }) => text({ marked: await markAllInboxRead(sql, user_id) }),
);

server.tool(
  "notify_prune_read_inbox_items",
  "Archive old read inbox items (default: items older than 30 days)",
  { user_id: z.string(), older_than_days: z.number().optional().default(30) },
  async ({ user_id, older_than_days }) =>
    text({ pruned: await pruneReadItems(sql, user_id, older_than_days) }),
);

