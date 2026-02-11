export interface AuthenticatedUser {
  id: string;
  email: string;
  isPaid: boolean;
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
}
