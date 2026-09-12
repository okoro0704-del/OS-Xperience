import { PrismaClient } from "@prisma/client";
let client: PrismaClient | undefined;
export function prismaClient(): PrismaClient { if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Xperience persistence."); return client ??= new PrismaClient(); }
export async function closePrisma(){await client?.$disconnect();client=undefined;}
