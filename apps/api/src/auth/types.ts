export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
}
