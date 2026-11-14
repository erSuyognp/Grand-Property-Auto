# Grand Property Auto

*Images for this page: `docs/mock_shots/` only (mock mode, synthetic neighborhood).*

## Inspiration

Home search is a funnel. You fill in a form, you get a list, you narrow it, and at no point do you get a feel for the street. The CoStar track asked for the opposite: AI as an input, not a chat window, and an experience that follows the way people actually decide, which is not a straight line. People do not say "filter by lot size". They walk out of a house and say "nice, but something cheaper, and closer to a park".

We also noticed that the three data sets on the table describe the same place from three distances: the city from an aircraft, the listing on paper, and the inside of the home in 3D. A driving game is the one format where you move through all three without noticing the seams.

## What it does

You drive a real neighborhood. Every building is where it really is and as tall as it really is, and the ground is the actual aerial photo. Homes for sale, rentals and apartment communities float a marker above their roofs.

- Pull up to a home and a card slides in: the price and features from the listing, and under it what can be seen from the air, such as a pool, solar panels, tree cover or a park nearby. If the two disagree, the game says so.
- Press one key and you are inside the real 3D scan of that home. You can see the same room with the furniture removed.
- Hold a key and say what you want. Matching homes light up, a gold line leads you to the best one, and a narrator tells you about it when you arrive.
- Keep talking. "Something cheaper." "A bigger yard." "Closer to a park." "More like this one." Each line is understood against the home you just saw.
- Scan a QR code and your phone is the steering wheel, the microphone and your saved list.
- Compare the homes you liked side by side.

There is no search form and no chat window anywhere.

## How we built it

- **The world** is a browser game in Three.js with no game engine and no map provider. A data pipeline turns aerial data into a ground texture, building outlines with heights, terrain, and the positions of trees and pools. Roofs are textured from the aerial photo itself, so the city looks like the photo from above.
- **The homes** come from the listing data, joined to the building each one sits in. That join is what lets a card show listing facts and aerial facts together.
- **The interiors** use the real 3D tours when the game runs on our laptop, with our own lightweight panorama viewer as the fallback and for the furniture free view.
- **Voice** uses the browser's speech recognition. A language model turns one spoken line into filters and writes a two sentence narration. It never shows text of its own choosing in a window; it only produces filters and a short spoken line. A local keyword parser does the same job offline, so the demo survives bad wifi.
- **"Near a park" and "more like this one"** use a visual search over aerial imagery that we index ahead of time, so missions are instant.
- **The phone controller** is a web page and a small relay on the laptop. Nothing leaves the local network.
- **Routes** are found on a grid built from the building outlines, with road pixels in the aerial image made cheaper, so the gold line follows streets even though we have no road data.

## Challenges we ran into

- **No roads.** We had buildings and a photo, not a street network. Teaching the route finder to prefer what looks like asphalt in the aerial image was the fix.
- **Lining everything up.** The ground image, the building outlines, the listings and the 3D scans each use their own coordinates. A marker floating over the wrong roof ruins the illusion.
- **Handling the data responsibly.** The data had to stay on one laptop, be used only during the event, and never appear in public material. So we built a guard that refuses sponsor calls outside the event window, a synthetic neighborhood for every public screenshot, and a script that deletes everything afterward.
- **Making it feel like a game in five seconds.** Arcade handling, a chase camera, a drop from the sky at the start, and a 60 fps target on a laptop without a graphics card.
- **Never blocking.** Every network step has a local fallback: typed input for speech, a keyword parser for the language model, narration templates, our own viewer for tours, and a photo gallery behind that.

## Accomplishments that we are proud of

- The moment you go from the driver's seat to standing in the living room of the house you just parked at.
- "With a pool" meaning a pool that is really there, not a word in a listing.
- A follow up like "something cheaper" working the way it would with a person.
- The whole thing running from one laptop with the network cable pulled.

## What we learned

- Putting data in a place you can move through changes what questions people ask. Nobody asked for a filter. They asked for "one like that, but quieter".
- The useful insights were at the joins between data sets, not inside any one of them.
- Voice works when it changes the world in front of you. It does not need to answer in sentences.

## What's next

- Walk from the curb through the front door in one continuous shot, using exterior 3D captures.
- Neighborhood scale questions: "show me the street with the most trees", "where can I walk to a school".
- Two players in the same city, one driving and one navigating, for couples who are searching together.
- Time of day and sun position, so you can see which yards get afternoon light.

## Built with

Three.js, Vite, Node, Express, WebSockets, Playwright, Python, Web Speech API, Web Audio, Claude, Vexcel aerial data, CoStar listing data, Matterport 3D tours.
