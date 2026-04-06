  // ─── Fork Lifecycle Management ──────────────────────────────────────────────

  if (name === "sessions_get_fork_lifecycle") {
    const { getForkLifecycle } = await import("../lib/fork-lifecycle.js");
    return text(await getForkLifecycle(sql, String(a.session_id)));
  }

  if (name === "sessions_init_fork_lifecycle") {
    const { initForkLifecycle } = await import("../lib/fork-lifecycle.js");
    return text(await initForkLifecycle(sql, String(a.session_id)));
  }

  if (name === "sessions_transition_fork_state") {
    const { transitionForkState } = await import("../lib/fork-lifecycle.js");
    return text(await transitionForkState(sql, String(a.session_id), String(a.target_state)));
  }

  if (name === "sessions_promote_fork") {
    const { promoteFork } = await import("../lib/fork-lifecycle.js");
    return text(await promoteFork(sql, String(a.fork_id), String(a.promote_to)));
  }

  if (name === "sessions_archive_fork") {
    const { archiveFork } = await import("../lib/fork-lifecycle.js");
    return text(await archiveFork(sql, String(a.fork_id)));
  }

  if (name === "sessions_list_forks_by_state") {
    const { listForksByState } = await import("../lib/fork-lifecycle.js");
    return text(await listForksByState(sql, String(a.workspace_id), String(a.state)));
  }

  if (name === "sessions_get_fork_stats") {
    const { getForkStats } = await import("../lib/fork-lifecycle.js");
    return text(await getForkStats(sql, String(a.workspace_id)));
  }

  if (name === "sessions_list_stale_orphaned_forks") {
    const { listStaleOrphanedForks } = await import("../lib/fork-lifecycle.js");
    return text(await listStaleOrphanedForks(sql, String(a.workspace_id), a.stale_threshold_days ? Number(a.stale_threshold_days) : 30));
  }

