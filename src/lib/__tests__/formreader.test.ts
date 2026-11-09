// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import reader from '../../entrypoints/formreader';

let fv: any;

beforeAll(() => {
  // happy-dom has no layout; treat everything as on-screen.
  Element.prototype.getClientRects = function () {
    return [{ width: 10, height: 10 }] as unknown as DOMRectList;
  };
  (reader as any).main();
  fv = (window as any).__formvault;
});

describe('form reader — any form', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <label for="n">Full name *</label><input id="n" name="fullname" required>
        <label>Email <input type="email" name="email"></label>
        <div><p>Why do you want to join? (max 150 words)</p><textarea name="why"></textarea></div>
        <fieldset><legend>Year of study</legend>
          <label><input type="radio" name="y" value="1">First</label>
          <label><input type="radio" name="y" value="2">Second</label>
        </fieldset>
        <label for="s">Track</label>
        <select id="s"><option value="">Choose</option><option value="ai">AI / ML</option><option value="web">Web</option></select>
        <input type="password" name="pw">
        <input type="file" aria-label="Resume">
        <div role="radiogroup" aria-label="T-shirt size">
          <div role="radio" aria-checked="false">S</div><div role="radio" aria-checked="false">M</div>
        </div>
      </form>`;
  });

  it('finds fields and their questions', () => {
    const { fields } = fv.scan();
    const q = fields.map((f: any) => [f.kind, f.question]);
    expect(q).toEqual([
      ['text', 'Full name'],
      ['email', 'Email'],
      ['textarea', 'Why do you want to join? (max 150 words)'],
      ['radio', 'Year of study'],
      ['select', 'Track'],
      ['file', 'Resume'],
      ['radio', 'T-shirt size'],
    ]);
    expect(fields[2].wordLimit).toBe(150);
    expect(fields[0].required).toBe(true);
    expect(fields[4].options).toEqual(['AI / ML', 'Web']);
  });

  it('fills text, radios, selects and ARIA widgets with events', async () => {
    const { fields } = fv.scan();
    const byQ = (q: string) => fields.find((f: any) => f.question.startsWith(q)).id;
    let inputs = 0;
    document.querySelector('#n')!.addEventListener('input', () => inputs++);
    const sizeM = document.querySelectorAll('[role="radio"]')[1] as HTMLElement;
    sizeM.addEventListener('click', () => sizeM.setAttribute('aria-checked', 'true'));
    const res = await fv.fill([
      { id: byQ('Full name'), value: 'Ali Khan' },
      { id: byQ('Year'), value: 'Second' },
      { id: byQ('Track'), value: 'Web' },
      { id: byQ('Why'), value: 'Because.' },
      { id: byQ('T-shirt'), value: 'M' },
      { id: byQ('Resume'), value: 'x' },
    ]);
    expect(res.map((r: any) => r.ok)).toEqual([true, true, true, true, true, false]);
    expect((document.querySelector('#n') as HTMLInputElement).value).toBe('Ali Khan');
    expect(inputs).toBe(1);
    expect((document.querySelector('input[value="2"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('#s') as HTMLSelectElement).value).toBe('web');
    expect(sizeM.getAttribute('aria-checked')).toBe('true');
    expect(fv.read([byQ('Full name')])[byQ('Full name')]).toBe('Ali Khan');
  });
});

describe('form reader — Google Forms layout', () => {
  it('reads custom question blocks', () => {
    // Pretend we're on Google Forms
    const loc = new URL('https://docs.google.com/forms/d/e/abc/viewform');
    (window as any).happyDOM?.setURL?.(loc.href);
    document.body.innerHTML = `
      <div role="list">
        <div role="listitem"><div role="heading">Team name<span aria-label="Required question">*</span></div><input type="text"></div>
        <div role="listitem"><div role="heading">Describe your project</div><div>In under 200 words</div><textarea></textarea></div>
        <div role="listitem"><div role="heading">Track</div>
          <div role="radiogroup"><div role="radio" data-value="AI" aria-label="AI" aria-checked="false"></div><div role="radio" data-value="Web" aria-label="Web" aria-checked="false"></div></div>
        </div>
      </div>`;
    const r = fv.scan();
    expect(r.isGoogleForm).toBe(true);
    expect(r.fields.map((f: any) => [f.kind, f.question])).toEqual([
      ['text', 'Team name'],
      ['textarea', 'Describe your project'],
      ['radio', 'Track'],
    ]);
    expect(r.fields[0].required).toBe(true);
    expect(r.fields[1].wordLimit).toBe(200);
    expect(r.fields[2].options).toEqual(['AI', 'Web']);
  });
});
