// Repositories: the only code that knows where each "table" lives.
//
// Today every table is a JSON file in backend/data/ (or backend/data/demo/),
// handled by JsonStore. The pipeline and the server talk to these objects, not
// to file names, so moving to PostgreSQL (schema/schema.sql) means writing a
// second implementation of this module with the same methods. The record
// shapes are defined in src/contracts/models.js.

import path from 'node:path';
import { SubmissionsRepository } from './submissions.js';

const TABLES = {
  news: { file: 'news-db.json', defaults: { articles: [], stories: [] } },
  jobs: { file: 'jobs-db.json', defaults: { jobs: [] } },
  feedState: { file: 'feed-state.json', defaults: { sources: {} } },
  runs: { file: 'run-history.json', defaults: { runs: [] } }
};

// Rebuilt from scratch on every full demo run so demo dates stay current.
export const DEMO_RESETTABLE = ['news', 'jobs', 'feedState'].map((t) => TABLES[t].file);

/**
 * @param {import('../store/jsonStore.js').JsonStore} store
 */
export function createRepositories(store) {
  const table = ({ file, defaults }) => ({
    load: () => store.load(file, defaults),
    save: (data) => store.save(file, data)
  });
  return {
    news: table(TABLES.news),
    jobs: table(TABLES.jobs),
    feedState: table(TABLES.feedState),
    runs: {
      ...table(TABLES.runs),
      record(run, keep = 30) {
        const history = store.load(TABLES.runs.file, TABLES.runs.defaults);
        history.runs = [run, ...history.runs].slice(0, keep);
        store.save(TABLES.runs.file, history);
      }
    }
  };
}

/**
 * Submissions hold personal data, so they live in their own git-ignored folder
 * (data/submissions or data/demo/submissions) and are never published.
 */
export function createSubmissionsRepository(dataDir, options = {}) {
  return new SubmissionsRepository(path.join(dataDir, 'submissions'), options);
}
