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
 * Resolves the single highest matching role rank from the official administrative hierarchy.
 * Returns the UPPERCASE rank name, or "COMMUNITY MEMBER" if no match found.
 */
export function resolveAssignedRank(roleIds: string[]): string {
  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    return DEFAULT_RANK;
  }

  // Find the highest ranking match in strict order of hierarchy definition
  for (const role of ROLE_HIERARCHY) {
    if (roleIds.includes(role.id.trim())) {
      return role.name;
    }
  }

  return DEFAULT_RANK;
}

/**
 * Main processing engine conforming strictly to the UOI ID Card output specification.
 */
export function processUoiPayload(input: RawPayloadInput): ProcessedCardData {
  const sanitizedFullName = sanitizeText(input.fullName || input.robloxUsername || 'UNSPECIFIED MEMBER');
  const sanitizedRobloxUsername = sanitizeText(input.robloxUsername || 'UNKNOWN_USER');
  const sanitizedUserId = sanitizeNumericalId(input.robloxUserId) || '0000000000';
  const sanitizedGender = sanitizeText(input.gender || 'NOT SPECIFIED');
  const assignedRank = resolveAssignedRank(input.roleIds || []);

  return {
    status: 'SUCCESS',
    fullName: sanitizedFullName,
    robloxUsername: sanitizedRobloxUsername,
    robloxUserId: sanitizedUserId,
    gender: sanitizedGender,
    assignedRank: assignedRank,
    roleIds: input.roleIds || [],
  };
}
