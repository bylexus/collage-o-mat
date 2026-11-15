import { User } from './user';

/** A user of the admin user list (`/api/admin/users`); create and update return it too. */
export interface AdminUser extends User {
  /** Inactive users cannot log in. */
  isActive: boolean;
  collageCount: number;
  photoCount: number;
}

/** Body of `POST /api/admin/users`. New users are active. */
export interface CreateUserRequest {
  username: string;
  password: string;
  isAdmin: boolean;
}

/** Body of `PATCH /api/admin/users/{id}`. A missing or empty `newPassword` keeps the password. */
export interface UpdateUserRequest {
  isAdmin: boolean;
  isActive: boolean;
  newPassword?: string;
}

/** System-wide settings (`/api/admin/settings`). */
export interface SystemSettings {
  /** Photo storage limit per user in bytes; 0 = unlimited. Not enforced yet. */
  maxUserStorageBytes: number;
}
