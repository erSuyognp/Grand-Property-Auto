# How the scores are worked out

Every score is 0 to 100 and comes with a one line reason. Higher is better for the buyer.
They are computed in `tools/enrich_city.py` from the facts shown on the same card. A score is
left out ("Not available") when the facts behind it are missing. None of them use anything
about the people who live in an area.

Times are estimates unless the Google Routes API is set up: distance along a route 1.3 times
the straight line, at 25 mph driving or 3 mph walking.

## Errands
How quick the everyday trips are.
- Each of supermarket, pharmacy and cafe gets 100 points at a 2 minute drive or less, and loses 10 points for every minute beyond that.
- Score = half the supermarket points + a quarter of the pharmacy points + a quarter of the cafe points.

## Commute
- Downtown drive: 100 points at 10 minutes or less, minus 3 points per extra minute.
- Transit: 100 points when the nearest stop is a 3 minute walk or less, minus 6 points per extra minute.
- Score = 60% downtown drive + 40% transit.

## Outdoors
- Park: 100 points when the nearest park is a 3 minute walk or less, minus 5 points per extra minute.
- Trees: 4 points for every percent of tree cover seen from the air, up to 100.
- Pool: 100 points if the aerial image shows a pool.
- Score = 60% park + 25% trees + 15% pool.

## Energy
- Bill: 100 points at an estimated electric bill of $80 a month, falling to 0 at $300.
- Solar: the share of the bill that rooftop solar could cover (0 when solar is not available).
- Roof: the aerial roof condition rating (1 to 5, 5 best) as a percentage; 50 when unknown.
- Score = 50% bill + 35% solar + 15% roof.

## Value
- Comps: the share of similar homes nearby (same type, for sale now or sold in the last year, within 1 km, widened to 2 or 3.5 km when there are fewer than four) that cost more per square foot than this one.
- Rent check: 50 points when the estimated monthly cost equals the median rent of a similar apartment nearby, more when owning is cheaper, less when renting is cheaper.
- Score = 70% comps + 30% rent check (whichever parts exist).
- Apartments and rentals: the share of communities within 2 km whose starting rent is higher.

## Risk (higher score = lower risk)
- 100 minus FEMA's National Risk Index score for the census tract (a 0 to 100 national percentile).
- Minus 30 if the home sits in a high risk flood zone (zones starting with A or V).

## Neighborhood activity
- Shops: 2.5 points for every shop or place to eat within a 10 minute walk (800 m), up to 100.
- Businesses: half a point for every business renting space within 1.5 km, up to 100.
- Investment: 8 points for every commercial building sold nearby in the last 2 years and 10 for every one finished in the last 5 years, up to 100.
- Score = 50% shops + 30% businesses + 20% investment.

## Monthly cost (not a score)
Estimate = loan payment (30 year fixed at the weekly Freddie Mac average rate, default 20% down)
+ property tax + the state average homeowners insurance premium + HOA + the electric estimate,
minus solar savings when the solar switch is on. The monthly solar line is the yearly saving
divided by 12 and rounded half up, and that same dollar amount is what the total subtracts.
Homes that already have panels do not get that switch: the electric estimate is a state average
and does not know about those panels. Mortgage insurance for down payments under 20%
is not included, and the cost card says so. The "home price that fits" uses the same loan, tax,
insurance and a typical electric bill, and leaves HOA out because HOA is not a function of price.
Not financial, legal or insurance advice.
