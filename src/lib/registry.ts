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

  {
    name: "ads",
    displayName: "Ads",
    description: "Ad campaign management across Google, Meta, LinkedIn, and TikTok with budgets, metrics, and ROAS tracking",
    category: "Finance",
    tags: ["ads", "campaigns", "advertising", "google-ads", "meta-ads", "linkedin-ads", "tiktok-ads", "roas", "marketing"],
  },
  {
    name: "subscriptions",
    displayName: "Subscriptions",
    description: "Subscription and recurring billing management with plans, subscribers, MRR/ARR analytics, churn tracking, and billing events",
    category: "Finance",
    tags: ["subscriptions", "recurring-billing", "saas", "mrr", "arr", "churn", "plans", "billing"],
  },
  {
    name: "payments",
    displayName: "Payments",
    description: "Payment processing and tracking with charges, refunds, disputes, payouts, and revenue reporting across providers",
    category: "Finance",
    tags: ["payments", "charges", "refunds", "disputes", "payouts", "revenue", "stripe", "reconciliation"],
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
  {
    name: "social",
    displayName: "Social",
    description: "Social media management with accounts, posts, templates, scheduling, and engagement analytics",
    category: "CRM",
    tags: ["social-media", "posts", "scheduling", "engagement", "analytics", "x", "linkedin", "instagram"],
  },

  // Operations
  {
    name: "inventory",
    displayName: "Inventory",
    description: "Track products, stock levels, and inventory movements",
    category: "Operations",
    tags: ["inventory", "stock", "products", "warehouse"],
  },
  {
    name: "contracts",
    displayName: "Contracts",
    description: "Manage contracts and agreements with clauses, reminders, and renewal tracking",
    category: "Operations",
    tags: ["contracts", "agreements", "nda", "clauses", "renewals", "legal"],
  },
  {
    name: "shipping",
    displayName: "Shipping",
    description: "Order management, shipment tracking, carrier costs, and returns processing",
    category: "Operations",
    tags: ["shipping", "orders", "tracking", "carriers", "returns", "delivery", "logistics"],
  },
  {
    name: "domains",
    displayName: "Domains",
    description: "Domain portfolio and DNS management with registrar tracking, SSL monitoring, expiry alerts, and DNS record management",
    category: "Operations",
    tags: ["domains", "dns", "ssl", "registrar", "nameservers", "whois", "certificates"],
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
  {
    name: "hiring",
    displayName: "Hiring",
    description: "Applicant tracking and recruitment with jobs, applicants, interviews, and pipeline management",
    category: "HR",
    tags: ["hiring", "recruitment", "applicants", "interviews", "ats", "jobs", "pipeline"],
  },
  {
    name: "payroll",
    displayName: "Payroll",
    description: "Payroll management with employees, pay periods, pay stubs, deductions, and tax reporting",
    category: "HR",
    tags: ["payroll", "salary", "wages", "deductions", "tax", "employees", "pay-stubs"],
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
