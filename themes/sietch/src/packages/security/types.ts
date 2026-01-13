/**
 * Security Package Types
 *
 * Sprint 47: Kill Switch & MFA
 *
 * Type definitions for:
 * - Kill Switch Protocol
 * - MFA (Multi-Factor Authentication)
 * - Security Guard Middleware
 *
 * @module packages/security/types
 */

// =============================================================================
// Kill Switch Types
// =============================================================================

/**
 * Kill switch activation reasons
 */
export type KillSwitchReason =
  | 'CREDENTIAL_COMPROMISE'     // Credentials leaked or compromised
  | 'SECURITY_BREACH'           // Active security incident
  | 'SUSPICIOUS_ACTIVITY'       // Anomalous behavior detected
  | 'ADMIN_REQUEST'             // Manual admin intervention
  | 'POLICY_VIOLATION'          // Terms of service violation
  | 'EMERGENCY_MAINTENANCE';    // Emergency system maintenance

/**
 * Kill switch scope
 */
export type KillSwitchScope =
  | 'GLOBAL'      // All tenants affected
  | 'COMMUNITY'   // Single community affected
  | 'USER';       // Single user affected

/**
 * User roles for authorization
 */
export type UserRole =
  | 'NAIB_COUNCIL'       // Top 7 governance (highest authority)
  | 'PLATFORM_ADMIN'     // Platform-level administrators
  | 'COMMUNITY_ADMIN'    // Community-level administrators
  | 'USER';              // Regular users

/**
 * Kill switch activation options
 */
export interface KillSwitchOptions {
  /** Scope of kill switch */
  scope: KillSwitchScope;
  /** Reason for activation */
  reason: KillSwitchReason;
  /** Community ID (required for COMMUNITY scope) */
  communityId?: string;
  /** User ID (required for USER scope) */
  userId?: string;
  /** Admin who activated kill switch */
  activatedBy: string;
  /** Role of the activator (required for authorization) */
  activatorRole: UserRole;
  /** Additional context */
  metadata?: Record<string, unknown>;
  /** Whether to send admin notification */
  notifyAdmins?: boolean;
}

/**
 * Kill switch activation result
 */
export interface KillSwitchResult {
  /** Activation timestamp */
  activatedAt: Date;
  /** Scope affected */
  scope: KillSwitchScope;
  /** Reason for activation */
  reason: KillSwitchReason;
  /** Number of sessions revoked */
  sessionsRevoked: number;
  /** Number of Vault policies revoked */
  vaultPoliciesRevoked: number;
  /** Number of synthesis jobs paused */
  synthesisJobsPaused: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Success flag */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Community freeze status
 */
export interface CommunityFreezeStatus {
  /** Community ID */
  communityId: string;
  /** Whether community is frozen */
  frozen: boolean;
  /** Reason for freeze */
  reason?: string;
  /** When freeze started */
  frozenAt?: Date;
  /** Admin who froze community */
  frozenBy?: string;
}

// =============================================================================
// MFA Types
// =============================================================================

/**
 * MFA methods supported
 */
export type MFAMethod = 'TOTP' | 'SMS' | 'EMAIL' | 'BACKUP_CODES';

/**
 * MFA verification request
 */
export interface MFAVerificationRequest {
  /** User ID requiring MFA */
  userId: string;
  /** Operation requiring MFA */
  operation: string;
  /** TOTP code from authenticator app */
  totpCode?: string;
  /** SMS code */
  smsCode?: string;
  /** Email code */
  emailCode?: string;
  /** Backup recovery code */
  backupCode?: string;
}

/**
 * MFA verification result
 */
export interface MFAVerificationResult {
  /** Whether verification succeeded */
  valid: boolean;
  /** Method used */
  method?: MFAMethod;
  /** Verification timestamp */
  verifiedAt?: Date;
  /** Error message if failed */
  error?: string;
  /** Number of attempts remaining (for rate limiting) */
  attemptsRemaining?: number;
}

/**
 * MFA setup options
 */
export interface MFASetupOptions {
  /** User ID */
  userId: string;
  /** MFA method to set up */
  method: MFAMethod;
  /** Phone number (for SMS) */
  phoneNumber?: string;
  /** Email address (for EMAIL) */
  email?: string;
}

/**
 * MFA setup result
 */
export interface MFASetupResult {
  /** Whether setup succeeded */
  success: boolean;
  /** Method set up */
  method: MFAMethod;
  /** TOTP secret (for TOTP method) */
  totpSecret?: string;
  /** QR code data URL (for TOTP method) */
  qrCodeDataUrl?: string;
  /** Backup codes generated */
  backupCodes?: string[];
  /** Setup timestamp */
  setupAt: Date;
}

/**
 * MFA configuration for user
 */
export interface MFAConfig {
  /** User ID */
  userId: string;
  /** Whether MFA is enabled */
  enabled: boolean;
  /** Primary MFA method */
  primaryMethod?: MFAMethod;
  /** Backup methods configured */
  backupMethods: MFAMethod[];
  /** Last verification timestamp */
  lastVerifiedAt?: Date;
  /** Number of backup codes remaining */
  backupCodesRemaining: number;
}

// =============================================================================
// Security Guard Types
// =============================================================================

/**
 * Operations requiring security guard protection
 */
export type ProtectedOperation =
  | 'DELETE_CHANNEL'
  | 'DELETE_ROLE'
  | 'DELETE_COMMUNITY'
  | 'KILL_SWITCH'
  | 'VAULT_KEY_ROTATION'
  | 'PURGE_DATA'
  | 'ADMIN_OVERRIDE';

/**
 * Security guard verification request
 */
export interface SecurityGuardRequest {
  /** Operation being performed */
  operation: ProtectedOperation;
  /** User requesting operation */
  userId: string;
  /** Community ID (if applicable) */
  communityId?: string;
  /** MFA verification */
  mfaVerification: MFAVerificationRequest;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Security guard verification result
 */
export interface SecurityGuardResult {
  /** Whether operation is allowed */
  allowed: boolean;
  /** Verification timestamp */
  verifiedAt: Date;
  /** MFA verification result */
  mfaResult: MFAVerificationResult;
  /** Reason for denial (if not allowed) */
  denialReason?: string;
  /** Audit log entry ID */
  auditLogId?: string;
}

/**
 * Security guard configuration
 */
export interface SecurityGuardConfig {
  /** Operations requiring MFA */
  protectedOperations: ProtectedOperation[];
  /** Whether to require MFA for all destructive operations */
  requireMfaForDestructive: boolean;
  /** Maximum verification attempts */
  maxVerificationAttempts: number;
  /** Verification attempt window (seconds) */
  verificationWindow: number;
  /** Whether to send admin notifications */
  notifyAdmins: boolean;
}

// =============================================================================
// Audit Log Types
// =============================================================================

/**
 * Security audit log entry
 */
export interface SecurityAuditLog {
  /** Unique log entry ID */
  id: string;
  /** Timestamp */
  timestamp: Date;
  /** Event type */
  eventType: 'KILL_SWITCH' | 'MFA_VERIFICATION' | 'SECURITY_GUARD' | 'SESSION_REVOCATION';
  /** User ID (if applicable) */
  userId?: string;
  /** Community ID (if applicable) */
  communityId?: string;
  /** Operation performed */
  operation?: string;
  /** Success flag */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Admin Notification Types
// =============================================================================

/**
 * Admin notification options
 */
export interface AdminNotificationOptions {
  /** Notification type */
  type: 'KILL_SWITCH' | 'SECURITY_ALERT' | 'MFA_FAILURE';
  /** Severity level */
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  /** Message title */
  title: string;
  /** Message body */
  body: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
  /** Discord webhook URL (optional, uses default if not provided) */
  webhookUrl?: string;
}

/**
 * Admin notification result
 */
export interface AdminNotificationResult {
  /** Whether notification was sent */
  sent: boolean;
  /** Notification timestamp */
  sentAt?: Date;
  /** Error message (if failed) */
  error?: string;
}
