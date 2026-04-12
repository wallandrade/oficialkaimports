import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/src/schema/*.ts",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
