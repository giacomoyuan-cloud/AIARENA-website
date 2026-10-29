# Ten structures, one simple goal

Open `/design-review-3/#apple/compare` for a side-by-side comparison of actual browser screenshots of the same page. The comparison supports home, debate, image creation, and conversation views, plus a compact ten-layout overview. Select a layout to enter the complete interactive site. The page directory includes eleven routes: home, chat, images, debate, projects, project materials, Skills, settings, login, Android installation, and pitch tools.

These directions use independent navigation and page compositions in `layouts.js`, rather than applying different palettes to a shared page template. Only semantic controls, synthetic data, and the local interaction controller are shared.

| Direction | Navigation | Page composition |
| --- | --- | --- |
| Apple.com | Global and local top navigation | Full-width product sections and sequential feature stories |
| Focus | Quiet header and bottom Dock | One centered task and selectable perspectives |
| Side by Side | Top module tabs | Persistent brief/input on the left; results on the right |
| Atelier | Narrow tool rail | Large artboard with a contextual inspector; phone actions remain visible |
| Folio | Editorial contents column | Serif magazine spreads with marginal notes and parallel columns |
| Cinema | Lightweight scene navigation | Full-width artwork, asymmetric views, and a filmstrip |
| Messenger | Icon rail and conversation inbox | Message bubbles and group conversations |
| Bento | Compact sidebar | An asymmetric modular desk with primary and supporting tiles |
| Outline | Text navigation | Flat ruled grid, large sans typography, open rows |
| Notebook | Project bookmarks | A continuous paper document, side margin, and pasted images |

The Apple direction references the product presentation structure of [apple.com](https://www.apple.com/) and [Apple Intelligence](https://www.apple.com/apple-intelligence/), adapted to the AI assistant's own content. It is not a claim of Apple ownership or an exact clone of Apple's product content.

The design priority is a clear primary action, familiar labels, and advanced parameters shown on demand. Motion is limited to immediate press feedback and small state changes; the effort range has no label replacement animation. The grayscale control allows structural comparison without color.

All conversations, files, accounts, images, and provider responses are synthetic. State lives only in the page's memory. CSP `connect-src 'none'` prohibits model/API connections. File selections remain local. No API credits are used; no production provider, authentication, secret, or user data is modified. Real Android downloads are linked to the existing production installation page. Previous explorations are retained separately.

Browser acceptance covers all 110 desktop and 110 phone route combinations, plus narrow-phone, tablet, short-height input visibility, model and image panels, selected settings/state flows, local sending, project conversations, discussion controls, and the comparison picker. Screenshots in `previews/` are actual cropped browser captures. Responsive browser checks do not constitute physical Android-device or paid-provider acceptance.
