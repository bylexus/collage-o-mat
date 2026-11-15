/** Logged-in user as returned by `/api/auth/login`, `/api/auth/me` and the avatar endpoints. */
export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
  /** Creation time of the account (RFC 3339). */
  createdAt: string;
  /** Version of the avatar (unix ms of its last change), `null` if the user has no avatar. */
  avatarVersion: number | null;
}
