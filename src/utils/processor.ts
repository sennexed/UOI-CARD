import { ProcessedCardData, RawPayloadInput, ROLE_HIERARCHY, DEFAULT_RANK } from '../types';

/**
 * Sanitizes any raw name or string:
 * - Keeps only standard alphanumeric characters (a-z, A-Z, 0-9), underscores (_), and spaces.
 * - Strips accidental emojis, symbols, markdown, and broken formatting characters.
 * - Collapses consecutive spaces.
 * - Transforms output to clean UPPERCASE text.
 */
export function sanitizeText(input: string): string {
  if (!input) return '';
  return input
    .replace(/[^a-zA-Z0-9_ ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/**
 * Sanitizes numerical Roblox User IDs:
 * - Strips non-digit characters
 */
export function sanitizeNumericalId(input: string): string {
  if (!input) return '';
  return input.replace(/[^0-9]/g, '');
}

/**
 * Normalizes any gender input strictly to 'Male', 'Female', or 'Other'
 */
export function normalizeGender(input: string): 'Male' | 'Female' | 'Other' {
  if (!input) return 'Other';
  const clean = input.trim().toUpperCase();
  if (clean.includes('FEMALE') || clean === 'F') return 'Female';
  if (clean.includes('MALE') || clean === 'M') return 'Male';
  return 'Other';
}

/**
 * Resolves the role rank for a citizen:
 * - If selectedRank is provided AND the citizen actually possesses that role, returns it.
 * - Otherwise, automatically defaults to the highest ranking role this citizen holds.
 * - If no administrative roles are held, defaults to "COMMUNITY MEMBER".
 */
export function resolveAssignedRank(roleIds: string[], selectedRank?: string): string {
  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    return DEFAULT_RANK;
  }

  // Find all matching roles this citizen possesses according to hierarchy
  const citizenRoles = ROLE_HIERARCHY.filter((role) => roleIds.includes(role.id.trim()));

  if (citizenRoles.length === 0) {
    return DEFAULT_RANK;
  }

  // If a specific rank from their held roles was selected, verify they actually possess it
  if (selectedRank) {
    const requested = selectedRank.trim().toUpperCase();
    const matched = citizenRoles.find((r) => r.name.toUpperCase() === requested);
    if (matched) {
      return matched.name;
    }
  }

  // Default to the single highest ranking match in strict order of hierarchy definition
  return citizenRoles[0].name;
}

/**
 * Main processing engine conforming strictly to the UOI ID Card output specification.
 */
export function processUoiPayload(input: RawPayloadInput): ProcessedCardData {
  const sanitizedFullName = sanitizeText(input.fullName || input.robloxUsername || 'UNSPECIFIED MEMBER');
  const sanitizedRobloxUsername = sanitizeText(input.robloxUsername || 'UNKNOWN_USER');
  const sanitizedUserId = sanitizeNumericalId(input.robloxUserId) || '0000000000';
  const strictGender = normalizeGender(input.gender);
  const assignedRank = resolveAssignedRank(input.roleIds || [], input.selectedRank);

  return {
    status: 'SUCCESS',
    fullName: sanitizedFullName,
    robloxUsername: sanitizedRobloxUsername,
    robloxUserId: sanitizedUserId,
    gender: strictGender.toUpperCase(),
    assignedRank: assignedRank,
    roleIds: input.roleIds || [],
  };
}
