/**
 * Interactive conversation flow for Telegram.
 *
 * Instead of a single message → submit, the bot asks follow-up questions
 * to gather all required info (category, description, location, photos)
 * before submitting the request.
 */

export type ConversationState =
  | { step: "idle" }
  | { step: "awaiting_category"; description: string }
  | { step: "awaiting_location"; description: string; category: string }
  | { step: "awaiting_photos"; description: string; category: string; location: string; photos: string[] }
  | { step: "awaiting_confirm"; description: string; category: string; location: string; photos: string[] };

interface ConversationSession {
  state: ConversationState;
  updatedAt: number;
}

const SESSION_TIMEOUT = 10 * 60_000; // 10 minutes

const sessions = new Map<string, ConversationSession>();

export function getSession(chatId: string): ConversationState {
  const session = sessions.get(chatId);
  if (!session || Date.now() - session.updatedAt > SESSION_TIMEOUT) {
    sessions.delete(chatId);
    return { step: "idle" };
  }
  return session.state;
}

export function setSession(chatId: string, state: ConversationState): void {
  sessions.set(chatId, { state, updatedAt: Date.now() });
}

export function clearSession(chatId: string): void {
  sessions.delete(chatId);
}

const CATEGORIES = [
  "Plumbing",
  "Electrical",
  "HVAC",
  "Appliance",
  "Pest Control",
  "General/Other",
];

export function getCategoryOptions(): string {
  return CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join("\n");
}

export function resolveCategory(input: string): string | null {
  const trimmed = input.trim();

  // Try numeric selection
  const num = parseInt(trimmed, 10);
  if (num >= 1 && num <= CATEGORIES.length) {
    return CATEGORIES[num - 1].toLowerCase();
  }

  // Try text match
  const lower = trimmed.toLowerCase();
  const match = CATEGORIES.find((c) => c.toLowerCase().includes(lower));
  return match ? match.toLowerCase() : null;
}

const LOCATIONS = [
  "Kitchen",
  "Bathroom",
  "Bedroom",
  "Living Room",
  "Hallway",
  "Balcony/Patio",
  "Entire Unit",
];

export function getLocationOptions(): string {
  return LOCATIONS.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

export function resolveLocation(input: string): string | null {
  const trimmed = input.trim();

  const num = parseInt(trimmed, 10);
  if (num >= 1 && num <= LOCATIONS.length) {
    return LOCATIONS[num - 1].toLowerCase();
  }

  const lower = trimmed.toLowerCase();
  const match = LOCATIONS.find((l) => l.toLowerCase().includes(lower));
  return match ? match.toLowerCase() : null;
}

export function formatSummary(state: ConversationState & { step: "awaiting_confirm" }): string {
  const photoLine = state.photos.length > 0
    ? `Photos: ${state.photos.length} attached`
    : "Photos: none";

  return [
    "Here's your request summary:",
    "",
    `Category: ${state.category}`,
    `Location: ${state.location}`,
    `Description: ${state.description}`,
    photoLine,
    "",
    "Send 'yes' to submit, or 'cancel' to discard.",
  ].join("\n");
}
