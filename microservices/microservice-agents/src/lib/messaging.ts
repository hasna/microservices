import type { Sql } from "postgres";

export interface Message {
  id: string;
  workspace_id: string;
  from_agent_id: string | null;
  to_agent_id: string;
  type: string;
  payload: any;
  status: string;
  created_at: string;
}

export async function sendMessage(
  sql: Sql,
  data: {
    workspaceId: string;
    fromAgentId?: string;
    toAgentId: string;
    type: string;
    payload: any;
  },
): Promise<Message> {
  const [m] = await sql<Message[]>`
    INSERT INTO agents.messages (workspace_id, from_agent_id, to_agent_id, type, payload)
    VALUES (${data.workspaceId}, ${data.fromAgentId ?? null}, ${data.toAgentId}, ${data.type}, ${JSON.stringify(data.payload)})
    RETURNING *`;
  return m;
}

export async function receiveMessages(
  sql: Sql,
  agentId: string,
  opts?: { since?: string; unreadOnly?: boolean; limit?: number },
): Promise<Message[]> {
  const lim = opts?.limit ?? 50;
  if (opts?.unreadOnly && opts?.since) {
    return sql<Message[]>`
      SELECT * FROM agents.messages
      WHERE to_agent_id = ${agentId} AND status = 'pending' AND created_at > ${opts.since}
      ORDER BY created_at ASC LIMIT ${lim}`;
  }
  if (opts?.unreadOnly) {
    return sql<Message[]>`
      SELECT * FROM agents.messages
      WHERE to_agent_id = ${agentId} AND status = 'pending'
      ORDER BY created_at ASC LIMIT ${lim}`;
  }
  if (opts?.since) {
    return sql<Message[]>`
      SELECT * FROM agents.messages
      WHERE to_agent_id = ${agentId} AND created_at > ${opts.since}
      ORDER BY created_at ASC LIMIT ${lim}`;
  }
  return sql<Message[]>`
    SELECT * FROM agents.messages WHERE to_agent_id = ${agentId}
    ORDER BY created_at DESC LIMIT ${lim}`;
}

export async function markDelivered(
  sql: Sql,
  messageId: string,
): Promise<boolean> {
  const r =
    await sql`UPDATE agents.messages SET status = 'delivered' WHERE id = ${messageId} AND status = 'pending'`;
  return r.count > 0;
}

export async function markRead(sql: Sql, messageId: string): Promise<boolean> {
  const r =
    await sql`UPDATE agents.messages SET status = 'read' WHERE id = ${messageId}`;
  return r.count > 0;
}
