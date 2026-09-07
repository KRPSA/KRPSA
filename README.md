# KRPSA — Korea Practical Shooting Association

Official website of **KRPSA (대한실용사격협회)**, the IPSC Region for the Republic of Korea.

- Static site: `index.html` + `css/` + `js/` + `assets/` — no build step.
- Bilingual (한국어 / English). The toggle in the top-right switches every string via `js/i18n.js`; the choice is remembered in `localStorage` and can be forced with `?lang=en` or `?lang=ko`.
- Deployed with GitHub Pages via `.github/workflows/pages.yml` (Settings → Pages → Source: **GitHub Actions**).

## Editing content

All visible text lives in `js/i18n.js` as `ko` / `en` dictionaries keyed by `data-i18n` attributes in `index.html`.
To change a sentence, edit both languages for the same key.

Contact details (email, address, Regional Director) are in the `contact` / `rd` keys and in the `#contact` section of `index.html`.

## Local preview

Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8080
```

## Sources

- IPSC — What is IPSC, region directory, rules: <https://www.ipsc.org/>
- IPSC region record for Korea (KOR): <https://www.ipsc.org/regions/>
- Korea joined IPSC as the 106th region at the 42nd General Assembly (2018); a new Regional Directorate for the Republic of Korea was approved at the 48th General Assembly, Córdoba (Nov 2024).

IPSC and the IPSC crest are trademarks of the International Practical Shooting Confederation and are used to indicate affiliation.
