import type { Config } from '@/lib/config';
import { dataApi } from './data-api';

export type ImportMode = 'merge' | 'replace' | 'update';

export type JobExecution = {
    id: string;
    job_id: string;
    status?: 'PENDING' | 'RUNNING' | 'OK' | 'ERROR' | 'FINISHED' | 'CANCELLED' | 'ABORTED';
    execution_status?: 'pending' | 'running' | 'finished' | 'aborted';
    start_time?: string;
    end_time?: string;
    log_file_name?: string;
    log_file_path?: string;
    step_executions?: Array<{
        id: string;
        status: string;
        execution_status: string;
        log_file_name?: string;
    }>;
};

const SITE_ARCHIVE_IMPORT_JOB_ID = 'sfcc-site-archive-import';

/**
 * Trigger a site-archive-import for a zip already uploaded to
 * /Impex/src/instance/<archiveZipFilename>.
 *
 * The endpoint uses a dedicated `site_archive_import_configuration` schema:
 *   - file_name: the .zip filename in /Impex/src/instance
 *   - mode:      'merge' | 'replace' | 'update' (lower-case, validated by enum)
 */
export async function triggerSiteArchiveImport(
    config: Config,
    archiveZipFilename: string,
    mode: ImportMode = 'merge'
): Promise<JobExecution> {
    const { data } = await dataApi<JobExecution>(
        config,
        `/jobs/${SITE_ARCHIVE_IMPORT_JOB_ID}/executions`,
        {
            method: 'POST',
            body: JSON.stringify({
                file_name: archiveZipFilename,
                mode,
            }),
        }
    );
    return data;
}

export async function getJobExecution(
    config: Config,
    jobId: string,
    executionId: string
): Promise<JobExecution> {
    const { data } = await dataApi<JobExecution>(
        config,
        `/jobs/${encodeURIComponent(jobId)}/executions/${encodeURIComponent(executionId)}`
    );
    return data;
}

export const siteArchiveJobId = SITE_ARCHIVE_IMPORT_JOB_ID;

/**
 * Trigger a search-reindex job by ID. The job has to be configured in BM
 * (Administration → Operations → Jobs) — typically a one-step job calling the
 * `SearchReindex` step on the storefront catalog. We don't hardcode an ID here
 * because it varies per sandbox (BM auto-prefixes the project ID). When the
 * `REINDEX_JOB_ID` env var is unset we no-op and the caller can mention that
 * delta-index will catch up later.
 */
export async function triggerSearchReindex(
    config: Config,
    jobId: string
): Promise<JobExecution> {
    const { data } = await dataApi<JobExecution>(
        config,
        `/jobs/${encodeURIComponent(jobId)}/executions`,
        {
            method: 'POST',
            body: JSON.stringify({}),
        }
    );
    return data;
}
