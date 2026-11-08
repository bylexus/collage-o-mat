/** Logged-in user as returned by `/api/auth/login` and `/api/auth/me`. */
export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
}
