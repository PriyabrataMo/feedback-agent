import { MongoClient, type Db } from "mongodb";

/**
 * One cached client per server instance. The promise lives on globalThis so dev
 * hot-reloads and serverless warm invocations reuse the same connection pool.
 */
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
    .catch((err: unknown) => {
      // Don't cache a failed connect, so the next request retries.
      globalForMongo._showbugMongo = undefined;
      throw err;
    });

  return globalForMongo._showbugMongo.then((client) =>
    client.db(process.env.MONGODB_DB ?? "showbug"),
  );
}
