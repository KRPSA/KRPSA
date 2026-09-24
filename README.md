# KRPSA — Korea Practical Shooting Association

KRPSA bilingual Korean/English association landing page. Includes Handgun and Action Air introductions, handgun divisions, other IPSC disciplines, a three-stage beginner training guide, and KakaoTalk membership inquiries.

## Structure

- `index.html`: page content and Korean text
- `style.css`: responsive layout and slideshow styling
- `app.js`: English translations, language toggle, photo slideshow and contact ID copy
- `assets/`: logos, Korean flag and KRPSA member photos
- `SOURCES.md`: source references and photo attribution

No build step or dependencies are required. Serve the repository root locally, for example with `python -m http.server 8080`.

## Deployment

The existing `.github/workflows/pages.yml` publishes the repository root to GitHub Pages when changes reach `main`.

## Photos

The slideshow contains four KRPSA member/team photos: Wontaek Lim and the EHC/EEO 2026 delegation. Photo source links are also included in the footer.
