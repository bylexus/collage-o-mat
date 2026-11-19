import { User } from './user';

/** A user of the admin user list (`/api/admin/users`); create and update return it too. */
export interface AdminUser extends User {
  /** Inactive users cannot log in. */
  isActive: boolean;
  collageCount: number;
  photoCount: number;
  /**
   * Time of the last login or authenticated request (RFC 3339), precision 1 hour.
   * `null` if no activity is recorded.
   */
  lastActiveAt: string | null;
  /** Sum of the stored photo file sizes of all collages of the user, in bytes. */
  usedStorageBytes: number;
  /** Own storage limit in bytes (0 = unlimited); `null` = the server default is used. */
  maxStorageBytes: number | null;
  /** Limit that applies: own limit or server default; 0 = unlimited. */
  effectiveMaxStorageBytes: number;
}

/** Body of `POST /api/admin/users`. New users are active. */
export interface CreateUserRequest {
  username: string;
  password: string;
  isAdmin: boolean;
  /** Own storage limit in bytes (0 = unlimited); `null` or missing = server default. */
  maxStorageBytes?: number | null;
}

/** Body of `PATCH /api/admin/users/{id}`. A missing or empty `newPassword` keeps the password. */
export interface UpdateUserRequest {
  isAdmin: boolean;
  isActive: boolean;
  /** Own storage limit in bytes (0 = unlimited); `null` = server default. Required. */
  maxStorageBytes: number | null;
  newPassword?: string;
}

/** System-wide settings (`/api/admin/settings`). */
export interface SystemSettings {
  /** Photo storage limit per user in bytes; 0 = unlimited. Default of users without an own limit. */
  maxUserStorageBytes: number;
}
