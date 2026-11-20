import { randomUUID } from "node:crypto";
import { databasePool, queryOne, required, type Database } from "./db.js";
import type { Role } from "./db-types.js";

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  phoneNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  createdAt: Date;
};
export type Member = PublicUser & { isActive: boolean; updatedAt: Date };
type LoginUser = Member & { password: string; sessionVersion: number };
type NewUser = Pick<PublicUser, "email" | "name"> &
  Partial<Pick<PublicUser, "phoneNumber" | "firstName" | "lastName" | "role">> &
  { password: string; isActive?: boolean };

export const publicUserColumns =
  'id, email, name, "phoneNumber", "firstName", "lastName", role, "createdAt"';
export const memberColumns = publicUserColumns + ', "isActive", "updatedAt"';
const credentialColumns = memberColumns + ', password, "sessionVersion"';

export async function createUser(input: NewUser, db = databasePool() as Database) {
  return required(await queryOne<Member>(
    db,
    'INSERT INTO users (id, email, password, name, "phoneNumber", "firstName", "lastName", role, "isActive", "updatedAt")' +
      ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ' + memberColumns,
    [randomUUID(), input.email, input.password, input.name, input.phoneNumber ?? null,
      input.firstName ?? null, input.lastName ?? null, input.role ?? "USER",
      input.isActive ?? true, new Date()],
  ));
}

export function publicUser(user: Member): PublicUser {
  const { isActive: _isActive, updatedAt: _updatedAt, ...data } = user;
  return data;
}

export function userByEmail(email: string) {
  return queryOne<LoginUser>(
    databasePool(), "SELECT " + credentialColumns + " FROM users WHERE email = $1", [email],
  );
}

export function publicUserById(id: string) {
  return queryOne<PublicUser>(
    databasePool(), "SELECT " + publicUserColumns + " FROM users WHERE id = $1", [id],
  );
}

export function userSession(id: string) {
  return queryOne<Pick<LoginUser, "isActive" | "sessionVersion" | "role" | "name" | "email">>(
    databasePool(),
    'SELECT "isActive", "sessionVersion", role, name, email FROM users WHERE id = $1',
    [id],
  );
}

export function userPassword(id: string) {
  return queryOne<Pick<LoginUser, "id" | "isActive" | "sessionVersion" | "password">>(
    databasePool(),
    'SELECT id, "isActive", "sessionVersion", password FROM users WHERE id = $1',
    [id],
  );
}

export async function changePassword(
  user: Pick<LoginUser, "id" | "sessionVersion" | "password">,
  password: string,
) {
  const changed = await queryOne<{ id: string }>(
    databasePool(),
    'UPDATE users SET password = $1, "sessionVersion" = "sessionVersion" + 1, "updatedAt" = $2' +
      ' WHERE id = $3 AND password = $4 AND "sessionVersion" = $5 AND "isActive" RETURNING id',
    [password, new Date(), user.id, user.password, user.sessionVersion],
  );
  return changed !== null;
}
