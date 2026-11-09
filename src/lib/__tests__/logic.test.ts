import { describe, expect, it } from 'vitest';
import { applyInboxItem, propose, proposeProfile, relink, undoInboxAction } from '../inbox';
import { instantFill, profileKeyFor } from '../fill/profileMatch';
import { decideMode, matchMemory } from '../fill/memory';
import { detectPick } from '../fill/pick';
import { classifySkills, parseCsv, toYearMonth } from '../import/files';
import { chatPieces, detectChats } from '../import/chats';
import { devpostUser, parseProfile, parseProject } from '../import/devpost';
import { cleanReadme, prettyName } from '../import/github';
import { localProfileFields } from '../import/resume';
import { editRatio, filterSignal, redactPersonal, titleSimilarity } from '../text';
import { parseJson } from '../ai/providers';
import { emptyVault, type AnswerMemory } from '../types';
import type { ScannedField } from '../fill/types';

const src = { kind: 'paste' as const, at: '2026-01-01' };
const field = (question: string, extra: Partial<ScannedField> = {}): ScannedField => ({
  id: 'f1', frameId: 0, kind: 'text', question, required: false, ...extra,
});

describe('text', () => {
  it('matches hackathon names loosely', () => {
    expect(titleSimilarity('NASA Space Apps 2025', 'NASA Space Apps Challenge 2025')).toBeGreaterThan(0.7);
    expect(titleSimilarity('Weather app', 'Hackathon bot')).toBeLessThan(0.3);
  });
  it('measures edits', () => {
    expect(editRatio('I built a bot', 'I built a bot')).toBe(0);
    expect(editRatio('I built a bot', 'We shipped an app')).toBeGreaterThan(0.7);
  });
  it('keeps only paragraphs with signal words', () => {
    const t = 'Nice weather today.\n\nWe won 2nd place at the hackathon!\n\nLunch was good.';
    expect(filterSignal(t)).toBe('We won 2nd place at the hackathon!');
  });
  it('redacts personal details', () => {
    const r = redactPersonal('Mail ali@x.com, call +92 300 1234567, CNIC 35202-1234567-1. I am Ali Khan.', ['Ali Khan']);
    expect(r).not.toMatch(/ali@x\.com|1234567|Ali Khan/);
  });
  it('parses fenced JSON', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
  });
});

describe('inbox', () => {
  it('merges duplicates and proposes updates', () => {
    const v = emptyVault();
    propose(v, 'hackathons', [{ name: 'NASA Space Apps 2025', team: ['A'] }], src);
    propose(v, 'hackathons', [{ name: 'NASA Space Apps Challenge 2025', result: 'Finalist', team: ['B'] }], src);
    expect(v.inbox).toHaveLength(1);
    expect(v.inbox[0].data.team).toEqual(['A', 'B']);
    applyInboxItem(v, v.inbox[0].id);
    expect(v.hackathons).toHaveLength(1);
    propose(v, 'hackathons', [{ name: 'NASA Space Apps 2025', result: 'Winner' }], src);
    expect(v.inbox[0].op).toBe('update');
    expect(v.inbox[0].before).toEqual({ result: 'Finalist' });
    propose(v, 'hackathons', [{ name: 'NASA Space Apps 2025', result: 'winner' }], src);
    expect(v.inbox).toHaveLength(1);
  });
  it('links hackathons to projects', () => {
    const v = emptyVault();
    propose(v, 'hackathons', [{ name: 'Devfest', projectTitle: 'CropDoc' }], src);
    propose(v, 'projects', [{ title: 'CropDoc', summary: 'Plant disease detector' }], src);
    for (const i of [...v.inbox]) applyInboxItem(v, i.id);
    relink(v);
    expect(v.hackathons[0].projectId).toBe(v.projects[0].id);
  });
  it('proposes profile changes with old values', () => {
    const v = emptyVault();
    v.profile.cgpa = '3.4';
    proposeProfile(v, { cgpa: '3.5' }, src);
    expect(v.inbox[0].before).toEqual({ cgpa: '3.4' });
  });
});

describe('profile matching', () => {
  it('maps common questions', () => {
    expect(profileKeyFor(field('Full Name'))).toBe('name');
    expect(profileKeyFor(field('Email address'))).toBe('email');
    expect(profileKeyFor(field('WhatsApp number'))).toBe('phone');
    expect(profileKeyFor(field('Your CGPA'))).toBe('cgpa');
    expect(profileKeyFor(field('LinkedIn profile URL'))).toBe('linkedin');
    expect(profileKeyFor(field('University / Institute'))).toBe('university');
  });
  it('does not treat team fields as yours', () => {
    expect(profileKeyFor(field('Team name'))).toBeNull();
    expect(profileKeyFor(field('Team member 2 name'))).toBeNull();
    expect(profileKeyFor(field('Project name'))).toBeNull();
  });
  it('picks a matching dropdown option', () => {
    const p = { university: 'FAST NUCES Karachi' };
    expect(instantFill(field('University', { kind: 'select', options: ['LUMS', 'FAST NUCES', 'NUST'] }), p)?.value).toBe('FAST NUCES');
  });
});

describe('answer memory', () => {
  const m: AnswerMemory = {
    id: 'a', question: 'Why do you want to participate in this hackathon?', site: 'Hackathon 1', wordLimit: 1000,
    text: 'word '.repeat(600).trim(), usedEntryIds: [], editRatio: 0, createdAt: '',
  };
  it('finds similar questions without embeddings', () => {
    expect(matchMemory('Why do you want to participate in the hackathon', undefined, [m])).not.toBeNull();
    expect(matchMemory('What is your T-shirt size?', undefined, [m])).toBeNull();
  });
  it('adapts when limits differ', () => {
    expect(decideMode(m, 300)).toBe('adapt');
    expect(decideMode(m, 1000)).toBe('reuse');
  });
});

describe('vault picks', () => {
  const v = emptyVault();
  v.projects.push({ id: 'p', title: 'X', tech: [], links: [], updatedAt: '', sources: [] });
  v.hackathons.push({ id: 'h', name: 'Y', team: [], updatedAt: '', sources: [] });
  it('detects pick and list questions', () => {
    expect(detectPick('Which project are you proudest of?', v)).toEqual({ mode: 'pick', section: 'projects' });
    expect(detectPick('List your past hackathons', v)).toEqual({ mode: 'list', section: 'hackathons' });
    expect(detectPick('Why should we pick you?', v)).toBeNull();
  });
});

describe('importers', () => {
  it('parses LinkedIn CSVs with notes above the header', () => {
    const csv = 'Notes:\n"Some note"\n\nFirst Name,Last Name,Headline\nAli,"Khan, Jr",Student\n';
    expect(parseCsv(csv, 'First Name')).toEqual([{ 'First Name': 'Ali', 'Last Name': 'Khan, Jr', Headline: 'Student' }]);
  });
  it('normalises dates', () => {
    expect(toYearMonth('Mar 2023')).toBe('2023-03');
    expect(toYearMonth('2024-11-02 10:00:00 UTC')).toBe('2024-11');
    expect(toYearMonth('2022')).toBe('2022');
  });
  it('classifies skills', () => {
    expect(classifySkills(['Python', 'React', 'Figma'])).toEqual({ languages: ['Python'], frameworks: ['React'], tools: ['Figma'] });
  });
  it('reads ChatGPT exports and keeps own-work chats', () => {
    const json = JSON.stringify([
      { title: 'Hackathon pitch', create_time: 1700000000, mapping: { a: { message: { author: { role: 'user' }, create_time: 1, content: { parts: ['We built CropDoc and won 2nd place at Devfest hackathon'] } } } } },
      { title: 'Fix CSS', create_time: 1700000000, mapping: { a: { message: { author: { role: 'user' }, create_time: 1, content: { parts: ['center a div'] } } } } },
    ]);
    const det = detectChats(new Map([['conversations.json', new TextEncoder().encode(json)]]));
    expect(det?.kind).toBe('chatgpt');
    const pieces = chatPieces(det!.convos);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toContain('CropDoc');
  });
  it('reads Claude exports', () => {
    const json = JSON.stringify([{ name: 'x', created_at: '2025-02-01', chat_messages: [{ sender: 'human', text: 'my project won a prize' }] }]);
    expect(detectChats(new Map([['conversations.json', new TextEncoder().encode(json)]]))?.kind).toBe('claude');
  });
  it('parses Devpost pages', () => {
    expect(devpostUser('https://devpost.com/ali-k')).toBe('ali-k');
    const prof = parseProfile('<a class="link-to-software" href="https://devpost.com/software/cropdoc"><h5>CropDoc</h5><p class="small tagline">Detect plant disease</p><img class="winner"></a>');
    expect(prof).toEqual([{ url: 'https://devpost.com/software/cropdoc', title: 'CropDoc', tagline: 'Detect plant disease', winner: true }]);
    const proj = parseProject('<div id="built-with"><span class="cp-tag">python</span><span class="cp-tag">flask</span></div><time datetime="2024-03-10T00:00"></time><a class="user-profile-link">Ali</a>');
    expect(proj.builtWith).toEqual(['python', 'flask']);
    expect(proj.date).toBe('2024-03');
    expect(proj.team).toEqual(['Ali']);
  });
  it('cleans READMEs and names', () => {
    expect(cleanReadme('# X\n![img](a.png)\n```\nnpm i\n```\nText')).toBe('# X\n\nText');
    expect(prettyName('crop-doc_app')).toBe('Crop Doc App');
  });
  it('reads contact details from a resume locally', () => {
    const p = localProfileFields('Ali Khan\nali.khan@nu.edu.pk | 0300-1234567\ngithub.com/alik | linkedin.com/in/alik\nFAST NUCES Karachi\nCGPA: 3.45');
    expect(p).toMatchObject({ name: 'Ali Khan', email: 'ali.khan@nu.edu.pk', cgpa: '3.45', github: 'https://github.com/alik' });
  });
});

describe('inbox undo', () => {
  it('restores the vault but keeps finds that arrived since', () => {
    const v = emptyVault();
    propose(v, 'projects', [{ title: 'FormVault', summary: 'A vault' }], { kind: 'paste', at: '2026-01-01' });
    const before = structuredClone(v);
    applyInboxItem(v, v.inbox[0].id);
    const after = structuredClone(v);
    expect(after.projects).toHaveLength(1);
    expect(after.inbox).toHaveLength(0);
    // an import finishes in the meantime
    propose(v, 'hackathons', [{ name: 'HackNU' }], { kind: 'paste', at: '2026-01-01' });
    const undone = undoInboxAction(v, before, after);
    expect(undone.projects).toHaveLength(0);
    expect(undone.inbox.map((i) => i.section).sort()).toEqual(['hackathons', 'projects']);
  });
});
