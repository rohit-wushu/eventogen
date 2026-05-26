import JSZip from 'jszip';

// Exports a built form as a self-contained HTML file, or a ZIP bundle with
// HTML / CSS / JS split out. The exported page:
//   - renders every field type (name, email, phone, address, text, textarea,
//     number, date, time, dropdown, radio, checkbox, file)
//   - client-side `required` + type validation
//   - uploads file fields to the backend's public /upload endpoint, then posts
//     the full submission as JSON to /public/:id/submit
//   - swaps the form for a thank-you panel on success
//
// `apiBase` is baked into the JS so the exported page can live on any host.
// Admin can edit the constant post-export if the backend URL changes.

const esc = (s = '') => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const attr = (s = '') => String(s).replace(/"/g, '&quot;');

const slug = (s = 'form') => String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'form';

// Build the inside of the <form> — each field as its own .eh-field block.
const fieldMarkup = (f) => {
    const id = `f-${f.id}`;
    const name = String(f.id);
    const req = f.required ? ' required' : '';
    const star = f.required ? ' <span class="eh-req">*</span>' : '';
    const help = f.help_text ? `<div class="eh-help">${esc(f.help_text)}</div>` : '';
    const widthClass = f.width === 'half' ? 'eh-half' : 'eh-full';
    const ph = f.placeholder ? ` placeholder="${attr(f.placeholder)}"` : '';
    const label = `<label for="${id}">${esc(f.label || '')}${star}</label>`;
    const wrap = (inner) => `<div class="eh-field ${widthClass}">${label}${help}${inner}</div>`;

    switch (f.field_type) {
        case 'textarea':
        case 'address':
            return wrap(`<textarea id="${id}" name="${name}" rows="${f.field_type === 'address' ? 3 : 4}"${ph}${req}></textarea>`);
        case 'email':
            return wrap(`<input id="${id}" name="${name}" type="email"${ph}${req}>`);
        case 'phone':
            return wrap(`<input id="${id}" name="${name}" type="tel"${ph}${req}>`);
        case 'number':
            return wrap(`<input id="${id}" name="${name}" type="number"${ph}${req}>`);
        case 'date':
            return wrap(`<input id="${id}" name="${name}" type="date"${req}>`);
        case 'time':
            return wrap(`<input id="${id}" name="${name}" type="time"${req}>`);
        case 'dropdown': {
            const opts = [`<option value="">${esc(f.placeholder || '— Select —')}</option>`]
                .concat((f.options || []).map(o => `<option value="${attr(o)}">${esc(o)}</option>`))
                .join('');
            return wrap(`<select id="${id}" name="${name}"${req}>${opts}</select>`);
        }
        case 'radio': {
            const items = (f.options || []).map((o, i) =>
                `<label class="eh-choice"><input type="radio" name="${name}" value="${attr(o)}"${i === 0 && f.required ? ' required' : ''}> <span>${esc(o)}</span></label>`
            ).join('');
            return wrap(`<div class="eh-choices">${items || '<em class="eh-empty">No options configured.</em>'}</div>`);
        }
        case 'checkbox': {
            const items = (f.options || []).map(o =>
                `<label class="eh-choice"><input type="checkbox" name="${name}" value="${attr(o)}" data-group="1"> <span>${esc(o)}</span></label>`
            ).join('');
            return wrap(`<div class="eh-choices" data-required="${f.required ? '1' : '0'}" data-field="${name}">${items || '<em class="eh-empty">No options configured.</em>'}</div>`);
        }
        case 'file':
            return wrap(`<input id="${id}" name="${name}" type="file"${req}>`);
        case 'award_category': {
            // Empty cascading selects — populated by the runtime JS after it
            // fetches the form (which includes the event's award_categories).
            return wrap(
                `<div class="eh-award-cat" data-field="${name}" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <select class="eh-award-primary" data-field="${name}"${req}>
                        <option value="">— Loading categories —</option>
                    </select>
                    <select class="eh-award-sub" data-field="${name}">
                        <option value="">— Subcategory —</option>
                    </select>
                </div>`
            );
        }
        case 'name':
        case 'text':
        default:
            return wrap(`<input id="${id}" name="${name}" type="text"${ph}${req}>`);
    }
};

// Neutral, brand-agnostic styling that looks clean on any host page.
const buildCss = () => `
* { box-sizing: border-box; }
body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #f1f5f9;
    color: #0f172a;
}
.eh-wrap {
    max-width: 720px;
    margin: 40px auto;
    padding: 0 16px;
}
.eh-card {
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 10px 30px -15px rgba(15, 23, 42, 0.15);
    border: 1px solid #e2e8f0;
    padding: 32px;
}
.eh-header { margin-bottom: 22px; }
.eh-header h1 { font-size: 1.6rem; margin: 0 0 6px; color: #0f172a; }
.eh-header p  { margin: 0; color: #64748b; font-size: 0.95rem; }

.eh-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
}
@media (max-width: 640px) {
    .eh-grid { grid-template-columns: 1fr; }
    .eh-half { grid-column: 1 / -1; }
}
.eh-full { grid-column: 1 / -1; }
.eh-half { grid-column: span 1; }

.eh-field label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: #334155;
    margin-bottom: 6px;
}
.eh-req { color: #ef4444; margin-left: 2px; }
.eh-help {
    font-size: 0.78rem;
    color: #64748b;
    margin: -2px 0 6px;
}
.eh-field input[type=text],
.eh-field input[type=email],
.eh-field input[type=tel],
.eh-field input[type=number],
.eh-field input[type=date],
.eh-field input[type=time],
.eh-field textarea,
.eh-field select {
    width: 100%;
    padding: 10px 12px;
    font: inherit;
    color: #0f172a;
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
}
.eh-field textarea { resize: vertical; min-height: 90px; }
.eh-field input:focus,
.eh-field textarea:focus,
.eh-field select:focus {
    border-color: #8b5cf6;
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
}
.eh-field input[type=file] {
    display: block;
    padding: 10px;
    border: 1px dashed #cbd5e1;
    border-radius: 8px;
    background: #f8fafc;
    width: 100%;
}
.eh-choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 0;
}
.eh-choice {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
    color: #334155;
    cursor: pointer;
    font-weight: 500;
}
.eh-choice input { accent-color: #8b5cf6; }
.eh-empty { color: #94a3b8; font-style: italic; font-size: 0.8rem; }

.eh-submit {
    margin-top: 24px;
    width: 100%;
    padding: 12px 20px;
    font: inherit;
    font-weight: 700;
    color: #fff;
    background: linear-gradient(135deg, #8b5cf6, #ec4899);
    border: 0;
    border-radius: 10px;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
    box-shadow: 0 8px 20px -8px #8b5cf6;
}
.eh-submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 26px -8px #8b5cf6; }
.eh-submit:disabled { opacity: 0.65; cursor: not-allowed; }

.eh-alert {
    margin-top: 16px;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 0.88rem;
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecaca;
    display: none;
}
.eh-alert.on { display: block; }

.eh-thanks {
    display: none;
    text-align: center;
    padding: 28px 8px;
}
.eh-thanks.on { display: block; }
.eh-thanks .eh-check {
    width: 56px; height: 56px;
    margin: 0 auto 14px;
    border-radius: 50%;
    background: #dcfce7;
    color: #16a34a;
    display: grid; place-items: center;
    font-size: 30px;
    font-weight: 700;
}
.eh-thanks h2 { margin: 0 0 6px; font-size: 1.3rem; color: #0f172a; }
.eh-thanks p  { margin: 0; color: #64748b; font-size: 0.95rem; }

.eh-footer {
    text-align: center;
    margin-top: 14px;
    font-size: 0.75rem;
    color: #94a3b8;
}
`;

// Client-side submit logic. The `API_BASE` constant is intentionally at the
// top so admins can edit it in-place after export (e.g. switch staging→prod).
const buildJs = (form, apiBase) => `
// ── Exported form runtime ──────────────────────────────────────
// Edit API_BASE below if you move this page to a different backend.
const API_BASE = ${JSON.stringify(apiBase.replace(/\/+$/, ''))};
const FORM_ID  = ${JSON.stringify(form.id)};

(function () {
    const formEl   = document.getElementById('eh-form');
    const btn      = document.getElementById('eh-submit');
    const errorBox = document.getElementById('eh-error');
    const thanks   = document.getElementById('eh-thanks');

    // Populate award-category cascading selects. Fetches the form definition
    // (which includes the event's award_categories) from the backend on load.
    async function populateAwardCategories() {
        const blocks = formEl.querySelectorAll('.eh-award-cat');
        if (blocks.length === 0) return;
        try {
            const res = await fetch(API_BASE + '/api/forms/public/' + FORM_ID);
            if (!res.ok) throw new Error('fetch failed');
            const form = await res.json();
            const cats = Array.isArray(form.award_categories) ? form.award_categories : [];
            blocks.forEach(block => {
                const primary = block.querySelector('.eh-award-primary');
                const sub     = block.querySelector('.eh-award-sub');
                const parents = cats.filter(c => c.parent_id == null);
                primary.innerHTML = '<option value="">— Choose a category —</option>'
                    + parents.map(p => '<option value="' + p.id + '">' + String(p.name).replace(/</g, '&lt;') + '</option>').join('');
                sub.innerHTML = '<option value="">— Subcategory —</option>';
                sub.disabled = true;
                primary.addEventListener('change', () => {
                    const pid = Number(primary.value);
                    const subs = cats.filter(c => Number(c.parent_id) === pid);
                    sub.innerHTML = '<option value="">— Subcategory —</option>'
                        + subs.map(s => '<option value="' + s.id + '">' + String(s.name).replace(/</g, '&lt;') + '</option>').join('');
                    sub.disabled = subs.length === 0;
                });
            });
        } catch {
            blocks.forEach(block => {
                const primary = block.querySelector('.eh-award-primary');
                primary.innerHTML = '<option value="">Unable to load categories</option>';
            });
        }
    }
    populateAwardCategories();

    function showError(msg) {
        errorBox.textContent = msg;
        errorBox.classList.add('on');
        errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function clearError() {
        errorBox.textContent = '';
        errorBox.classList.remove('on');
    }

    formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearError();

        // Custom required check for checkbox groups — HTML's "required" on a
        // single checkbox doesn't cover the "at least one in the group" case.
        const cbGroups = formEl.querySelectorAll('.eh-choices[data-required="1"]');
        for (const g of cbGroups) {
            const any = g.querySelectorAll('input[type=checkbox]:checked').length > 0;
            if (!any) { showError('Please answer all required questions.'); return; }
        }

        const origLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Submitting…';

        try {
            const data = {};

            // Checkbox groups → arrays.
            const cbNames = new Set();
            formEl.querySelectorAll('input[type=checkbox][data-group="1"]').forEach(el => cbNames.add(el.name));
            cbNames.forEach(n => {
                data[n] = Array.from(formEl.querySelectorAll('input[type=checkbox][name="' + n + '"]:checked')).map(el => el.value);
            });

            // Award-category fields → { category_id, subcategory_id }.
            formEl.querySelectorAll('.eh-award-cat').forEach(block => {
                const fieldName = block.getAttribute('data-field');
                const primary = block.querySelector('.eh-award-primary');
                const sub     = block.querySelector('.eh-award-sub');
                if (!primary.value) { data[fieldName] = null; return; }
                data[fieldName] = {
                    category_id: primary.value,
                    subcategory_id: sub && sub.value ? sub.value : null,
                };
            });

            // File fields → upload first, then store the returned metadata.
            const fileInputs = formEl.querySelectorAll('input[type=file]');
            for (const input of fileInputs) {
                if (!input.files || input.files.length === 0) {
                    if (input.required) throw new Error('Please attach the required file.');
                    continue;
                }
                const fd = new FormData();
                fd.append('file', input.files[0]);
                const up = await fetch(API_BASE + '/api/forms/public/' + FORM_ID + '/upload', { method: 'POST', body: fd });
                if (!up.ok) {
                    const txt = await up.text().catch(() => '');
                    throw new Error('File upload failed: ' + (txt || up.status));
                }
                data[input.name] = await up.json();
            }

            // Everything else via FormData (skips checkboxes we already captured and files we already handled).
            const fd = new FormData(formEl);
            for (const [k, v] of fd.entries()) {
                if (data[k] !== undefined) continue;
                const el = formEl.querySelector('[name="' + CSS.escape(k) + '"]');
                if (el && el.type === 'file') continue;
                data[k] = v;
            }

            const res = await fetch(API_BASE + '/api/forms/public/' + FORM_ID + '/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'Submission failed');

            formEl.style.display = 'none';
            thanks.classList.add('on');
            thanks.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // If the form was configured with a redirect URL, the server echoes
            // it back on successful submission. Jump there ~1.5s later so the
            // visitor still sees the thank-you confirmation first.
            if (body && body.redirect_url) {
                const redirectNote = document.getElementById('eh-redirect-note');
                const redirectLink = document.getElementById('eh-redirect-link');
                if (redirectLink) redirectLink.href = body.redirect_url;
                if (redirectNote) redirectNote.style.display = 'block';
                setTimeout(() => { window.location.href = body.redirect_url; }, 1500);
            }
        } catch (err) {
            showError(err.message || 'Something went wrong. Please try again.');
            btn.disabled = false;
            btn.textContent = origLabel;
        }
    });
})();
`;

const buildBody = (form) => {
    const fields = form.fields.map(fieldMarkup).join('\n            ');
    const submitLabel = esc(form.submit_label || 'Submit');
    const thankYou = esc(form.thank_you_message || "Thanks! We've received your response.");
    return `
    <div class="eh-wrap">
        <div class="eh-card">
            <div class="eh-header">
                <h1>${esc(form.title)}</h1>
                ${form.description ? `<p>${esc(form.description)}</p>` : ''}
            </div>
            <form id="eh-form" novalidate>
                <div class="eh-grid">
                    ${fields}
                </div>
                <button id="eh-submit" type="submit" class="eh-submit">${submitLabel}</button>
                <div id="eh-error" class="eh-alert" role="alert"></div>
            </form>
            <div id="eh-thanks" class="eh-thanks" role="status">
                <div class="eh-check">&#10003;</div>
                <h2>Response recorded</h2>
                <p>${thankYou}</p>
                <p id="eh-redirect-note" style="display:none;margin-top:14px;font-size:0.85rem;color:#94a3b8;">
                    Redirecting… <a id="eh-redirect-link" href="#" style="color:#8b5cf6;font-weight:600;">Click here if nothing happens</a>
                </p>
            </div>
        </div>
        <div class="eh-footer">Powered by EventHive Forms</div>
    </div>`;
};

// Assemble a single-file HTML document with CSS/JS inlined.
const buildSingleHtml = (form, apiBase) => {
    const title = esc(form.title || 'Form');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${buildCss()}</style>
</head>
<body>
${buildBody(form)}
<script>${buildJs(form, apiBase)}</script>
</body>
</html>
`;
};

// HTML that references external styles.css + script.js (for the ZIP bundle).
const buildSplitHtml = (form) => {
    const title = esc(form.title || 'Form');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
${buildBody(form)}
<script src="script.js"></script>
</body>
</html>
`;
};

const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Strip leading/trailing whitespace from an API base so the final URL is clean.
const normalizeApiBase = (raw) => (raw || '').trim().replace(/\/+$/, '') || window.location.origin;

export function exportFormHtml(form, apiBase) {
    const html = buildSingleHtml(form, normalizeApiBase(apiBase));
    const filename = `${slug(form.title)}.html`;
    triggerDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
}

export async function exportFormZip(form, apiBase) {
    const base = normalizeApiBase(apiBase);
    const zip = new JSZip();
    zip.file('index.html', buildSplitHtml(form));
    zip.file('styles.css', buildCss().trimStart());
    zip.file('script.js', buildJs(form, base).trimStart());
    zip.file('README.txt',
`${form.title} — exported form bundle
--------------------------------------

Files:
  index.html   Open in a browser, or upload to your site
  styles.css   Styling
  script.js    Submit handler (edit API_BASE inside this file if your backend URL changes)

Backend URL currently set to: ${base}

Deployment:
  1. Upload all three files to any static host (S3, Netlify, your CMS, etc.)
  2. Make sure the backend at the URL above is reachable from the page.
  3. No build step needed.
`);
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, `${slug(form.title)}.zip`);
}

export { normalizeApiBase };
