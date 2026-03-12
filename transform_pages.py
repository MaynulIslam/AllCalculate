"""
Remove <div class="page-header"> from all calculator pages and replace with
an inline calc-header (title + breadcrumb) at the top of .calc-body.
Run once; already-transformed files (no page-header) are skipped.
"""
import re, glob

FILES = [f for f in glob.glob("*.html") if f != "index.html"]


def extract_div_block(html, class_attr):
    """Return (start, end, inner_html) for the FIRST div with the given class,
    correctly handling nested divs."""
    start_tag = f'<div class="{class_attr}">'
    start = html.find(start_tag)
    if start == -1:
        return None, None, None

    pos = start + len(start_tag)
    depth = 1
    while depth > 0 and pos < len(html):
        next_open  = html.find('<div', pos)
        next_close = html.find('</div>', pos)

        if next_close == -1:
            break
        if next_open != -1 and next_open < next_close:
            depth += 1
            pos = next_open + 4          # skip past '<div'
        else:
            depth -= 1
            if depth == 0:
                end    = next_close + 6  # include '</div>'
                inner  = html[start + len(start_tag): next_close]
                return start, end, inner
            pos = next_close + 6

    return None, None, None


def transform(filepath):
    with open(filepath, "r", encoding="utf-8") as fh:
        html = fh.read()

    # ── 1. Find the full page-header block ─────────────────────────────────
    ph_start, ph_end, ph_inner = extract_div_block(html, "page-header")
    if ph_start is None:
        print(f"  [SKIP] {filepath}")
        return

    # ── 2. Extract h1 title ────────────────────────────────────────────────
    h1_match = re.search(r'<h1>(.*?)</h1>', ph_inner, re.DOTALL)
    title     = h1_match.group(1).strip() if h1_match else "Calculator"

    # ── 3. Extract breadcrumb <a> links ───────────────────────────────────
    links = re.findall(r'<a href="([^"]+)">([^<]+)</a>', ph_inner)

    # Final "current" span
    cur_match    = re.search(r'<span class="breadcrumb-current">([^<]+)</span>', ph_inner)
    current_text = cur_match.group(1).strip() if cur_match else title

    # Build breadcrumb HTML items
    bc_parts = []
    for href, text in links:
        bc_parts.append(f'<a href="{href}">{text.strip()}</a>')
    bc_parts.append(f'<span>{current_text}</span>')
    bc_html  = '\n              <span class="bc-sep">&#8250;</span>\n              '.join(bc_parts)

    # ── 4. Build new calc-header block ────────────────────────────────────
    new_header = (
        '\n          <div class="calc-header">\n'
        f'            <h1 class="calc-page-title">{title}</h1>\n'
        f'            <nav class="calc-page-breadcrumb">\n'
        f'              {bc_html}\n'
        f'            </nav>\n'
        f'          </div>\n\n'
    )

    # ── 5. Remove the old page-header (and any surrounding blank lines) ────
    #    Also eat one newline before the block if present
    remove_start = ph_start
    remove_end   = ph_end
    # eat leading whitespace/newline
    while remove_start > 0 and html[remove_start-1] in (' ', '\t'):
        remove_start -= 1
    if remove_start > 0 and html[remove_start-1] == '\n':
        remove_start -= 1
    # eat trailing newline
    if remove_end < len(html) and html[remove_end] == '\n':
        remove_end += 1

    html = html[:remove_start] + html[remove_end:]

    # ── 6. Insert new calc-header right after <div class="calc-body"> ──────
    cb_tag = '<div class="calc-body">\n'
    html   = html.replace(cb_tag, '<div class="calc-body">' + new_header, 1)

    with open(filepath, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"  [OK] {filepath}  -- title: {title!r}")


print(f"Processing {len(FILES)} files...\n")
for f in sorted(FILES):
    transform(f)
print("\nDone.")
