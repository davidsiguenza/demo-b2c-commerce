#!/usr/bin/env node
/**
 * Copyright 2026 Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { existsSync, copyFileSync, readdirSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PROFILES_DIR = resolve(ROOT, '.env.profiles');
const ENV_PATH = resolve(ROOT, '.env');

function readActiveClient(envPath) {
    try {
        const content = readFileSync(envPath, 'utf8');
        const match = content.match(/^\s*PUBLIC__app__global__branding__activeClient\s*=\s*(.+?)\s*$/m);
        if (!match) return null;
        return match[1].replace(/^['"]|['"]$/g, '').trim() || null;
    } catch {
        return null;
    }
}

function listProfiles() {
    if (!existsSync(PROFILES_DIR)) return [];
    return readdirSync(PROFILES_DIR)
        .filter((f) => f.endsWith('.env') && !f.endsWith('.example'))
        .map((f) => basename(f, '.env'));
}

function usage(extra = '') {
    if (extra) console.error(`Error: ${extra}\n`);
    const profiles = listProfiles();
    console.error('Usage: pnpm demo:switch <client-id>');
    if (profiles.length) {
        console.error('\nAvailable profiles:');
        profiles.forEach((p) => console.error(`  - ${p}`));
    } else {
        console.error('\nNo profiles found in .env.profiles/. Create one (e.g. .env.profiles/acme.env) first.');
    }
    process.exit(1);
}

const clientId = process.argv[2];
if (clientId === '--list') {
    const profiles = listProfiles();
    if (!profiles.length) {
        console.log('No profiles found in .env.profiles/');
    } else {
        console.log('Available profiles:');
        profiles.forEach((p) => console.log(`  - ${p}`));
    }
    process.exit(0);
}
if (!clientId) usage('client-id is required');

const profilePath = resolve(PROFILES_DIR, `${clientId}.env`);
if (!existsSync(profilePath)) usage(`profile not found: ${profilePath}`);

if (existsSync(ENV_PATH)) {
    const backupDir = resolve(ROOT, '.env.backup');
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
    const previousClient = readActiveClient(ENV_PATH) ?? 'unknown';
    const backup = resolve(backupDir, `.env.${previousClient}.${Date.now()}.bak`);
    copyFileSync(ENV_PATH, backup);
    console.log(`Backed up current .env (client="${previousClient}") → ${basename(backup)}`);
}

copyFileSync(profilePath, ENV_PATH);
console.log(`Switched to client "${clientId}". Restart pnpm dev to apply changes.`);
