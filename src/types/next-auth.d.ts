import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "MANAGER" | "VIEWER";
      avatarColor?: string;
    } & DefaultSession["user"];
  }
  interface User {
    role: "ADMIN" | "MANAGER" | "VIEWER";
    avatarColor?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: "ADMIN" | "MANAGER" | "VIEWER";
    id: string;
    avatarColor?: string;
  }
}
