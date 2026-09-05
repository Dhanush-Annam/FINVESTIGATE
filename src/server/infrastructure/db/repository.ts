import type { InvestigationRepository } from "./repository-interface.js";

let repoInstance: InvestigationRepository | null = null;

export async function getRepository(): Promise<InvestigationRepository> {
  if (repoInstance) {
    return repoInstance;
  }

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (tursoUrl) {
    const { TursoAdapter } = await import("./turso-adapter.js");
    repoInstance = new TursoAdapter({
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  } else {
    const { SqliteAdapter } = await import("./sqlite-adapter.js");
    repoInstance = new SqliteAdapter();
  }

  await repoInstance.init();
  await repoInstance.seedCuratedData();
  return repoInstance;
}

export function setRepositoryForTest(repo: InvestigationRepository | null): void {
  repoInstance = repo;
}
