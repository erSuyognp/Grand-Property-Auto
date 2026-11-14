# Insights progress

Order: 1, 2, 3, 4, 5, 7, 6, 8. Marks: [x] done, [~] partly (what is missing), [-] skipped (why).

Started Sat Nov 14 2026 16:03 EST.

## Prompt 1: Ground rules (paste first, Claude Code adds these to CLAUDE.md)
- [x] 1-4. Honesty rules in CLAUDE.md
- [x] 5-8. Fair housing rules in CLAUDE.md
- [x] 9. Data agreement rule in CLAUDE.md
- [x] build, test, shot, commit

## Prompt 2: Enrichment pipeline (data for every listing in the area)
- [x] 1. Value vs nearby: price per sqft for this home vs homes within 1 km of the same type
- [x] 2. Rent vs buy: for the same bed count, the median asking rent of apartment listings
- [x] 3. Home facts from listing features: HOA fee and what it includes, community amenities,
- [x] 4. Apartment communities: floor plans, rent ranges, units available, community
- [~] 5. Neighborhood activity: done except tenants by industry (the kit has no industry on these tenancies): number of commercial
- [x] 6. Roof material, shape and condition, existing solar, pool, tree cover percent, lot
- [x] 7. Places (OpenStreetMap Overpass, one query for the whole bbox plus a 3 km margin):
- [~] 8. Drive times: fallback only (distance at 25 mph, labeled Estimate; Routes API refused the key, no ORS key so rings are distance rings):
- [x] 9. Census: tract from the Census geocoder; from ACS 5 year: median household income,
- [x] 10. Risk: FEMA National Risk Index for the tract (overall risk and the top 3 hazards,
- [x] 11. Energy: EIA average residential electricity price for the state (latest month).
- [~] 12. Solar: NREL PVWatts + Vexcel roof (Google Solar refused the key): for the home's lat/lon: max panel count,
- [x] 13. Money: 30 year rate from FRED (MORTGAGE30US). Property tax from a small cited table
- [x] 14. True monthly cost = principal and interest (default 20% down, slider later) +
- [x] 15. Errands (supermarket, pharmacy, cafe drive or walk times), Commute (downtown and
- [x] build, test, shot, commit

## Prompt 3: The property reveal (select a property, the world animates)
- [x] 1. Camera swoops to a drone view above the home (smooth, about 1.2 s), the rest of the
- [~] 2. Rings are 5/10/15 minute walk rings from distance (no ORS key; drive rings are bigger than the map). Drive time rings: the 15, 10 and 5 minute isochrones grow outward from the home on
- [x] 3. Places pop up: 3D icons rise with a bounce at the nearest supermarket, school, park,
- [~] 4. Solar: panels are laid out in rows inside the roof outline (no Google Solar positions); original: if the home has Solar API panels, blue panel tiles drop onto the real roof one
- [x] 5. Risk: if the home is in a FEMA flood zone, a gentle blue tint ripples over that area
- [x] 6. Panel slides in from the right with cards that animate in one by one with count up
- [x] 7. Buttons: Walk inside (E), Save (F), Ask Maya (V), Compare (Tab), Better options (B).
- [x] build, test, shot, commit

## Prompt 4: Maya, the voice saleswoman
- [~] 1. Speech in (barge in happens when the player presses V or the mic, which stops her at once; there is no always-on mic listening for the player while she talks): hold V (or the phone mic) uses the Web Speech API with interim results
- [x] 2. Brain: server /api/maya streams from Claude (model from env) with tool use. Tools,
- [x] 3. Voice out: stream Claude's text sentence by sentence into ElevenLabs streaming TTS
- [x] 4. Memory within the session: a running list of the player's stated preferences
- [x] 5. Behavior:
- [x] 6. Avatar: an original illustrated character in a round frame bottom center (no photo
- [x] 7. If LLM or TTS fails, she falls back to scripted lines built from the insight data, so
- [x] build, test, shot, commit

## Prompt 5: Missions (real buyer and renter situations, every data type)
- [x] 1. "First Home": budget, 2+ beds, under X min drive to a supermarket. Score: fit,
- [~] 2. Lot threshold comes from the city data (Houston lots here are under 0.07 acres); hidden in LA (too few 3 bed homes for sale). "Room to Grow": 3+ beds, a park within 10 min, lot over 0.15 acres. No family
- [x] 3. "Power Bill Hater": lowest estimated electric bill or best solar potential under
- [x] 4. "Rent or Buy?": the client pays $X rent. Find a home where the true monthly cost is
- [x] 5. "Downtown Commuter": under 20 min drive to downtown or 10 min walk to transit.
- [x] 6. "Pool Season": a pool seen from the air (Vexcel), not just listed.
- [x] 7. "Low Risk": outside a flood zone, lowest FEMA risk tier, roof in good condition.
- [x] 8. "Investor": a small apartment community or home where nearby rents cover the
- [x] 9. "Busy Street Life": most shops and restaurants within a 10 minute walk (CoStar
- [x] 10. "Price Detective" mini game: show a home's photos and facts, the player guesses the
- [x] 11. "Open House Rush": visit and walk inside 3 homes that match a client within 5
- [x] build, test, shot, commit

## Prompt 6: Polish pass (modern game feel)
- [x] 1. One design system: font pairing, spacing scale, colors per score category, glass
- [x] 2. Motion: spring animations on every panel, card stagger, number count ups, marker
- [x] 3. Sound: UI clicks, whooshes on reveal, ambient city loop outside, room tone inside,
- [x] 4. Onboarding: a 20 second first run tutorial with Maya: drive, select, reveal, walk in,
- [x] 5. Plain language everywhere: no jargon (no "cap rate", "ACS", "isochrone" on the main
- [~] 6. Settings (units apply to the panel distances; Maya and the reveal chips speak in minutes). Settings: units, reduced motion, subtitles size, graphics quality preset.
- [x] 7. Performance: 55+ fps on this laptop during reveal and missions; preload the next
- [x] 8. Demo mode (key 0) updated: drive, select with reveal, Maya pitch + one question,
- [x] build, test, shot, commit

## Prompt 7: Buyer tools (what makes it actually useful)
- [x] 1. "Can I afford it?" profile (key A or ask Maya): yearly income, monthly debts,
- [~] 2. Drive times are estimates from distance (Routes API refused the key). "My places": the player pins up to 3 places that matter (work, a school, family,
- [x] 3. Compare (Tab): up to 4 saved homes side by side: price, true monthly cost, price per
- [x] 4. Shortlist report: export the saved homes as a clean one page summary (print to PDF
- [~] 5. The plain line comes from the sun position (no Solar API roof data); shadows show on the block city only. Sun and light: a time of day slider on the reveal that moves the real sun position
- [x] 6. Street noise check: distance to the nearest highway, rail line and airport (OSM),
- [~] 7. Tape measure done; room sizes are the scan's room areas (no wall lengths in the data, so the sofa answer gives an estimated wall length and sends the player to the tape). Room fit inside walk mode: a tape measure tool (key R) that measures between two
- [x] 8. "Same money, other city": for a selected LA home, Maya can show what the same
- [x] 9. Price changes: if the listing data has price history or status changes, show a tiny
- [x] 10. What's included: for apartments, a clear list of community amenities and what the
- [x] build, test, shot, commit

## Prompt 8: Final quality and demo readiness
- [ ] 1. Accessibility: captions for all speech, keyboard only path through every feature,
- [ ] 2. Empty and error states for every card and tool (no blank boxes, no NaN, no
- [ ] 3. Data check script tools/check_insights.py: coverage per source per city, outliers
- [ ] 4. Fair housing check: grep all UI text, prompt templates and Maya's system prompt for
- [ ] 5. Performance and load: cold start under 6 s on localhost, reveal at 55+ fps, Maya's
- [ ] 6. Update demo mode and DEMO_SCRIPT.md: open on the problem (scrolling flat listings),
- [ ] 7. Mock mode screenshots of every screen to docs/mock_shots/ for Devpost.
- [ ] build, test, shot, commit
