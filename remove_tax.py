"""
Replace all references to tax.html with salary-tax-calculator.html
and update the link labels from "Tax Calculator" to "Salary Tax Calculator".
Skips tax.html itself (will be deleted separately).
"""
import glob, re

FILES = [f for f in glob.glob("*.html") if f != "tax.html"]

OLD_HREF  = 'href="tax.html"'
NEW_HREF  = 'href="salary-tax-calculator.html"'

for filepath in sorted(FILES):
    with open(filepath, "r", encoding="utf-8") as fh:
        html = fh.read()

    if OLD_HREF not in html:
        continue

    # Replace href
    new_html = html.replace(OLD_HREF, NEW_HREF)

    # Update link labels that say just "Tax Calculator" → "Salary Tax Calculator"
    # (only inside anchor tags that now point to salary-tax-calculator.html)
    new_html = re.sub(
        r'(<a href="salary-tax-calculator\.html"[^>]*>)\s*(?:🧾\s*)?Tax Calculator\s*(</a>)',
        r'\1Salary Tax Calculator\2',
        new_html
    )

    # Update card title on index.html if it still says "Tax Calculator"
    new_html = new_html.replace(
        '<div class="calc-card-title">Tax Calculator</div>',
        '<div class="calc-card-title">Salary Tax Calculator</div>'
    )

    with open(filepath, "w", encoding="utf-8") as fh:
        fh.write(new_html)
    print(f"  [OK] {filepath}")

print("\nDone.")
