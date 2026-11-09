// Injected into the page (all frames) only when the user clicks the FormVault icon.
// Finds every field, works out its question, and later types approved answers in a way
// the page recognises (React, Google Forms, etc.). It never presses Submit.

import type { FieldKind, FillCommand, FillOutcome, ScannedField } from '@/lib/fill/types';

export default defineUnlistedScript(() => {
  const w = window as any;
  if (w.__formvault) return;

  type Target =
    | { kind: Exclude<FieldKind, 'radio' | 'checkbox' | 'select'>; el: HTMLElement }
    | { kind: 'select'; el: HTMLSelectElement | HTMLElement; gf?: boolean }
    | { kind: 'radio' | 'checkbox'; options: { label: string; el: HTMLElement }[]; gf?: boolean };

  const targets = new Map<string, Target>();
  let seq = 0;

  // ── helpers ──
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();

  function visible(el: Element): boolean {
    const h = el as HTMLElement;
    if (h.hidden || h.closest('[hidden],[aria-hidden="true"]')) return false;
    const st = getComputedStyle(h);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return h.getClientRects().length > 0;
  }

  /** querySelectorAll that also descends into open shadow roots */
  function deepAll<T extends Element>(root: ParentNode, sel: string): T[] {
    const out: T[] = [...root.querySelectorAll<T>(sel)];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepAll<T>(el.shadowRoot, sel));
    return out;
  }

  const textOf = (id: string) => clean(document.getElementById(id)?.textContent);

  function labelFor(el: HTMLElement): string {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map(textOf).join(' ').trim();
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && clean(l.textContent)) return clean(l.textContent);
    }
    const wrap = el.closest('label');
    if (wrap) {
      const t = clean([...wrap.childNodes].filter((n) => n !== el && !(n as Element).matches?.('input,select,textarea')).map((n) => n.textContent).join(' '));
      if (t) return t;
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    // Nearby text before the field (up to 3 levels up)
    let node: Element | null = el;
    for (let depth = 0; depth < 4 && node; depth++) {
      let prev = node.previousElementSibling;
      while (prev) {
        if (!prev.matches('input,select,textarea,button,script,style') && visible(prev)) {
          const t = clean((prev as HTMLElement).innerText ?? prev.textContent);
          if (t && t.length < 400) return t;
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
      if (node?.matches('form,body')) break;
    }
    const ph = (el as HTMLInputElement).placeholder;
    if (ph) return clean(ph);
    const name = el.getAttribute('name') ?? el.id;
    return name ? name.replace(/[_\-[\]]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() : '';
  }

  function limits(text: string, el?: HTMLElement) {
    const t = text.toLowerCase();
    const wm =
      t.match(/(?:max(?:imum)?|up to|under|less than|no more than|within|not exceed(?:ing)?|limit(?:ed)? to)\s*(?:of\s*)?(\d{2,4})\s*words?/) ??
      t.match(/(\d{2,4})\s*(?:-|–)?\s*words?\s*(?:max|limit|or less)/) ??
      t.match(/\((\d{2,4})\s*words?\)/) ??
      t.match(/(?:\d{1,4}\s*(?:-|–|to)\s*)(\d{2,4})\s*words?/);
    const cm = t.match(/(\d{2,5})\s*char/);
    const ml = el && 'maxLength' in el ? (el as HTMLInputElement).maxLength : -1;
    return {
      wordLimit: wm ? parseInt(wm[1], 10) : undefined,
      charLimit: ml > 0 && ml < 100000 ? ml : cm ? parseInt(cm[1], 10) : undefined,
    };
  }

  function add(f: Omit<ScannedField, 'id' | 'frameId'>, t: Target): ScannedField {
    const id = `fv${++seq}`;
    targets.set(id, t);
    const el = 'el' in t ? t.el : t.options[0]?.el;
    el?.setAttribute('data-formvault', id);
    return { ...f, id, frameId: 0 };
  }

  // ── Google Forms: questions sit in custom blocks ──
  function scanGoogleForm(): ScannedField[] {
    const out: ScannedField[] = [];
    for (const item of document.querySelectorAll<HTMLElement>('[role="listitem"]')) {
      if (!visible(item)) continue;
      const heading = item.querySelector<HTMLElement>('[role="heading"]');
      if (!heading) continue;
      const required = !!item.querySelector('[aria-label="Required question"]') || /\*\s*$/.test(heading.innerText);
      const question = clean(heading.innerText);
      // Description: text between the heading and the inputs
      const all = clean(item.innerText);
      const description = clean(all.replace(heading.innerText.trim(), '').split('\n')[0]).slice(0, 400) || undefined;
      const lim = limits(`${question} ${description ?? ''}`);

      const radios = [...item.querySelectorAll<HTMLElement>('[role="radio"]')];
      const checks = [...item.querySelectorAll<HTMLElement>('[role="checkbox"]')];
      const listbox = item.querySelector<HTMLElement>('[role="listbox"]');
      const ta = item.querySelector<HTMLTextAreaElement>('textarea');
      const input = item.querySelector<HTMLInputElement>('input:not([type="hidden"])');
      const fileBtn = /add file|upload/i.test(all) && !input && !ta;

      const optLabel = (el: HTMLElement) => clean(el.getAttribute('aria-label') ?? el.getAttribute('data-value') ?? el.getAttribute('data-answer-value') ?? el.innerText);

      if (radios.length) {
        const options = radios.map((el) => ({ label: optLabel(el), el }));
        out.push(add({ kind: 'radio', question, description, required, options: options.map((o) => o.label).filter((l) => l !== '__other_option__'), currentValue: options.find((o) => o.el.getAttribute('aria-checked') === 'true')?.label }, { kind: 'radio', options, gf: true }));
      } else if (checks.length) {
        const options = checks.map((el) => ({ label: optLabel(el), el }));
        out.push(add({ kind: 'checkbox', question, description, required, options: options.map((o) => o.label), currentValue: options.filter((o) => o.el.getAttribute('aria-checked') === 'true').map((o) => o.label) }, { kind: 'checkbox', options, gf: true }));
      } else if (listbox) {
        const options = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => clean(o.getAttribute('data-value') ?? o.innerText)).filter((x) => x && !/^choose$/i.test(x));
        out.push(add({ kind: 'select', question, description, required, options }, { kind: 'select', el: listbox, gf: true }));
      } else if (ta) {
        out.push(add({ kind: 'textarea', question, description, required, ...lim, currentValue: ta.value }, { kind: 'textarea', el: ta }));
      } else if (input) {
        const type = input.type === 'date' ? 'date' : input.type === 'email' ? 'email' : input.type === 'url' ? 'url' : input.type === 'number' ? 'number' : 'text';
        out.push(add({ kind: type, question, description, required, ...lim, currentValue: input.value }, { kind: type, el: input }));
      } else if (fileBtn) {
        out.push(add({ kind: 'file', question, description, required }, { kind: 'file', el: item }));
      }
    }
    return out;
  }

  // ── Any other form ──
  function scanGeneric(): ScannedField[] {
    const out: ScannedField[] = [];
    const seenGroups = new Set<string>();
    const els = deepAll<HTMLElement>(document, 'input, textarea, select, [contenteditable="true"], [role="textbox"]').filter(
      (el) => visible(el) && !el.closest('[data-formvault-ui]') && !(el as HTMLInputElement).disabled,
    );
    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      const type = ((el as HTMLInputElement).type ?? '').toLowerCase();
      if (tag === 'input' && ['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search', 'range', 'color'].includes(type)) continue;
      if ((el as HTMLInputElement).readOnly) continue;
      const hint = [el.getAttribute('autocomplete'), el.getAttribute('name'), el.id].filter(Boolean).join(' ');

      if (type === 'radio' || type === 'checkbox') {
        const name = (el as HTMLInputElement).name;
        const group = name ? deepAll<HTMLInputElement>(el.getRootNode() as ParentNode, `input[type="${type}"][name="${CSS.escape(name)}"]`).filter(visible) : [el as HTMLInputElement];
        const key = `${type}:${name || Math.random()}`;
        if (seenGroups.has(key)) continue;
        seenGroups.add(key);
        const fs = el.closest('fieldset');
        const legend = clean(fs?.querySelector('legend')?.textContent) || clean(el.closest('[role="radiogroup"],[role="group"]')?.getAttribute('aria-label'));
        const options = group.map((g) => ({ label: labelFor(g) || g.value, el: g as HTMLElement }));
        if (type === 'checkbox' && group.length === 1) {
          out.push(add({ kind: 'checkbox-single', question: options[0].label, required: (el as HTMLInputElement).required, hint, currentValue: (el as HTMLInputElement).checked ? 'yes' : 'no' }, { kind: 'checkbox-single', el }));
          continue;
        }
        let question = legend;
        if (!question) {
          // text just above the first option, from the container above the group
          const container = group[0].closest('div,section,li,p')?.parentElement;
          question = labelFor((container ?? group[0]) as HTMLElement);
        }
        out.push(
          add(
            {
              kind: type as 'radio' | 'checkbox',
              question: question || 'Choose',
              required: group.some((g) => g.required),
              options: options.map((o) => o.label),
              hint,
              currentValue: type === 'radio' ? options.find((o) => (o.el as HTMLInputElement).checked)?.label : options.filter((o) => (o.el as HTMLInputElement).checked).map((o) => o.label),
            },
            { kind: type as 'radio' | 'checkbox', options },
          ),
        );
        continue;
      }

      const question = labelFor(el);
      const lim = limits(question, el);
      const required = (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true';
      if (tag === 'select') {
        const sel = el as HTMLSelectElement;
        const options = [...sel.options].filter((o) => o.value !== '' && !o.disabled).map((o) => clean(o.textContent));
        out.push(add({ kind: 'select', question, required, options, hint, currentValue: sel.selectedOptions[0] ? clean(sel.selectedOptions[0].textContent) : '' }, { kind: 'select', el: sel }));
      } else if (tag === 'textarea') {
        out.push(add({ kind: 'textarea', question, required, ...lim, hint, currentValue: (el as HTMLTextAreaElement).value }, { kind: 'textarea', el }));
      } else if (tag === 'input') {
        const k: FieldKind = type === 'file' ? 'file' : (['email', 'tel', 'url', 'number', 'date'] as string[]).includes(type) ? (type as FieldKind) : 'text';
        out.push(add({ kind: k, question, required, ...lim, hint, currentValue: (el as HTMLInputElement).value }, { kind: k as 'text', el }));
      } else {
        out.push(add({ kind: 'contenteditable', question, required, ...lim, hint, currentValue: el.innerText }, { kind: 'contenteditable', el }));
      }
    }
    return out;
  }

  function scan() {
    targets.clear();
    document.querySelectorAll('[data-formvault]').forEach((e) => e.removeAttribute('data-formvault'));
    const isGoogleForm = location.hostname === 'docs.google.com' && location.pathname.includes('/forms/');
    const fields = isGoogleForm ? scanGoogleForm() : scanGeneric();
    return { url: location.href, title: document.title, fields: fields.filter((f) => f.question || f.options?.length), isGoogleForm };
  }

  // ── filling ──
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const matches = (label: string, want: string) => {
    const a = norm(label);
    const b = norm(want);
    return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));
  };

  function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  }

  function flash(el: HTMLElement | undefined) {
    if (!el) return;
    const old = el.style.outline;
    el.style.outline = '2px solid #4f46e5';
    setTimeout(() => (el.style.outline = old), 1500);
  }

  async function fillOne(cmd: FillCommand): Promise<FillOutcome> {
    const t = targets.get(cmd.id);
    if (!t) return { id: cmd.id, ok: false, reason: 'The form changed — rescan.' };
    const values = Array.isArray(cmd.value) ? cmd.value : [cmd.value];
    const v = values[0] ?? '';
    try {
      switch (t.kind) {
        case 'radio': {
          const opt = t.options.find((o) => matches(o.label, v));
          if (!opt) return { id: cmd.id, ok: false, reason: `No option "${v}"` };
          if (t.gf ? opt.el.getAttribute('aria-checked') !== 'true' : !(opt.el as HTMLInputElement).checked) opt.el.click();
          flash(opt.el);
          return { id: cmd.id, ok: true };
        }
        case 'checkbox': {
          let hit = 0;
          for (const o of t.options) {
            const want = values.some((x) => matches(o.label, x));
            const is = t.gf ? o.el.getAttribute('aria-checked') === 'true' : (o.el as HTMLInputElement).checked;
            if (want !== is) {
              o.el.click();
              await sleep(30);
            }
            if (want) hit++;
          }
          flash(t.options[0]?.el.parentElement ?? undefined);
          return { id: cmd.id, ok: hit > 0 || !values.length };
        }
        case 'select': {
          if (!t.gf) {
            const sel = t.el as HTMLSelectElement;
            const opt = [...sel.options].find((o) => matches(o.textContent ?? '', v) || o.value === v);
            if (!opt) return { id: cmd.id, ok: false, reason: `No option "${v}"` };
            setNativeValue(sel, opt.value);
            flash(sel);
            return { id: cmd.id, ok: true };
          }
          // Google Forms dropdown: open it, then click the option in the popup
          t.el.click();
          await sleep(350);
          const popupOpts = [...document.querySelectorAll<HTMLElement>('[role="option"]')].filter(visible);
          const o = popupOpts.find((x) => matches(x.getAttribute('data-value') ?? x.innerText, v));
          if (!o) {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return { id: cmd.id, ok: false, reason: `No option "${v}"` };
          }
          o.click();
          await sleep(250);
          flash(t.el);
          return { id: cmd.id, ok: true };
        }
        case 'checkbox-single': {
          const want = /^(yes|true|checked|agree|1)$/i.test(v);
          const el = t.el as HTMLInputElement;
          if (el.checked !== want) el.click();
          return { id: cmd.id, ok: true };
        }
        case 'file':
          return { id: cmd.id, ok: false, reason: 'Upload this file yourself.' };
        case 'contenteditable': {
          t.el.focus();
          document.getSelection()?.selectAllChildren(t.el);
          if (!document.execCommand('insertText', false, v)) t.el.innerText = v;
          t.el.dispatchEvent(new Event('input', { bubbles: true }));
          flash(t.el);
          return { id: cmd.id, ok: true };
        }
        default: {
          const el = t.el as HTMLInputElement | HTMLTextAreaElement;
          let val = v;
          if (t.kind === 'date') {
            const m = v.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
            if (m) val = `${m[1]}-${m[2]}-${m[3] ?? '01'}`;
          }
          setNativeValue(el, val);
          flash(el);
          return { id: cmd.id, ok: true };
        }
      }
    } catch (e) {
      return { id: cmd.id, ok: false, reason: String(e) };
    }
  }

  async function fill(cmds: FillCommand[]): Promise<FillOutcome[]> {
    const out: FillOutcome[] = [];
    for (const c of cmds) {
      out.push(await fillOne(c));
      await sleep(40);
    }
    return out;
  }

  /** Current values, used after filling to spot new facts the user typed into the page. */
  function read(ids: string[]): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const id of ids) {
      const t = targets.get(id);
      if (!t) continue;
      if (t.kind === 'radio' || t.kind === 'checkbox') {
        const on = t.options.filter((o) => (t.gf ? o.el.getAttribute('aria-checked') === 'true' : (o.el as HTMLInputElement).checked)).map((o) => o.label);
        out[id] = t.kind === 'radio' ? on[0] ?? '' : on;
      } else if (t.kind === 'contenteditable') out[id] = t.el.innerText;
      else if ('value' in t.el) out[id] = (t.el as HTMLInputElement).value;
    }
    return out;
  }

  function focus(id: string) {
    const t = targets.get(id);
    const el = t ? ('el' in t ? t.el : t.options[0]?.el) : null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flash(el ?? undefined);
  }

  // Tell the panel when a multi-page form moves to the next page.
  let sig = '';
  let timer = 0;
  const signature = () => document.querySelectorAll('input,textarea,select,[role="listitem"]').length + ':' + location.href;
  sig = signature();
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const s = signature();
      if (s !== sig) {
        sig = s;
        browser.runtime.sendMessage({ type: 'fv:pageChanged' }).catch(() => {});
      }
    }, 800);
  }).observe(document.documentElement, { childList: true, subtree: true });

  w.__formvault = { scan, fill, read, focus };
});
