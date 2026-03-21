/**
 * Microservice registry - metadata about all available microservices
 */

export interface MicroserviceMeta {
  name: string;
  displayName: string;
  description: string;
  category: Category;
  tags: string[];
  version?: string;
}

export const CATEGORIES = [
  "Finance",
  "CRM",
  "Operations",
  "Productivity",
  "HR",
  "Analytics",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const MICROSERVICES: MicroserviceMeta[] = [
  // Finance
  {
    name: "invoices",
    displayName: "Invoices",
    description: "Create, track, and manage invoices with line items, clients, and payment status",
    category: "Finance",
    tags: ["invoices", "billing", "payments", "clients"],
  },
  {
    name: "bookkeeping",
    displayName: "Bookkeeping",
    description: "Double-entry bookkeeping with accounts, transactions, and categories",
    category: "Finance",
    tags: ["accounting", "ledger", "transactions", "double-entry"],
  },
  {
    name: "expenses",
    displayName: "Expenses",
    description: "Track and categorize expenses with receipts and approval workflows",
    category: "Finance",
    tags: ["expenses", "receipts", "reimbursement", "budget"],
  },

  // CRM
  {
    name: "contacts",
    displayName: "Contacts",
    description: "Manage contacts, companies, and relationships with tags and notes",
    category: "CRM",
    tags: ["contacts", "companies", "people", "directory"],
  },
  {
    name: "crm",
    displayName: "CRM",
    description: "Sales pipeline with stages, deals, activities, and conversion tracking",
    category: "CRM",
    tags: ["sales", "pipeline", "deals", "leads", "crm"],
  },

  // Operations
  {
    name: "inventory",
    displayName: "Inventory",
    description: "Track products, stock levels, and inventory movements",
    category: "Operations",
    tags: ["inventory", "stock", "products", "warehouse"],
  },

  // Productivity
  {
    name: "notes",
    displayName: "Notes",
    description: "Structured notes with tags, folders, and full-text search",
    category: "Productivity",
    tags: ["notes", "markdown", "knowledge", "search"],
  },
  {
    name: "calendar",
    displayName: "Calendar",
    description: "Events, reminders, and scheduling with recurrence support",
    category: "Productivity",
    tags: ["calendar", "events", "reminders", "scheduling"],
  },
  {
    name: "documents",
    displayName: "Documents",
    description: "Document metadata, versioning, and storage references",
    category: "Productivity",
    tags: ["documents", "files", "versioning", "metadata"],
  },

  // HR
  {
    name: "timesheets",
    displayName: "Timesheets",
    description: "Time tracking per project and client with reporting",
    category: "HR",
    tags: ["time-tracking", "timesheets", "projects", "hours"],
  },

  // Productivity
  {
    name: "transcriber",
    displayName: "Transcriber",
    description: "Transcribe audio and video from files and URLs (YouTube, Vimeo, Wistia, etc.) using ElevenLabs or OpenAI Whisper",
    category: "Productivity",
    tags: ["transcription", "audio", "video", "youtube", "vimeo", "wistia", "elevenlabs", "openai", "whisper", "speech-to-text"],
  },
];

/**
 * Get a microservice by name
 */
export function getMicroservice(name: string): MicroserviceMeta | undefined {
  return MICROSERVICES.find(
    (m) => m.name === name || m.name === name.replace("microservice-", "")
  );
}

/**
 * Get microservices by category
 */
export function getMicroservicesByCategory(category: Category): MicroserviceMeta[] {
  return MICROSERVICES.filter((m) => m.category === category);
}

/**
 * Search microservices by name, description, or tags
 */
export function searchMicroservices(query: string): MicroserviceMeta[] {
  const q = query.toLowerCase();
  return MICROSERVICES.filter(
    (m) =>
      m.name.includes(q) ||
      m.displayName.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.tags.some((t) => t.includes(q))
  );
}
