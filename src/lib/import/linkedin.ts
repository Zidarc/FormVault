// LinkedIn data export (Settings → Data privacy → Get a copy of your data).
// Structured CSVs map straight into the vault with no AI call. Only posts go to the AI, filtered first.

import { nowIso } from '../ids';
import { propose, proposeProfile, proposeSkills } from '../inbox';
import { updateVault } from '../storage';
import { filterSignal, hasSignal } from '../text';
import type { SourceRef } from '../types';
import { extractToInbox, type ImportProgress } from './extract';
import { classifySkills, findFile, openArchive, parseCsv, toYearMonth } from './files';

export interface LinkedInResult {
  structured: number;
  postsSent: number;
  fromPosts: number;
}

export async function importLinkedIn(file: File, onProgress?: ImportProgress): Promise<LinkedInResult> {
  onProgress?.('Opening your LinkedIn export…');
  const files = await openArchive(file);
  const src = (label: string): SourceRef => ({ kind: 'linkedin', label: `LinkedIn export · ${label}`, at: nowIso() });

  const profile = parseCsv(findFile(files, 'profile.csv'), 'First Name')[0];
  const emails = parseCsv(findFile(files, 'email addresses.csv'), 'Email Address');
  const phones = parseCsv(findFile(files, 'phonenumbers.csv', 'phone numbers.csv'), 'Number');
  const education = parseCsv(findFile(files, 'education.csv'), 'School Name');
  const positions = parseCsv(findFile(files, 'positions.csv'), 'Company Name');
  const projects = parseCsv(findFile(files, 'projects.csv'), 'Title');
  const honors = parseCsv(findFile(files, 'honors.csv'), 'Title');
  const certs = parseCsv(findFile(files, 'certifications.csv'), 'Name');
  const skills = parseCsv(findFile(files, 'skills.csv'), 'Name');
  const shares = parseCsv(findFile(files, 'shares.csv'), 'ShareCommentary');

  let structured = 0;
  await updateVault((v) => {
    if (profile) {
      const primaryEmail = emails.find((e) => /yes/i.test(e['Primary'] ?? '')) ?? emails[0];
      const latestEdu = education.sort((a, b) => (b['End Date'] ?? '').localeCompare(a['End Date'] ?? ''))[0];
      structured += proposeProfile(
        v,
        {
          name: [profile['First Name'], profile['Last Name']].filter(Boolean).join(' '),
          city: profile['Geo Location']?.split(',')[0],
          email: primaryEmail?.['Email Address'],
          phone: phones[0]?.['Number'],
          university: latestEdu?.['School Name'],
          degree: latestEdu?.['Degree Name'],
          graduationYear: toYearMonth(latestEdu?.['End Date'])?.slice(0, 4),
          portfolio: profile['Websites']?.replace(/^\[?([^\]:]+:)?/, '').split(',')[0]?.trim() || undefined,
        },
        src('Profile'),
      );
    }
    structured += propose(
      v,
      'experience',
      positions.map((p) => ({
        organisation: p['Company Name'],
        role: p['Title'],
        startDate: toYearMonth(p['Started On']),
        endDate: toYearMonth(p['Finished On']),
        description: p['Description'],
      })),
      src('Positions'),
    );
    structured += propose(
      v,
      'projects',
      projects.map((p) => ({
        title: p['Title'],
        description: p['Description'],
        links: p['Url'] ? [p['Url']] : [],
        startDate: toYearMonth(p['Started On']),
        endDate: toYearMonth(p['Finished On']),
      })),
      src('Projects'),
    );
    structured += propose(
      v,
      'achievements',
      [
        ...honors.map((h) => ({
          title: h['Title'],
          description: h['Description'],
          date: toYearMonth(h['Issued On']),
        })),
        ...certs.map((c) => ({
          title: c['Name'],
          issuer: c['Authority'],
          link: c['Url'],
          date: toYearMonth(c['Started On']),
        })),
      ],
      src('Honors & Certifications'),
    );
    structured += proposeSkills(v, classifySkills(skills.map((s) => s['Name'])), src('Skills'));
  });

  // Posts: keyword-filter in the browser, then batch to the AI.
  const posts = shares
    .filter((s) => hasSignal(s['ShareCommentary'] ?? ''))
    .map((s) => `Post on ${toYearMonth(s['Date']) ?? s['Date']} (${s['ShareLink']}):\n${filterSignal(s['ShareCommentary'].replace(/""/g, '"')) || s['ShareCommentary']}`);

  let fromPosts = 0;
  if (posts.length) {
    fromPosts = await extractToInbox(posts, src(`${posts.length} posts`), onProgress);
  }
  return { structured, postsSent: posts.length, fromPosts };
}
