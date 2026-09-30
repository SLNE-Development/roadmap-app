import type { Priority } from "@/db/schema";

/** One system of a demo project; `domain` and `phase` index the project's lists. */
export interface SeedSystem {
  slug: string;
  title: string;
  summary: string;
  domain: number;
  phase: number;
  priority: Priority;
}

/** One demo project with its structure, systems and decision titles. */
export interface SeedProject {
  slug: string;
  name: string;
  description: string;
  repo: string;
  boards: [string, string];
  domains: string[];
  systems: SeedSystem[];
  adrs: string[];
}

/** Display names of the demo users, besides the signed-in admin. */
export const DEMO_PEOPLE = ["Mara Lindqvist", "Jonas Petrov", "Aiko Tanaka", "Luis Ferreira", "Noor Haddad", "Tobias Keller", "Sven Olsen", "Priya Raman", "Elena Costa", "Kwame Mensah", "Ines Moreau"];

/** Delivery phases every demo project uses, with their goals. */
export const PHASES: { name: string; goal: string }[] = [
  { name: "Foundations", goal: "Repository, CI, shared libraries and the data model everything else builds on." },
  { name: "Core loop", goal: "The smallest playable or usable path from start to finish, end to end." },
  { name: "Internal alpha", goal: "Staff can use every MVP system daily; crashes and data loss are the only blockers." },
  { name: "Content pass", goal: "Fill the systems with real content, balancing and copy." },
  { name: "Closed beta", goal: "A few hundred invited users; measure retention and collect structured feedback." },
  { name: "Hardening", goal: "Load tests, failure drills, backups restored at least once, alerting tuned." },
  { name: "Launch", goal: "Public release with a rollback plan and a staffed launch week." },
  { name: "Live ops", goal: "Weekly releases, events and a stable on-call rotation." },
  { name: "Expansion", goal: "Second wave of features chosen from beta and live data." },
  { name: "Sunset legacy", goal: "Retire the old stack and migrate the last remaining data." },
];

/** The ten demo projects. */
export const PROJECTS: SeedProject[] = [
  {
    slug: "surf-roleplay",
    name: "Surf Roleplay",
    description: "A city roleplay server: jobs, police, medics, housing and a player-driven economy on a single persistent map.",
    repo: "https://github.com/slne-development/surf-roleplay",
    boards: ["Gameplay", "Operations"],
    domains: ["Police", "Medics", "Vehicles", "Economy", "Housing", "Jobs", "Phones", "Chat", "Admin tools", "World"],
    systems: [
      { slug: "arrest-flow", title: "Arrest and jail flow", summary: "Cuffing, transport, booking and timed jail cells with an appeal path.", domain: 0, phase: 1, priority: "MVP" },
      { slug: "dispatch", title: "Emergency dispatch", summary: "911 calls routed to on-duty police and medics with a live map marker.", domain: 0, phase: 2, priority: "MVP" },
      { slug: "revive-system", title: "Downed and revive system", summary: "Players go down instead of dying; medics revive, bleed-out timer otherwise.", domain: 1, phase: 1, priority: "MVP" },
      { slug: "vehicle-garage", title: "Vehicle garages", summary: "Store, retrieve and impound vehicles with per-garage capacity.", domain: 2, phase: 2, priority: "MVP" },
      { slug: "fuel", title: "Fuel and gas stations", summary: "Vehicles consume fuel; stations are owned businesses with dynamic prices.", domain: 2, phase: 3, priority: "Later" },
      { slug: "bank-accounts", title: "Bank accounts and transfers", summary: "Personal and shared accounts, transfers, statements and ATM access.", domain: 3, phase: 0, priority: "MVP" },
      { slug: "property-market", title: "Property market", summary: "Buy, rent and sell apartments and houses through an estate agent job.", domain: 4, phase: 3, priority: "Later" },
      { slug: "job-center", title: "Job center", summary: "Pick legal jobs, see pay rates and track shifts and promotions.", domain: 5, phase: 2, priority: "MVP" },
      { slug: "smartphone", title: "Smartphone UI", summary: "In-game phone with contacts, messages, bank app and camera.", domain: 6, phase: 4, priority: "Later" },
      { slug: "proximity-chat", title: "Proximity chat", summary: "Local chat by distance with whisper, shout and radio channels.", domain: 7, phase: 1, priority: "MVP" },
      { slug: "staff-panel", title: "Staff panel", summary: "Spectate, teleport, inventory view and a report queue for moderators.", domain: 8, phase: 2, priority: "MVP" },
      { slug: "weather-cycle", title: "Weather and day cycle", summary: "Synced real-time day cycle with scripted weather events.", domain: 9, phase: 8, priority: "Nice to have" },
    ],
    adrs: ["Use Postgres as the single source of truth for player state", "Model money as integer cents", "Run jobs as separate modules with a shared API", "Persist vehicles as entities, not items", "Use RabbitMQ between game and backend services", "Keep jail time in real time, not online time", "Render the phone as a map-based UI", "Store chat logs for 30 days only", "Use Redis for cross-server player sessions", "Replace the custom permission system with LuckPerms groups", "Ship the map as a versioned artifact"],
  },
  {
    slug: "surf-cloud",
    name: "Surf Cloud",
    description: "Orchestration for our server network: templates, scaling, service discovery and zero-downtime deploys.",
    repo: "https://github.com/slne-development/surf-cloud",
    boards: ["Platform", "Tooling"],
    domains: ["Scheduling", "Templates", "Networking", "Storage", "Observability", "Security", "CLI", "Dashboard", "Proxies", "Billing"],
    systems: [
      { slug: "node-agent", title: "Node agent", summary: "Daemon on each host that starts, stops and reports server processes.", domain: 0, phase: 0, priority: "MVP" },
      { slug: "autoscaler", title: "Autoscaler", summary: "Scales lobby and minigame groups by player count and queue length.", domain: 0, phase: 2, priority: "MVP" },
      { slug: "template-store", title: "Template store", summary: "Versioned server templates with layered plugins, configs and worlds.", domain: 1, phase: 1, priority: "MVP" },
      { slug: "service-registry", title: "Service registry", summary: "Live list of running services with health, tags and metadata.", domain: 2, phase: 1, priority: "MVP" },
      { slug: "world-snapshots", title: "World snapshots", summary: "Scheduled world backups to object storage with point-in-time restore.", domain: 3, phase: 5, priority: "MVP" },
      { slug: "metrics-pipeline", title: "Metrics pipeline", summary: "TPS, memory and player metrics into Prometheus with Grafana boards.", domain: 4, phase: 2, priority: "Later" },
      { slug: "secret-injection", title: "Secret injection", summary: "Inject database and API credentials at start instead of baking them into templates.", domain: 5, phase: 3, priority: "MVP" },
      { slug: "cloud-cli", title: "Cloud CLI", summary: "Command-line client for deploys, logs and console attach.", domain: 6, phase: 2, priority: "Later" },
      { slug: "web-dashboard", title: "Web dashboard", summary: "Browser view of groups, services, logs and deploy history.", domain: 7, phase: 4, priority: "Later" },
      { slug: "proxy-sync", title: "Proxy sync", summary: "Keep Velocity proxies in sync with the registry without restarts.", domain: 8, phase: 1, priority: "MVP" },
      { slug: "rolling-deploys", title: "Rolling deploys", summary: "Drain and replace servers group by group with automatic rollback.", domain: 0, phase: 5, priority: "MVP" },
      { slug: "cost-reports", title: "Cost reports", summary: "Monthly cost per group from host hours and storage.", domain: 9, phase: 8, priority: "Nice to have" },
    ],
    adrs: ["Write the node agent in Kotlin", "Use gRPC between controller and agents", "Store templates as OCI artifacts", "Elect one controller with Raft", "Push metrics instead of scraping agents", "Keep world snapshots in S3-compatible storage", "Refuse secrets in templates", "Drain servers before replacing them", "Expose one public API for CLI and dashboard", "Pin Paper versions per template", "Retire the legacy bash deploy scripts"],
  },
  {
    slug: "surf-anticheat",
    name: "Surf Anticheat",
    description: "Server-side cheat detection with explainable flags, replay evidence and a review queue for staff.",
    repo: "https://github.com/slne-development/surf-anticheat",
    boards: ["Detection", "Review tooling"],
    domains: ["Movement", "Combat", "Inventory", "World", "Network", "Evidence", "Review", "Punishments", "Tuning", "Reporting"],
    systems: [
      { slug: "speed-check", title: "Speed check", summary: "Detect horizontal movement faster than the physics model allows.", domain: 0, phase: 1, priority: "MVP" },
      { slug: "fly-check", title: "Fly check", summary: "Detect sustained air time without elytra, levitation or riptide.", domain: 0, phase: 1, priority: "MVP" },
      { slug: "reach-check", title: "Reach check", summary: "Compare hit distance against lag-compensated player positions.", domain: 1, phase: 2, priority: "MVP" },
      { slug: "autoclicker", title: "Autoclicker detection", summary: "Statistical click-interval analysis per player session.", domain: 1, phase: 3, priority: "Later" },
      { slug: "inventory-check", title: "Inventory manipulation", summary: "Flag impossible inventory actions while moving or with a closed window.", domain: 2, phase: 3, priority: "Later" },
      { slug: "xray-heuristic", title: "X-ray heuristic", summary: "Ore-to-stone mining ratios compared against the server baseline.", domain: 3, phase: 4, priority: "Later" },
      { slug: "packet-limiter", title: "Packet limiter", summary: "Rate-limit packet floods before they reach game logic.", domain: 4, phase: 0, priority: "MVP" },
      { slug: "replay-capture", title: "Replay capture", summary: "Keep a 60-second rolling buffer per player and save it on a flag.", domain: 5, phase: 2, priority: "MVP" },
      { slug: "review-queue", title: "Review queue", summary: "Staff review flags with replay, verdict and notes.", domain: 6, phase: 2, priority: "MVP" },
      { slug: "auto-punish", title: "Automatic punishments", summary: "Only for high-confidence checks, with a staff undo.", domain: 7, phase: 5, priority: "Later" },
      { slug: "threshold-tuning", title: "Threshold tuning", summary: "Tune per-check thresholds from labelled review verdicts.", domain: 8, phase: 5, priority: "Later" },
      { slug: "weekly-report", title: "Weekly report", summary: "Flags, verdicts and false-positive rate per check, mailed to staff.", domain: 9, phase: 7, priority: "Nice to have" },
    ],
    adrs: ["Detect on the server only", "Score violations instead of flagging single events", "Use lag compensation from transaction packets", "Keep replays for 14 days", "Never auto-ban on a single check", "Run checks off the main thread", "Store verdicts as training labels", "Expose check results over the event bus", "Hide check names from players", "Version thresholds with the plugin", "Replace the vendor anticheat"],
  },
  {
    slug: "surf-parkour",
    name: "Surf Parkour",
    description: "Timed parkour courses with leaderboards, checkpoints, a course editor and seasonal rankings.",
    repo: "https://github.com/slne-development/surf-parkour",
    boards: ["Game", "Editor"],
    domains: ["Courses", "Timing", "Leaderboards", "Editor", "Rewards", "Cosmetics", "Seasons", "Lobby", "Anti-abuse", "Stats"],
    systems: [
      { slug: "course-runtime", title: "Course runtime", summary: "Start, checkpoints, finish and reset for a single run.", domain: 0, phase: 1, priority: "MVP" },
      { slug: "tick-timer", title: "Tick-accurate timer", summary: "Measure runs in server ticks and show milliseconds to players.", domain: 1, phase: 1, priority: "MVP" },
      { slug: "global-leaderboard", title: "Global leaderboards", summary: "Top times per course with personal bests and ghost links.", domain: 2, phase: 2, priority: "MVP" },
      { slug: "course-editor", title: "In-game course editor", summary: "Place start, checkpoints and finish with a wand and publish a draft.", domain: 3, phase: 3, priority: "MVP" },
      { slug: "ghost-runs", title: "Ghost runs", summary: "Race a translucent replay of your best or the world record.", domain: 2, phase: 4, priority: "Later" },
      { slug: "coin-rewards", title: "Coin rewards", summary: "Coins for first clears and medals, spent in the cosmetics shop.", domain: 4, phase: 3, priority: "Later" },
      { slug: "trails", title: "Particle trails", summary: "Cosmetic trails unlocked by medals and seasons.", domain: 5, phase: 4, priority: "Nice to have" },
      { slug: "seasons", title: "Seasonal rankings", summary: "Three-month seasons with reset leaderboards and rewards.", domain: 6, phase: 7, priority: "Later" },
      { slug: "lobby-portals", title: "Lobby portals", summary: "Difficulty-sorted portals with live player counts.", domain: 7, phase: 2, priority: "MVP" },
      { slug: "shortcut-detection", title: "Shortcut detection", summary: "Flag runs that skip checkpoints or teleport.", domain: 8, phase: 5, priority: "MVP" },
      { slug: "player-stats", title: "Player stats page", summary: "Runs, clears, medals and time played per player.", domain: 9, phase: 4, priority: "Later" },
      { slug: "course-ratings", title: "Course ratings", summary: "Players rate courses after clearing them.", domain: 0, phase: 8, priority: "Nice to have" },
    ],
    adrs: ["Time runs in ticks", "Store courses as JSON documents", "Keep leaderboards in Redis sorted sets", "Record ghosts as position deltas", "Require a review before a course goes live", "Reset seasons at a fixed UTC time", "Use one world per difficulty", "Sign run results on the server", "Show milliseconds only after finishing", "Cap coin rewards per day", "Drop the old sign-based course format"],
  },
  {
    slug: "surf-event",
    name: "Surf Event",
    description: "A dedicated server for weekend events: tournaments, build contests and seasonal minigames.",
    repo: "https://github.com/slne-development/surf-event",
    boards: ["Events", "Infrastructure"],
    domains: ["Tournaments", "Build contests", "Minigames", "Scheduling", "Teams", "Spectating", "Prizes", "Moderation", "Streaming", "Feedback"],
    systems: [
      { slug: "bracket-engine", title: "Bracket engine", summary: "Single and double elimination brackets with seeding and byes.", domain: 0, phase: 1, priority: "MVP" },
      { slug: "build-plots", title: "Build contest plots", summary: "Timed plots per team with a locked theme reveal.", domain: 1, phase: 2, priority: "MVP" },
      { slug: "judging", title: "Judging and voting", summary: "Staff judging rubric plus community vote with weighting.", domain: 1, phase: 3, priority: "MVP" },
      { slug: "spleef", title: "Spleef minigame", summary: "Classic spleef with shrinking arenas and power-ups.", domain: 2, phase: 1, priority: "Later" },
      { slug: "event-calendar", title: "Event calendar", summary: "Announce events in game and on Discord with reminders.", domain: 3, phase: 2, priority: "MVP" },
      { slug: "team-signup", title: "Team sign-up", summary: "Create teams, invite players and lock rosters before start.", domain: 4, phase: 1, priority: "MVP" },
      { slug: "spectator-mode", title: "Spectator mode", summary: "Free cam and player follow for eliminated players and casters.", domain: 5, phase: 3, priority: "Later" },
      { slug: "prize-delivery", title: "Prize delivery", summary: "Deliver prizes across the network, including offline players.", domain: 6, phase: 4, priority: "MVP" },
      { slug: "event-moderation", title: "Event moderation", summary: "Pause, disqualify and rewind rounds.", domain: 7, phase: 3, priority: "MVP" },
      { slug: "stream-overlay", title: "Stream overlay", summary: "Web overlay showing brackets and scores for casters.", domain: 8, phase: 6, priority: "Nice to have" },
      { slug: "feedback-survey", title: "Post-event survey", summary: "Short in-game survey after each event.", domain: 9, phase: 7, priority: "Later" },
      { slug: "map-rotation", title: "Map rotation", summary: "Rotate arena maps per round with a veto phase.", domain: 2, phase: 4, priority: "Later" },
    ],
    adrs: ["Reset the event server from a template each weekend", "Store brackets as an event log", "Use Discord as the announcement channel", "Weight community votes at 30 percent", "Deliver prizes through the transaction service", "Run minigames as separate worlds", "Disallow roster changes after check-in", "Expose a read-only overlay API", "Keep spectators in adventure mode", "Record every round for disputes", "Drop the manual prize spreadsheet"],
  },
  {
    slug: "roadmap-app",
    name: "Roadmap App",
    description: "This app: project roadmaps, planning interviews, specs and ADRs shared between people and coding agents.",
    repo: "https://github.com/slne-development/roadmap-app",
    boards: ["Product", "Agent tooling"],
    domains: ["Boards", "Planning", "Documents", "Decisions", "Questions", "Access", "MCP", "REST API", "History", "Design"],
    systems: [
      { slug: "kanban-board", title: "Kanban board", summary: "Drag systems between columns with the planning gate enforced.", domain: 0, phase: 1, priority: "MVP" },
      { slug: "planning-interview", title: "Planning interview", summary: "Rounds of questions across four areas before a system may leave planning.", domain: 1, phase: 1, priority: "MVP" },
      { slug: "spec-versions", title: "Versioned specs", summary: "Append-only spec and plan versions with a diff view.", domain: 2, phase: 2, priority: "MVP" },
      { slug: "adr-register", title: "ADR register", summary: "Numbered ADRs with accept and supersede.", domain: 3, phase: 2, priority: "MVP" },
      { slug: "open-questions", title: "Open questions", summary: "Questions per project and system with answers.", domain: 4, phase: 2, priority: "Later" },
      { slug: "discord-login", title: "Discord login", summary: "Sign in with Discord, limited to an allowlist.", domain: 5, phase: 0, priority: "MVP" },
      { slug: "mcp-server", title: "MCP server", summary: "Every operation exposed as an MCP tool for coding agents.", domain: 6, phase: 1, priority: "MVP" },
      { slug: "rest-api", title: "REST API", summary: "The same tools over HTTP with API keys.", domain: 7, phase: 3, priority: "Later" },
      { slug: "change-history", title: "Change history", summary: "Every change logged with author and agent.", domain: 8, phase: 2, priority: "MVP" },
      { slug: "redesign", title: "Visual redesign", summary: "A coherent design system across every page and component.", domain: 9, phase: 3, priority: "MVP" },
      { slug: "notifications", title: "Notifications", summary: "Discord pings when a system you own changes.", domain: 5, phase: 7, priority: "Nice to have" },
      { slug: "search", title: "Global search", summary: "Search systems, specs, ADRs and questions across projects.", domain: 0, phase: 8, priority: "Later" },
    ],
    adrs: ["Use Next.js with server actions", "Keep one ops layer for UI, MCP and REST", "Use Postgres with Drizzle", "Make documents append-only", "Gate leaving planning on a complete interview", "Authenticate with Discord only", "Use UUIDv7 for ids", "Log every change in one table", "Attribute agent writes to their user", "Deploy on Coolify", "Replace SQLite with Postgres"],
  },
  {
    slug: "surf-friends",
    name: "Surf Friends",
    description: "Friends, parties and presence across the whole network, in game and on the web.",
    repo: "https://github.com/slne-development/surf-friends",
    boards: ["Social", "Backend"],
    domains: ["Friends", "Parties", "Presence", "Messaging", "Privacy", "Blocking", "Notifications", "Web", "Discord", "Data"],
    systems: [
      { slug: "friend-requests", title: "Friend requests", summary: "Send, accept, deny and expire requests with rate limits.", domain: 0, phase: 0, priority: "MVP" },
      { slug: "party-system", title: "Parties", summary: "Create a party, invite friends and follow the leader across servers.", domain: 1, phase: 1, priority: "MVP" },
      { slug: "presence", title: "Online presence", summary: "Show which server a friend is on, respecting privacy settings.", domain: 2, phase: 1, priority: "MVP" },
      { slug: "direct-messages", title: "Direct messages", summary: "Cross-server private messages with offline delivery.", domain: 3, phase: 2, priority: "MVP" },
      { slug: "privacy-settings", title: "Privacy settings", summary: "Who can send requests, see presence or join you.", domain: 4, phase: 2, priority: "MVP" },
      { slug: "block-list", title: "Block list", summary: "Blocking hides messages, requests and presence both ways.", domain: 5, phase: 2, priority: "MVP" },
      { slug: "join-notifications", title: "Join notifications", summary: "Tell players when friends come online, with a mute option.", domain: 6, phase: 3, priority: "Later" },
      { slug: "web-friends", title: "Web friends list", summary: "See and manage friends from the website.", domain: 7, phase: 4, priority: "Later" },
      { slug: "discord-link", title: "Discord link", summary: "Link Discord accounts and import mutual friends.", domain: 8, phase: 8, priority: "Nice to have" },
      { slug: "friend-export", title: "Data export", summary: "Export friends and messages on request.", domain: 9, phase: 6, priority: "Later" },
      { slug: "party-chat", title: "Party chat", summary: "A chat channel for the party that follows across servers.", domain: 1, phase: 3, priority: "Later" },
      { slug: "friend-limit", title: "Friend limits by rank", summary: "Larger friend lists for supporters.", domain: 0, phase: 7, priority: "Nice to have" },
    ],
    adrs: ["Store friendships as two directed rows", "Publish presence over Redis pub/sub", "Keep messages for 90 days", "Make blocking symmetric", "Deliver offline messages on join", "Cap parties at eight players", "Rate-limit requests per hour", "Serve the web list from the same API", "Never show presence to non-friends", "Encode privacy as a bit set", "Replace the BungeeCord friends plugin"],
  },
  {
    slug: "surf-punish",
    name: "Surf Punish",
    description: "Bans, mutes, warnings and appeals shared across every server, with an audit trail.",
    repo: "https://github.com/slne-development/surf-punish",
    boards: ["Moderation", "Appeals"],
    domains: ["Bans", "Mutes", "Warnings", "Appeals", "Evidence", "Audit", "Templates", "Web panel", "Discord", "Sync"],
    systems: [
      { slug: "ban-core", title: "Ban core", summary: "Temporary and permanent bans by UUID and IP with reasons.", domain: 0, phase: 0, priority: "MVP" },
      { slug: "mute-core", title: "Mutes", summary: "Chat mutes with durations and a visible reason.", domain: 1, phase: 1, priority: "MVP" },
      { slug: "warning-points", title: "Warning points", summary: "Warnings add points that escalate to automatic punishments.", domain: 2, phase: 2, priority: "Later" },
      { slug: "appeal-form", title: "Appeal form", summary: "Punished players appeal on the website; staff decide.", domain: 3, phase: 2, priority: "MVP" },
      { slug: "evidence-links", title: "Evidence attachments", summary: "Attach screenshots, replays and chat logs to a punishment.", domain: 4, phase: 3, priority: "Later" },
      { slug: "audit-log", title: "Audit log", summary: "Every punishment change with staff member and reason.", domain: 5, phase: 1, priority: "MVP" },
      { slug: "reason-templates", title: "Reason templates", summary: "Predefined reasons with default durations.", domain: 6, phase: 2, priority: "MVP" },
      { slug: "web-panel", title: "Web panel", summary: "Search players, see history and act from the browser.", domain: 7, phase: 4, priority: "Later" },
      { slug: "discord-log", title: "Discord log channel", summary: "Post punishments to a staff channel.", domain: 8, phase: 3, priority: "Nice to have" },
      { slug: "redis-sync", title: "Redis sync", summary: "Apply punishments on every server within a second.", domain: 9, phase: 1, priority: "MVP" },
      { slug: "alt-detection", title: "Alt account detection", summary: "Link accounts by IP and hardware hints for staff review.", domain: 0, phase: 5, priority: "Later" },
      { slug: "punishment-expiry", title: "Expiry jobs", summary: "Lift expired punishments and notify players.", domain: 9, phase: 2, priority: "MVP" },
    ],
    adrs: ["Key punishments by UUID, not name", "Sync punishments over Redis", "Never delete punishments, only revoke", "Keep IP bans opt-in per case", "Use templates for durations", "Show the appeal link in the kick message", "Store evidence as links, not files", "Require a reason on every action", "Escalate warnings by points", "Expose history to the player", "Retire the MySQL LiteBans tables"],
  },
  {
    slug: "surf-shop",
    name: "Surf Shop",
    description: "The web store: ranks, cosmetics and keys, with delivery into the game and chargeback handling.",
    repo: "https://github.com/slne-development/surf-shop",
    boards: ["Storefront", "Payments"],
    domains: ["Catalog", "Checkout", "Payments", "Delivery", "Accounts", "Taxes", "Refunds", "Analytics", "Promotions", "Support"],
    systems: [
      { slug: "catalog", title: "Product catalog", summary: "Products, variants and categories managed from an admin page.", domain: 0, phase: 0, priority: "MVP" },
      { slug: "cart-checkout", title: "Cart and checkout", summary: "Cart, gift purchases and a single-page checkout.", domain: 1, phase: 1, priority: "MVP" },
      { slug: "stripe-payments", title: "Stripe payments", summary: "Card and wallet payments through Stripe Checkout.", domain: 2, phase: 1, priority: "MVP" },
      { slug: "paypal", title: "PayPal", summary: "PayPal as a second payment method.", domain: 2, phase: 4, priority: "Later" },
      { slug: "ingame-delivery", title: "In-game delivery", summary: "Deliver purchases to online and offline players exactly once.", domain: 3, phase: 1, priority: "MVP" },
      { slug: "account-link", title: "Account linking", summary: "Link a Minecraft account by in-game code before buying.", domain: 4, phase: 0, priority: "MVP" },
      { slug: "vat", title: "VAT handling", summary: "EU VAT by customer country with invoices.", domain: 5, phase: 5, priority: "MVP" },
      { slug: "chargebacks", title: "Chargeback handling", summary: "Revoke items and flag accounts on chargebacks.", domain: 6, phase: 5, priority: "MVP" },
      { slug: "sales-dashboard", title: "Sales dashboard", summary: "Revenue, top products and conversion per week.", domain: 7, phase: 7, priority: "Later" },
      { slug: "coupon-codes", title: "Coupon codes", summary: "Percentage and fixed coupons with limits and expiry.", domain: 8, phase: 4, priority: "Later" },
      { slug: "support-tickets", title: "Purchase support", summary: "Customers open a ticket tied to an order.", domain: 9, phase: 6, priority: "Nice to have" },
      { slug: "subscriptions", title: "Rank subscriptions", summary: "Monthly ranks with renewals and cancellation.", domain: 2, phase: 8, priority: "Later" },
    ],
    adrs: ["Build the store instead of using Tebex", "Take payments through Stripe Checkout only", "Deliver through an outbox table", "Price in euro cents", "Require account linking before checkout", "Compute VAT on our side", "Revoke items on chargeback automatically", "Keep orders immutable", "Send receipts from our own domain", "Run the store as a separate service", "Migrate existing Tebex customers"],
  },
  {
    slug: "surf-discord-bot",
    name: "Surf Discord Bot",
    description: "Our Discord bot: account linking, tickets, server status, announcements and moderation helpers.",
    repo: "https://github.com/slne-development/surf-discord-bot",
    boards: ["Features", "Operations"],
    domains: ["Linking", "Tickets", "Status", "Announcements", "Moderation", "Roles", "Commands", "Logging", "Hosting", "Localization"],
    systems: [
      { slug: "account-verify", title: "Account verification", summary: "Link Discord to Minecraft with a one-time code.", domain: 0, phase: 0, priority: "MVP" },
      { slug: "ticket-system", title: "Ticket system", summary: "Private ticket channels with categories and transcripts.", domain: 1, phase: 1, priority: "MVP" },
      { slug: "status-embed", title: "Server status embed", summary: "Live player counts and uptime in a pinned embed.", domain: 2, phase: 1, priority: "Later" },
      { slug: "announcement-relay", title: "Announcement relay", summary: "Post game announcements and changelogs to Discord.", domain: 3, phase: 2, priority: "MVP" },
      { slug: "automod", title: "Automod rules", summary: "Spam, invite and slur filters with staff alerts.", domain: 4, phase: 2, priority: "MVP" },
      { slug: "role-sync", title: "Rank role sync", summary: "Mirror in-game ranks as Discord roles.", domain: 5, phase: 2, priority: "MVP" },
      { slug: "slash-commands", title: "Slash commands", summary: "Player lookup, playtime and punishment history commands.", domain: 6, phase: 3, priority: "Later" },
      { slug: "audit-logging", title: "Audit logging", summary: "Log message edits, deletes and joins to a staff channel.", domain: 7, phase: 3, priority: "Later" },
      { slug: "sharding", title: "Sharding and hosting", summary: "Run the bot as a container with health checks.", domain: 8, phase: 5, priority: "MVP" },
      { slug: "translations", title: "Translations", summary: "German and English replies by user locale.", domain: 9, phase: 4, priority: "Nice to have" },
      { slug: "giveaways", title: "Giveaways", summary: "Timed giveaways with reaction entry and fair draws.", domain: 3, phase: 7, priority: "Nice to have" },
      { slug: "ticket-ratings", title: "Ticket ratings", summary: "Ask users to rate support after closing a ticket.", domain: 1, phase: 7, priority: "Later" },
    ],
    adrs: ["Write the bot with JDA", "Use slash commands only", "Store tickets in Postgres", "Keep transcripts as HTML", "Sync roles from the game, never back", "Run one shard", "Link accounts with one-time codes", "Log to channels, not files", "Localize by user locale", "Deploy with the other services on Coolify", "Retire the old Python bot"],
  },
];
