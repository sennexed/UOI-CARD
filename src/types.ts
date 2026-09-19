export interface RawPayloadInput {
  fullName: string;
  robloxUsername: string;
  robloxUserId: string;
  gender: string;
  roleIds: string[];
}

export interface ProcessedCardData {
  status: "SUCCESS";
  fullName: string;
  robloxUsername: string;
  robloxUserId: string;
  gender: string;
  assignedRank: string;
  roleIds?: string[];
}

export interface RobloxUserData {
  id: number;
  name: string;
  displayName: string;
  description: string;
  created: string | null;
  isBanned: boolean;
  hasVerifiedBadge: boolean;
}

export interface RobloxAvatarData {
  fullBodyUrl: string | null;
  bustUrl: string | null;
  headshotUrl: string | null;
  fullBodyDataUrl: string | null;
  bustDataUrl: string | null;
}

export interface HierarchyRole {
  id: string;
  name: string;
  title: string;
  tierLevel: number;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
}

export const ROLE_HIERARCHY: HierarchyRole[] = [
  {
    id: "123456789012345678",
    name: "PRESIDENT",
    title: "President of the Union",
    tierLevel: 1,
    badgeBg: "rgba(245, 158, 11, 0.15)",
    badgeBorder: "#F59E0B",
    badgeText: "#F59E0B",
  },
  {
    id: "234567890123456789",
    name: "PRIME MINISTER",
    title: "Prime Minister of RTP",
    tierLevel: 2,
    badgeBg: "rgba(59, 130, 246, 0.15)",
    badgeBorder: "#3B82F6",
    badgeText: "#60A5FA",
  },
  {
    id: "345678901234567890",
    name: "SENATOR",
    title: "Senate Assembly Member",
    tierLevel: 3,
    badgeBg: "rgba(16, 185, 129, 0.15)",
    badgeBorder: "#10B981",
    badgeText: "#34D399",
  },
  {
    id: "456789012345678901",
    name: "SECURITY FORCE",
    title: "National Security Command",
    tierLevel: 4,
    badgeBg: "rgba(239, 68, 68, 0.15)",
    badgeBorder: "#EF4444",
    badgeText: "#F87171",
  },
  {
    id: "567890123456789012",
    name: "COMMUNITY MEMBER",
    title: "Verified Citizen",
    tierLevel: 5,
    badgeBg: "rgba(148, 163, 184, 0.15)",
    badgeBorder: "#94A3B8",
    badgeText: "#CBD5E1",
  },
];

export const DEFAULT_RANK = "COMMUNITY MEMBER";

export interface CardAuditActor {
  discordId: string;
  discordTag: string;
}

export interface CardAuditEntry {
  action: "ISSUED" | "PROMOTED" | "REVOKED";
  performedBy: CardAuditActor;
  timestamp: string;
  details: string;
}

export interface CardRecord {
  serialId: string;
  status: "ACTIVE" | "REVOKED";
  issuedTo: {
    discordId: string;
    discordTag: string;
    robloxUsername: string;
    robloxUserId: string;
    fullName: string;
    assignedRank: string;
  };
  issuedBy: CardAuditActor;
  issuedAt: string;
  serverNickname: string;
  revokeReason?: string;
  history: CardAuditEntry[];
}

