import type { Role } from '../lib/db-types.js';
import '@auth/express';
import '@auth/core/jwt';

declare module '@auth/core/types' {
  interface User {
    role: Role;
    sessionVersion: number;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    role: Role;
    sessionVersion: number;
  }
}
