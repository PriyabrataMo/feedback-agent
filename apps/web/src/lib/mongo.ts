import { MongoClient, type Db } from "mongodb";
import "server-only";

/** Reuse one connection pool across development reloads and warm server instances. */
const globalForMongo = globalThis as unknown as {
  _showbugMongo?: Promise<MongoClient>;
};

export function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return Promise.reject(new Error("MONGODB_URI is not set"));

  globalForMongo._showbugMongo ??= new MongoClient(uri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
  })
    .connect()
    .catch((error: unknown) => {
      globalForMongo._showbugMongo = undefined;
      throw error;
    });

  return globalForMongo._showbugMongo.then((client) =>
    client.db(process.env.MONGODB_DB ?? "showbug"),
  );
}
