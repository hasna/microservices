  // ─── Bulk Pin ─────────────────────────────────────────────────────────────────
  if (name === "sessions_bulk_pin") {
    const ids = (a.session_ids as string[]).map(String);
    const results: { session_id: string; pinned: boolean }[] = [];
    for (const sid of ids) {
      try {
        await pinSession(sql, sid);
        results.push({ session_id: sid, pinned: true });
      } catch {
        results.push({ session_id: sid, pinned: false });
      }
    }
    return text({ results, pinned_count: results.filter(r => r.pinned).length });
  }

