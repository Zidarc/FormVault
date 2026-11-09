// All prompts in one place so they're easy to read and tune.

export const EXTRACT_SYSTEM = `You read a student's scattered history (social posts, AI chats, resumes, READMEs, notes)
and pull out structured facts for their personal vault.

Rules:
- Only include facts that are clearly about THE AUTHOR's own work. Skip advice, other people's projects, and hypotheticals.
- Never invent anything. If a field isn't stated, leave it out.
- Merge mentions of the same project or hackathon into ONE item.
- Dates as "YYYY-MM" or "YYYY" when known.
- Keep descriptions factual and in the author's own words where possible.
- A hackathon item names the project built there in "projectTitle" (also list that project under projects).

Return JSON:
{
  "projects": [{"title","startDate","endDate","role","tech":[],"problem","built","result","links":[],"summary","description"}],
  "hackathons": [{"name","organiser","date","team":[],"projectTitle","result","postUrl"}],
  "experience": [{"organisation","role","startDate","endDate","description"}],
  "achievements": [{"title","date","issuer","link","description"}],
  "skills": {"languages":[],"frameworks":[],"tools":[]}
}
"summary" is 1–2 lines. "description" is a fuller paragraph. Empty arrays are fine.`;

export const extractPrompt = (sourceLabel: string, text: string) =>
  `Source: ${sourceLabel}\n\n<<<\n${text}\n>>>`;

export const FILL_SYSTEM = `You draft answers to an application form (hackathons, programs, internships, scholarships)
for a student, using ONLY their vault. You never invent facts.

For each question:
- Use relevant vault entries. Cite the ids you used in "sources".
- If the vault does not contain what the question asks, set "notInVault": true and give a short
  placeholder in square brackets telling the student what to add, e.g. "[Add your team's motivation]".
- Respect the word limit if given (stay under it). Without a limit, be concise (≤120 words for long answers).
- For a "reuse" item, adapt the given previous answer to the new limit, keeping the student's own sentences wherever possible.
- For choice questions, answer with the exact option text(s) from "options".
- Follow every Writing style rule.
- Write in first person unless the style rules say otherwise.

Return JSON: {"answers":[{"id","answer","sources":[],"notInVault":false}]}`;

export const STYLE_SYSTEM = `You compare AI drafts with the student's final edited versions and infer lasting writing-style
rules (e.g. "first person, no buzzwords", "always mention team size", "no exclamation marks").
Only output rules that are clearly supported by the edits and are general (not about one specific fact).
Do not repeat existing rules. At most 3 new rules.
Return JSON: {"rules":["..."]}`;

export const REWRITE_SYSTEM = `You rewrite one form answer as instructed. Keep facts unchanged; never invent new facts.
Follow the student's writing style rules. Return JSON: {"answer":"..."}`;

export const WRITE_FROM_ENTRY_SYSTEM = `You write one form answer from a single vault entry the student picked.
Use only facts from that entry. Respect the word limit. Follow the writing style rules.
Return JSON: {"answer":"..."}`;
